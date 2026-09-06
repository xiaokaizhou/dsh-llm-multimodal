/**
 * Voice-clone tests for generate_tts / generate_music.
 *
 * Covers:
 *   - the new clone params are registered on both tools;
 *   - the plain preset-voice path still works (no regression, output_format
 *     passthrough, file written to /tmp);
 *   - the clone path: files/upload → voice_clone → /audio/speech with the
 *     cloned voice_id, and the voice store is persisted;
 *   - reuse by voice_name (second call skips upload + clone);
 *   - clone failures surface an actionable message;
 *   - generate_music runs the same clone flow (music-classified model);
 *   - tts/music separation: TTS models never serve music and vice versa;
 *   - apiProtocol guard: non-openai providers are rejected pre-call, and
 *     explicit apiProtocol: openai passes;
 *   - pure helpers (sanitizeVoiceName / audioExtFromName / extFromMime /
 *     loadAudioBuffer / isOpenAIProtocol / applyOverride).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { writeFile, mkdir, readFile, rm } from 'node:fs/promises'
import { writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

interface RecordedTool { name: string; def: any }

async function loadPlugin() {
  return await import('../lib/index.js')
}

function makeFakeCtx() {
  const registered: RecordedTool[] = []
  const tmpDir = join(tmpdir(), 'llm-multimodal-vc-' + Date.now())
  const yamlPath = join(tmpDir, 'settings.yaml')
  // Hermetic default: point DSH_SETTINGS_PATH at an empty config so tests
  // never read the developer's real ~/.dsh/settings.yaml (which would
  // trigger real network calls and time out).
  mkdirSync(tmpDir, { recursive: true })
  writeFileSync(yamlPath, 'llm-pi-ai:\n', 'utf8')
  process.env.DSH_SETTINGS_PATH = yamlPath
  const credentials = {
    async resolve(envName: string) {
      return { value: process.env[envName] || '' }
    },
  }
  return {
    ctx: {
      tools: {
        registered,
        register(def: any) {
          registered.push({ name: def.name, def })
        },
      },
      credentials,
      settings: {
        register: () => ({
          get() {
            return { text: {}, image: {}, video: {}, tts: {}, music: {} }
          },
          watch: () => () => {},
          update: async () => {},
          replace: async () => {},
        }),
      },
      llm: undefined,
    },
    yamlPath,
    tmpDir,
    async setYaml(yaml: string) {
      await mkdir(tmpDir, { recursive: true })
      await writeFile(yamlPath, yaml, 'utf8')
      process.env.DSH_SETTINGS_PATH = yamlPath
    },
    async clearYaml() {
      delete process.env.DSH_SETTINGS_PATH
    },
  }
}

const TTS_YAML = [
  'llm-pi-ai:',
  '  providers:',
  '    minimax:',
  '      apiKeyEnv: MINIMAX_API_KEY',
  '      baseURL: https://api.minimaxi.com/v1',
  '      models:',
  '        - id: minimax-speech-02-hd',
  '          name: MiniMax Speech 02 HD',
  '',
].join('\n')

// Music-classified model (id contains "music") — used by the music tests so
// the tts/music separation contract holds in the happy path too.
const MUSIC_YAML = [
  'llm-pi-ai:',
  '  providers:',
  '    musicprov:',
  '      apiKeyEnv: MINIMAX_API_KEY',
  '      baseURL: https://api.minimaxi.com/v1',
  '      models:',
  '        - id: musicgen-melody',
  '          name: MusicGen Melody',
  '',
].join('\n')

// Provider pinned to a NON-OpenAI protocol: tools must reject it before any
// network call, with an actionable message.
const CLAUDE_PROTOCOL_YAML = [
  'llm-pi-ai:',
  '  providers:',
  '    claude-proxy:',
  '      apiKeyEnv: ANTHROPIC_API_KEY',
  '      apiProtocol: claude',
  '      baseURL: https://api.anthropic.com/v1',
  '      models:',
  '        - id: minimax-speech-02-hd',
  '          name: MiniMax Speech 02 HD',
  '',
].join('\n')

const MP3_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00])
const DATA_URI = 'data:audio/mpeg;base64,' + Buffer.from('fake-audio-seed').toString('base64')

function mockFetchWith(routes: Record<string, (url: string, init?: any) => Response>) {
  const calls: Array<{ url: string; init?: any }> = []
  const orig = (globalThis as any).fetch
  ;(globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url)
    calls.push({ url: u, init })
    for (const [k, fn] of Object.entries(routes)) {
      if (u.includes(k)) return fn(u, init)
    }
    throw new Error('unexpected fetch: ' + u)
  }
  return {
    calls,
    restore() {
      ;(globalThis as any).fetch = orig
    },
  }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  delete process.env.DSH_SETTINGS_PATH
  delete process.env.DSH_LLMM_VOICE_STORE
  delete process.env.MINIMAX_API_KEY
  for (const c of cleanups) await c()
  cleanups.length = 0
})

function registerCleanup(dir: string) {
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
}

describe('generate_tts / generate_music — clone params registered', () => {
  it('both tools expose clone_audio / voice_name / clone_voice_id / output_format', async () => {
    const { ctx, setYaml, clearYaml } = makeFakeCtx()
    await setYaml(TTS_YAML)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      for (const name of ['generate_tts', 'generate_music']) {
        const t = ctx.tools.registered.find((x) => x.name === name)!
        const p = t.def.parameters.properties
        expect(p.clone_audio, name + '.clone_audio').toBeDefined()
        expect(p.voice_name, name + '.voice_name').toBeDefined()
        expect(p.clone_voice_id, name + '.clone_voice_id').toBeDefined()
        expect(p.output_format, name + '.output_format').toBeDefined()
        expect(p.output_format.enum).toContain('wav')
      }
    } finally {
      await clearYaml()
    }
  })
})

describe('generate_tts — plain preset-voice path (regression guard)', () => {
  it('speaks with the preset voice, honours output_format, writes the mp3/wav file', async () => {
    process.env.MINIMAX_API_KEY = 'demo-key'
    const { ctx, setYaml, clearYaml } = makeFakeCtx()
    await setYaml(TTS_YAML)
    try {
      const mock = mockFetchWith({
        '/audio/speech': () =>
          new Response(MP3_BYTES, { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
      })
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_tts')!
      const ac = new AbortController()
      const r = await t.def.execute(
        { text: '你好', voice: 'male-qn-jingying', output_format: 'mp3' },
        { signal: ac.signal },
      )
      expect(r.success).toBe(true)
      expect(r.voice).toBe('male-qn-jingying')
      expect(r.clonedVoiceId).toBeUndefined()
      // Exactly one network call — the speech endpoint.
      expect(mock.calls.length).toBe(1)
      expect(mock.calls[0].url).toContain('/audio/speech')
      const body = JSON.parse(mock.calls[0].init.body)
      expect(body.input).toBe('你好')
      expect(body.voice).toBe('male-qn-jingying')
      expect(body.response_format).toBe('mp3')
      // File was actually written under /tmp with the tts prefix.
      expect(r.url.startsWith('file:///tmp/llm-multimodal-tts-')).toBe(true)
      const data = await readFile(r.url.slice('file://'.length))
      expect(data.length).toBe(MP3_BYTES.length)
    } finally {
      await clearYaml()
    }
  })
})

describe('generate_tts — voice cloning from reference audio', () => {
  it('uploads → clones → speaks with the cloned voice_id and persists the store', async () => {
    process.env.MINIMAX_API_KEY = 'demo-key'
    const voiceId = 'voice_clone_shenyuan_test'
    const storePath = join(tmpdir(), 'llmm-vc-store-' + Date.now(), 'voices.json')
    process.env.DSH_LLMM_VOICE_STORE = storePath
    registerCleanup(dirname(storePath))

    const { ctx, setYaml, clearYaml } = makeFakeCtx()
    await setYaml(TTS_YAML)
    try {
      const mock = mockFetchWith({
        '/files/upload': () =>
          new Response(JSON.stringify({ file: { file_id: 'file_123' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        '/voice_clone': () =>
          new Response(JSON.stringify({ voice_id: voiceId, status: 'completed' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        '/audio/speech': () =>
          new Response(MP3_BYTES, { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
      })
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_tts')!
      const ac = new AbortController()
      const r = await t.def.execute(
        { text: '三年了，苏家欠我的。', clone_audio: DATA_URI, voice_name: '沈渊', clone_voice_id: voiceId },
        { signal: ac.signal },
      )
      expect(r.success).toBe(true)
      expect(r.voice).toBe(voiceId)
      expect(r.cloned).toBe(true)
      expect(r.clonedVoiceId).toBe(voiceId)
      expect(r.voiceName).toBe('沈渊')
      // Call sequence: upload → clone → speak.
      const urls = mock.calls.map((c) => c.url)
      expect(urls[0]).toContain('/files/upload')
      expect(urls[1]).toContain('/voice_clone')
      expect(urls[2]).toContain('/audio/speech')
      // Upload is multipart FormData with purpose=voice_clone.
      expect(mock.calls[0].init.body instanceof FormData).toBe(true)
      // Speech request carries the cloned voice_id.
      const body = JSON.parse(mock.calls[2].init.body)
      expect(body.voice).toBe(voiceId)
      // Store persisted under the sanitised角色名.
      const store = JSON.parse(await readFile(storePath, 'utf8'))
      expect(store.voices['沈渊'].voiceId).toBe(voiceId)
      expect(store.voices['沈渊'].modelId).toBe('minimax-speech-02-hd')
    } finally {
      await clearYaml()
    }
  })

  it('reuses the stored clone by voice_name — second call does NOT re-upload/re-clone', async () => {
    process.env.MINIMAX_API_KEY = 'demo-key'
    const voiceId = 'voice_clone_shenyuan_test'
    const storePath = join(tmpdir(), 'llmm-vc-reuse-' + Date.now(), 'voices.json')
    process.env.DSH_LLMM_VOICE_STORE = storePath
    registerCleanup(dirname(storePath))
    await mkdir(dirname(storePath), { recursive: true })
    await writeFile(
      storePath,
      JSON.stringify({
        voices: {
          '沈渊': { voiceId, baseURL: 'https://api.minimaxi.com/v1', modelId: 'minimax-speech-02-hd', createdAt: 'x' },
        },
      }),
      'utf8',
    )

    const { ctx, setYaml, clearYaml } = makeFakeCtx()
    await setYaml(TTS_YAML)
    try {
      const mock = mockFetchWith({
        '/audio/speech': () =>
          new Response(MP3_BYTES, { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
      })
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_tts')!
      const ac = new AbortController()
      const r = await t.def.execute(
        { text: '让开。', clone_audio: DATA_URI, voice_name: '沈渊' },
        { signal: ac.signal },
      )
      expect(r.success).toBe(true)
      expect(r.voice).toBe(voiceId)
      expect(r.cloned).toBe(false)
      // Only the speech endpoint was hit — upload + clone were skipped.
      expect(mock.calls.length).toBe(1)
      expect(mock.calls[0].url).toContain('/audio/speech')
      expect(r.message).toMatch(/复用/)
    } finally {
      await clearYaml()
    }
  })

  it('surfaces an actionable error when the upload endpoint rejects (non-MiniMax provider)', async () => {
    process.env.MINIMAX_API_KEY = 'demo-key'
    const storePath = join(tmpdir(), 'llmm-vc-fail-' + Date.now(), 'voices.json')
    process.env.DSH_LLMM_VOICE_STORE = storePath
    registerCleanup(dirname(storePath))

    const { ctx, setYaml, clearYaml } = makeFakeCtx()
    await setYaml(TTS_YAML)
    try {
      const mock = mockFetchWith({
        '/files/upload': () =>
          new Response(JSON.stringify({ message: 'unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      })
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_tts')!
      const ac = new AbortController()
      const r = await t.def.execute(
        { text: 'x', clone_audio: DATA_URI, voice_name: 'X' },
        { signal: ac.signal },
      )
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/音色克隆失败/)
      expect(r.message).toMatch(/401|unauthorized/)
      expect(mock.calls.length).toBe(1) // never reached clone/speech
    } finally {
      await clearYaml()
    }
  })
})

describe('generate_music — same clone flow', () => {
  it('clones a voice and speaks through the music tool', async () => {
    process.env.MINIMAX_API_KEY = 'demo-key'
    const voiceId = 'voice_clone_narrator_test'
    const storePath = join(tmpdir(), 'llmm-vc-music-' + Date.now(), 'voices.json')
    process.env.DSH_LLMM_VOICE_STORE = storePath
    registerCleanup(dirname(storePath))

    const { ctx, setYaml, clearYaml } = makeFakeCtx()
    await setYaml(MUSIC_YAML)
    try {
      const mock = mockFetchWith({
        '/files/upload': () =>
          new Response(JSON.stringify({ file_id: 'file_9' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        '/voice_clone': () =>
          new Response(JSON.stringify({ voice_id: voiceId, status: 'completed' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        '/audio/speech': () =>
          new Response(MP3_BYTES, { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
      })
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_music')!
      const ac = new AbortController()
      const r = await t.def.execute(
        { text: '本故事纯属虚构', clone_audio: DATA_URI, voice_name: '旁白', clone_voice_id: voiceId },
        { signal: ac.signal },
      )
      expect(r.success).toBe(true)
      expect(r.voice).toBe(voiceId)
      expect(r.url.startsWith('file:///tmp/llm-multimodal-music-')).toBe(true)
      expect(mock.calls.length).toBe(3)
      const store = JSON.parse(await readFile(storePath, 'utf8'))
      expect(store.voices['旁白'].voiceId).toBe(voiceId)
    } finally {
      await clearYaml()
    }
  })
})

describe('tts / music model separation', () => {
  it('TTS-classified models do NOT serve generate_music', async () => {
    process.env.MINIMAX_API_KEY = 'demo-key'
    const { ctx, setYaml, clearYaml } = makeFakeCtx()
    await setYaml(TTS_YAML)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_music')!
      const ac = new AbortController()
      const r = await t.def.execute({ text: '夜曲' }, { signal: ac.signal })
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/未发现可用的 music 模型/)
    } finally {
      await clearYaml()
    }
  })

  it('music-classified models do NOT serve generate_tts', async () => {
    process.env.MINIMAX_API_KEY = 'demo-key'
    const { ctx, setYaml, clearYaml } = makeFakeCtx()
    await setYaml(MUSIC_YAML)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_tts')!
      const ac = new AbortController()
      const r = await t.def.execute({ text: '你好' }, { signal: ac.signal })
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/未发现可用的 TTS 模型/)
    } finally {
      await clearYaml()
    }
  })

  it('requesting a TTS model id from generate_music falls back with a warning, not a silent serve', async () => {
    process.env.MINIMAX_API_KEY = 'demo-key'
    const { ctx, setYaml, clearYaml } = makeFakeCtx()
    await setYaml(MUSIC_YAML)
    try {
      const mock = mockFetchWith({
        '/audio/speech': () =>
          new Response(MP3_BYTES, { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
      })
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_music')!
      const ac = new AbortController()
      const r = await t.def.execute(
        { text: 'x', model: 'minimax-speech-02-hd' },
        { signal: ac.signal },
      )
      // Requested-but-missing: falls back to the music model, never to TTS.
      expect(r.success).toBe(true)
      expect(r.model).toBe('musicgen-melody')
      expect(r.message).toMatch(/已自动降级使用 "musicgen-melody"/)
    } finally {
      await clearYaml()
    }
  })
})

describe('apiProtocol — OpenAI protocol guard', () => {
  it('non-openai apiProtocol is rejected before any network call', async () => {
    process.env.ANTHROPIC_API_KEY = 'demo-key'
    const { ctx, setYaml, clearYaml } = makeFakeCtx()
    await setYaml(CLAUDE_PROTOCOL_YAML)
    try {
      const mock = mockFetchWith({})
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_tts')!
      const ac = new AbortController()
      const r = await t.def.execute({ text: '你好' }, { signal: ac.signal })
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/apiProtocol="claude"/)
      expect(r.message).toMatch(/openai/)
      expect(mock.calls.length).toBe(0) // guard fires before fetch
    } finally {
      await clearYaml()
    }
  })

  it('explicit apiProtocol: openai passes the guard and speaks', async () => {
    process.env.MINIMAX_API_KEY = 'demo-key'
    const yaml = TTS_YAML.replace(
      "      apiKeyEnv: MINIMAX_API_KEY",
      "      apiKeyEnv: MINIMAX_API_KEY\n      apiProtocol: openai",
    )
    const { ctx, setYaml, clearYaml } = makeFakeCtx()
    await setYaml(yaml)
    try {
      const mock = mockFetchWith({
        '/audio/speech': () =>
          new Response(MP3_BYTES, { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
      })
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_tts')!
      const ac = new AbortController()
      const r = await t.def.execute({ text: '你好' }, { signal: ac.signal })
      expect(r.success).toBe(true)
      expect(mock.calls.length).toBe(1)
    } finally {
      await clearYaml()
    }
  })

  it('isOpenAIProtocol / applyOverride keep apiProtocol semantics', async () => {
    const mod = await loadPlugin()
    expect(mod.isOpenAIProtocol(undefined)).toBe(true)
    expect(mod.isOpenAIProtocol({ apiProtocol: '' })).toBe(true)
    expect(mod.isOpenAIProtocol({ apiProtocol: 'openai' })).toBe(true)
    expect(mod.isOpenAIProtocol({ apiProtocol: 'OpenAI' })).toBe(true)
    expect(mod.isOpenAIProtocol({ apiProtocol: 'claude' })).toBe(false)
    expect(mod.isOpenAIProtocol({ apiProtocol: 'gemini' })).toBe(false)

    const row = { provider: 'p', id: 'm', baseURL: 'b', apiKey: 'k', apiProtocol: 'openai' }
    // Override with a protocol replaces it; empty override keeps the row.
    expect(mod.applyOverride(row, { baseURL: 'b2', apiProtocol: 'claude' }).apiProtocol).toBe('claude')
    expect(mod.applyOverride(row, { baseURL: 'b2' }).apiProtocol).toBe('openai')
    expect(mod.applyOverride(row, {}).apiProtocol).toBe('openai')
  })
})

describe('voice-clone helpers (pure)', () => {
  it('sanitizeVoiceName keeps角色名 and normalises latin names', async () => {
    const mod = await loadPlugin()
    expect(mod.sanitizeVoiceName('沈渊')).toBe('沈渊')
    expect(mod.sanitizeVoiceName('  Narrator!  ')).toBe('narrator')
    expect(mod.sanitizeVoiceName('A/B*C')).toBe('a_b_c')
  })

  it('audioExtFromName / extFromMime pick the right extension', async () => {
    const mod = await loadPlugin()
    expect(mod.audioExtFromName('/tmp/a.mp3')).toBe('mp3')
    expect(mod.audioExtFromName('a.wav?x=1')).toBe('wav')
    expect(mod.audioExtFromName('a.xyz')).toBe('mp3')
    expect(mod.extFromMime('audio/mpeg')).toBe('mp3')
    expect(mod.extFromMime('audio/wav')).toBe('wav')
    expect(mod.extFromMime('audio/mp4')).toBe('m4a')
    expect(mod.extFromMime('')).toBe('mp3')
  })

  it('loadAudioBuffer decodes data URIs and reads local files', async () => {
    const mod = await loadPlugin()
    const ac = new AbortController()
    const fromData = await mod.loadAudioBuffer(
      'data:audio/wav;base64,' + Buffer.from('ABC').toString('base64'),
      ac.signal,
    )
    expect(fromData.buf.toString()).toBe('ABC')
    expect(fromData.ext).toBe('wav')

    const p = join(tmpdir(), 'llmm-vc-helper-' + Date.now(), 'seed.mp3')
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, Buffer.from('LOCAL'))
    const fromFile = await mod.loadAudioBuffer(p, ac.signal)
    expect(fromFile.buf.toString()).toBe('LOCAL')
    expect(fromFile.ext).toBe('mp3')
    await rm(dirname(p), { recursive: true, force: true })
  })
})
