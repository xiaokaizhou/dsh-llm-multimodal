/**
 * Integration test: the `apply` function of dsh-llm-multimodal.
 *
 * The plugin's host entry calls `tools.register(defineTool({...}))` five
 * times — once each for generate_text, generate_image, generate_video,
 * generate_tts, generate_music. We don't need the real cordis runtime
 * here, only a ctx-shaped object whose `tools.register` records every
 * tool it receives.
 *
 * `defineTool` from @deepseek-ai/dsh-tools is the real one — it only
 * validates the schema shape and returns the definition object; it does
 * NOT require a live ToolRuntime.
 */

import { describe, it, expect } from 'vitest'
import { writeFile, mkdir } from 'node:fs/promises'
import { writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface RecordedTool {
  name: string
  description: string
  def: unknown
}

/** A noop fake LLM used by the generate_text integration tests. It
 *  records every (provider, model) pair that prepareCall is invoked
 *  with and yields one canned text chunk per stream() call so the
 *  caller can complete a full success cycle. */
interface FakeLlmCall {
  provider: string
  model: string
  messages: unknown
}
function makeFakeLlm(opts: {
  onPrepare?: (call: FakeLlmCall) => void
  chunks?: Array<{ type: string; text?: string; usage?: { inputTokens: number; outputTokens: number } }>
} = {}) {
  const calls: FakeLlmCall[] = []
  const defaultChunks = [
    { type: 'text-delta', text: 'hello' },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 1 } },
  ]
  const chunks = opts.chunks ?? defaultChunks
  return {
    calls,
    async prepareCall(args: { provider: string; model: string; maxTokens?: number }, _signal: AbortSignal) {
      return {
        // `stream` is consumed via `for await (const chunk of prep.stream(...))`
        // in lib/index.js, so it must be an async iterable — i.e. an async
        // generator function. (A plain `async function` returning an array
        // would force the consumer to `await prep.stream(...)` first, which
        // the real harness does NOT do.)
        async *stream(params: { provider?: string; model?: string; messages: unknown; signal?: AbortSignal }) {
          // The plugin spreads the harness's prepared config (prep.config)
          // into stream(); the fake returns a config that carries no
          // provider/model, so the recorded call mirrors what prepareCall
          // itself received — the authoritative pair for assertions.
          const callRec = { provider: args.provider, model: args.model, messages: params.messages }
          calls.push(callRec)
          opts.onPrepare?.({ ...args, messages: params.messages })
          for (const c of chunks) yield c
        },
      }
    },
  }
}

async function loadPlugin() {
  return await import('../lib/index.js')
}

function makeFakeCtx(opts: {
  yamlSettings?: string
  llm?: ReturnType<typeof makeFakeLlm> | null
} = {}): {
  ctx: {
    tools: { register: (def: unknown) => void; registered: RecordedTool[] }
    credentials: { resolve: (envName: string) => Promise<{ value: string } | null> }
    settings: unknown
    llm: unknown
  }
  setYaml: (yaml: string) => Promise<void>
  clearYaml: () => Promise<void>
} {
  const registered: RecordedTool[] = []
  const tmpDir = join(tmpdir(), 'llm-multimodal-it-' + Date.now())
  const yamlPath = join(tmpDir, 'settings.yaml')
  // Hermetic default: point DSH_SETTINGS_PATH at an empty config so tests
  // never read the developer's real ~/.dsh/settings.yaml (which would
  // resolve real providers + apiKeys and hang on real network calls).
  // Tests that need models call setYaml() to overwrite this file.
  mkdirSync(tmpDir, { recursive: true })
  writeFileSync(yamlPath, 'llm-pi-ai:\n', 'utf8')
  process.env.DSH_SETTINGS_PATH = yamlPath
  const credentials = {
    async resolve(envName: string) {
      return { value: process.env[envName] || '' }
    },
  }
  // Default: no LLM adapter. Tests that need a real stream pass
  // `opts.llm` and we wire it through.
  const llm = opts.llm ?? null
  return {
    ctx: {
      tools: {
        registered,
        register(def: any) {
          // Capture the canonical plugin tool name + description (so we can
          // assert the public surface) plus the full definition.
          registered.push({ name: def.name, description: def.description, def })
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
      llm: llm ?? undefined,
    },
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

describe('plugin apply — registers all six generator tools', () => {
  it('registers generate_text, generate_image, generate_video, generate_vision, generate_tts, generate_music', async () => {
    const { ctx } = makeFakeCtx()
    const mod = await loadPlugin()
    await mod.apply(ctx as never)

    const names = ctx.tools.registered.map((t) => t.name).sort()
    expect(names).toEqual([
      'generate_image',
      'generate_music',
      'generate_text',
      'generate_tts',
      'generate_video',
      'generate_vision',
    ])

    // Every tool exposes a description so the model can pick it.
    for (const t of ctx.tools.registered) {
      expect(typeof t.description).toBe('string')
      expect(t.description.length).toBeGreaterThan(10)
    }
  })

  it('generate_image.execute returns "success: false" when no image model is configured', async () => {
    const { ctx } = makeFakeCtx()
    const mod = await loadPlugin()
    await mod.apply(ctx as never)
    const t = ctx.tools.registered.find((x) => x.name === 'generate_image')!
    const ac = new AbortController()
    const r = await t.def.execute({ prompt: 'a cat', model: '' }, { signal: ac.signal } as never)
    expect(r.success).toBe(false)
    expect(typeof r.message).toBe('string')
    expect(r.message).toMatch(/图像|未发现|image/i)
  })

  it('generate_video returns "success: false" when no video model is configured', async () => {
    const { ctx } = makeFakeCtx()
    const mod = await loadPlugin()
    await mod.apply(ctx as never)
    const t = ctx.tools.registered.find((x) => x.name === 'generate_video')!
    const ac = new AbortController()
    const r = await t.def.execute({ prompt: 'pan' }, { signal: ac.signal } as never)
    expect(r.success).toBe(false)
    expect(typeof r.message).toBe('string')
  })

  it('generate_tts returns "success: false" on empty input', async () => {
    const { ctx } = makeFakeCtx()
    const mod = await loadPlugin()
    await mod.apply(ctx as never)
    const t = ctx.tools.registered.find((x) => x.name === 'generate_tts')!
    const ac = new AbortController()
    const r = await t.def.execute({ text: '   ' }, { signal: ac.signal } as never)
    expect(r.success).toBe(false)
    expect(r.message).toMatch(/非空|empty/i)
  })

  it('generate_music returns "success: false" on empty input', async () => {
    const { ctx } = makeFakeCtx()
    const mod = await loadPlugin()
    await mod.apply(ctx as never)
    const t = ctx.tools.registered.find((x) => x.name === 'generate_music')!
    const ac = new AbortController()
    const r = await t.def.execute({ text: '' }, { signal: ac.signal } as never)
    expect(r.success).toBe(false)
  })

  it('generate_text returns "success: false" when ctx.llm is missing', async () => {
    const { ctx } = makeFakeCtx()
    const mod = await loadPlugin()
    await mod.apply(ctx as never)
    const t = ctx.tools.registered.find((x) => x.name === 'generate_text')!
    const ac = new AbortController()
    const r = await t.def.execute({ prompt: 'hi' }, { signal: ac.signal } as never)
    expect(r.success).toBe(false)
    expect(r.message).toMatch(/llm/i)
  })
})

describe('plugin apply — auto-discovers models from llm-pi-ai settings', () => {
  it('generate_image picks the auto-discovered image model and surfaces a clear env-var hint when apiKey is missing', async () => {
    const yaml = [
      'llm-pi-ai:',
      '  providers:',
      '    agnes:',
      '      apiKeyEnv: AGNES_API_KEY',
      '      baseURL: https://apihub.agnes-ai.com/v1',
      '      models:',
      '        - id: agnes-image-2.1-flash',
      '          name: Agnes Image 2.1 Flash',
      '',
    ].join('\n')

    const { ctx, setYaml, clearYaml } = makeFakeCtx({ yamlSettings: yaml })
    await setYaml(yaml)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_image')!
      const ac = new AbortController()
      delete process.env.AGNES_API_KEY
      const r = await t.def.execute({ prompt: 'a cat', model: '' }, { signal: ac.signal } as never)
      expect(r.success).toBe(false)
      // The error must mention the missing env var so the user knows where to set it.
      expect(r.message).toMatch(/AGNES_API_KEY|环境变量/)
    } finally {
      await clearYaml()
    }
  })

  it('generate_image fails with HTTP 401 surfaced from the upstream when apiKey is wrong (real fetch)', async () => {
    // Mock `fetch` so the test does not depend on the public internet. The
    // mock returns 401 for /images/generations. We then assert the plugin
    // surfaces the HTTP code in the user-visible message.
    const yaml = [
      'llm-pi-ai:',
      '  providers:',
      '    fake:',
      '      apiKeyEnv: FAKE_KEY',
      '      baseURL: https://api.fake.example/v1',
      '      models:',
      '        - id: agnes-image-2.1-flash',
      '          name: Fake Image Model',
      '',
    ].join('\n')
    const origFetch = (globalThis as any).fetch
    ;(globalThis as any).fetch = async (url: string) => {
      return new Response(JSON.stringify({ error: { message: 'unauthorized' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }
    process.env.FAKE_KEY = 'demo-key'
    const { ctx, setYaml, clearYaml } = makeFakeCtx({ yamlSettings: yaml })
    await setYaml(yaml)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_image')!
      const ac = new AbortController()
      const r = await t.def.execute({ prompt: 'a cat', model: '' }, { signal: ac.signal } as never)
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/401|unauthorized|图像生成失败/)
    } finally {
      ;(globalThis as any).fetch = origFetch
      delete process.env.FAKE_KEY
      await clearYaml()
    }
  })
})

describe('plugin apply — graceful fallback when the requested model is missing', () => {
  // These cover the "user passed a model id that is not configured" path.
  // The plugin must NEVER silently swap models without telling the user;
  // it must ALWAYS annotate the result message with what was requested,
  // what was used instead, and how to fix the config.
  const FALLBACK_YAML = [
    'llm-pi-ai:',
    '  providers:',
    '    agnes:',
    '      apiKeyEnv: AGNES_API_KEY',
    '      baseURL: https://apihub.agnes-ai.com/v1',
    '      models:',
    '        - id: agnes-image-2.1-flash',
    '          name: Agnes Image 2.1 Flash',
    '',
  ].join('\n')

  // 0.4 contract change: an explicitly requested id that is NOT in the
  // configured catalogue is an error, not a silent substitution. The error
  // names the rejected id AND lists what is actually available, so the fix
  // ("you probably meant agnes-image-2.1-flash") is one glance away.
  it('generate_image: model="flux" that is not configured is rejected with the candidate list', async () => {
    delete process.env.AGNES_API_KEY
    const { ctx, setYaml, clearYaml } = makeFakeCtx({ yamlSettings: FALLBACK_YAML })
    await setYaml(FALLBACK_YAML)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_image')!
      const ac = new AbortController()
      const r = await t.def.execute(
        { prompt: 'a cat', model: 'flux', n: 1, size: '1024x1024' },
        { signal: ac.signal } as never,
      )
      expect(r.success).toBe(false)
      // Names the id the caller actually asked for...
      expect(r.message).toMatch(/flux/)
      // ...and shows what is available instead.
      expect(r.message).toMatch(/agnes-image-2\.1-flash/)
      expect(r.message).toMatch(/当前候选/)
      // No model was served, so no "fell back to X" claim either.
      expect(r.message).not.toMatch(/已自动降级/)
    } finally {
      await clearYaml()
    }
  })

  // Same rule with a working API key and a live-looking fetch stub: the
  // plugin must not spend the request on a different model just because one
  // exists. Nothing is sent when the id is unknown.
  it('generate_image: model="flux" is rejected before any network call even when an image model exists', async () => {
    process.env.AGNES_API_KEY = 'demo-key'
    const origFetch = (globalThis as any).fetch
    let calls = 0
    ;(globalThis as any).fetch = async () => {
      calls += 1
      return new Response(
        JSON.stringify({ data: [{ url: 'https://cdn.example.com/a.png' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    const { ctx, setYaml, clearYaml } = makeFakeCtx({ yamlSettings: FALLBACK_YAML })
    await setYaml(FALLBACK_YAML)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_image')!
      const ac = new AbortController()
      const r = await t.def.execute(
        { prompt: 'a cat', model: 'flux', n: 1, size: '1024x1024' },
        { signal: ac.signal } as never,
      )
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/flux/)
      expect(r.message).toMatch(/agnes-image-2\.1-flash/)
      expect(calls).toBe(0)
    } finally {
      ;(globalThis as any).fetch = origFetch
      delete process.env.AGNES_API_KEY
      await clearYaml()
    }
  })

  it('generate_image: when model="flux" is requested but NO image model is configured at all, returns a single hard error naming "flux"', async () => {
    const yaml = [
      'llm-pi-ai:',
      '  providers:',
      '    text-only:',
      '      apiKeyEnv: TEXT_KEY',
      '      baseURL: https://api.text.example/v1',
      '      models:',
      '        - id: deepseek-chat',
      '          name: Chat',
      '',
    ].join('\n')
    process.env.TEXT_KEY = 'demo-key'
    const { ctx, setYaml, clearYaml } = makeFakeCtx({ yamlSettings: yaml })
    await setYaml(yaml)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_image')!
      const ac = new AbortController()
      const r = await t.def.execute(
        { prompt: 'a cat', model: 'flux', n: 1, size: '1024x1024' },
        { signal: ac.signal } as never,
      )
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/flux/)
      // Should NOT claim "未发现可用的图像模型" alone (without naming the
      // requested id) — the user needs to know which id was rejected.
      expect(r.message).toMatch(/未找到 id\/name 为 "flux" 的模型/)
    } finally {
      delete process.env.TEXT_KEY
      await clearYaml()
    }
  })

  it('generate_image: when NO model arg is passed and apiKey is missing, the plain env-var error fires WITHOUT a fallback warning', async () => {
    // Sanity check: the warning must only appear when the user actually
    // requested something we couldn't honour. The no-arg path is the
    // default and shouldn't carry the "you said X but I used Y" warning.
    delete process.env.AGNES_API_KEY
    const { ctx, setYaml, clearYaml } = makeFakeCtx({ yamlSettings: FALLBACK_YAML })
    await setYaml(FALLBACK_YAML)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_image')!
      const ac = new AbortController()
      const r = await t.def.execute(
        { prompt: 'a cat', model: '', n: 1, size: '1024x1024' },
        { signal: ac.signal } as never,
      )
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/AGNES_API_KEY|环境变量/)
      // The warning must NOT appear here — the user didn't request anything.
      expect(r.message).not.toMatch(/你指定的/)
      expect(r.message).not.toMatch(/已自动降级/)
    } finally {
      await clearYaml()
    }
  })

  // ── generate_text fallback scenarios ─────────────────────────────────
  //
  // generate_text takes the model arg in "<provider>/<model>" shape, so
  // the fallback has to be more nuanced than the bare-id tools: a typo
  // in EITHER half should still trigger the warning + auto-fallback.
  const TEXT_FALLBACK_YAML = [
    'llm-pi-ai:',
    '  providers:',
    '    deepseek:',
    '      apiKeyEnv: DEEPSEEK_API_KEY',
    '      baseURL: https://api.deepseek.com/v1',
    '      models:',
    '        - id: deepseek-chat',
    '          name: DeepSeek Chat',
    '    openai:',
    '      apiKeyEnv: OPENAI_API_KEY',
    '      baseURL: https://api.openai.com/v1',
    '      models:',
    '        - id: gpt-4o-mini',
    '          name: GPT-4o Mini',
    '',
  ].join('\n')

  // 0.4 contract change: a "<provider>/<model>" request that does not
  // resolve is reported, never redirected to another model. Both halves are
  // checked, so a typo in either one fails loudly with the candidate list.
  it('generate_text: model="<typo-provider>/deepseek-chat" fails with the candidate list and never calls a substitute', async () => {
    process.env.DEEPSEEK_API_KEY = 'demo-key'
    const llm = makeFakeLlm()
    const { ctx, setYaml, clearYaml } = makeFakeCtx({ yamlSettings: TEXT_FALLBACK_YAML, llm })
    await setYaml(TEXT_FALLBACK_YAML)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_text')!
      const ac = new AbortController()
      const r = await t.def.execute(
        { prompt: 'hi', model: 'typo/deepseek-chat' },
        { signal: ac.signal } as never,
      )
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/typo\/deepseek-chat/)
      expect(r.message).toMatch(/当前候选/)
      // The configured chat model is offered as a candidate, not used.
      expect(r.message).toMatch(/deepseek:deepseek-chat/)
      // Nothing was sent to any provider.
      expect(llm.calls.length).toBe(0)
    } finally {
      delete process.env.DEEPSEEK_API_KEY
      await clearYaml()
    }
  })

  it('generate_text: model="deepseek/<typo>" fails the same way (provider half correct)', async () => {
    process.env.DEEPSEEK_API_KEY = 'demo-key'
    const llm = makeFakeLlm()
    const { ctx, setYaml, clearYaml } = makeFakeCtx({ yamlSettings: TEXT_FALLBACK_YAML, llm })
    await setYaml(TEXT_FALLBACK_YAML)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_text')!
      const ac = new AbortController()
      const r = await t.def.execute(
        { prompt: 'hi', model: 'deepseek/gpt-5-unreleased' },
        { signal: ac.signal } as never,
      )
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/deepseek\/gpt-5-unreleased/)
      expect(r.message).toMatch(/当前候选/)
      expect(llm.calls.length).toBe(0)
    } finally {
      delete process.env.DEEPSEEK_API_KEY
      await clearYaml()
    }
  })

  it('generate_text: when NO model arg is passed, the call succeeds with NO warning field', async () => {
    // Sanity check: the no-arg path is the default and should not produce
    // a spurious "you said X but I used Y" warning.
    process.env.DEEPSEEK_API_KEY = 'demo-key'
    const llm = makeFakeLlm()
    const { ctx, setYaml, clearYaml } = makeFakeCtx({ yamlSettings: TEXT_FALLBACK_YAML, llm })
    await setYaml(TEXT_FALLBACK_YAML)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_text')!
      const ac = new AbortController()
      const r = await t.def.execute(
        { prompt: 'hi', model: '' },
        { signal: ac.signal } as never,
      )
      expect(r.success).toBe(true)
      expect(r.model).toBe('deepseek/deepseek-chat')
      // No warning field at all on the no-arg path.
      expect(r.warning).toBeUndefined()
    } finally {
      delete process.env.DEEPSEEK_API_KEY
      await clearYaml()
    }
  })

  it('generate_text: an unresolvable id fails before any apiKey check', async () => {
    // Ordering matters: reporting "missing model" beats reporting "missing
    // DEEPSEEK_API_KEY" — otherwise the user fixes the env var and still
    // gets nowhere.
    delete process.env.DEEPSEEK_API_KEY
    delete process.env.OPENAI_API_KEY
    const llm = makeFakeLlm()
    const { ctx, setYaml, clearYaml } = makeFakeCtx({ yamlSettings: TEXT_FALLBACK_YAML, llm })
    await setYaml(TEXT_FALLBACK_YAML)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_text')!
      const ac = new AbortController()
      const r = await t.def.execute(
        { prompt: 'hi', model: 'typo/deepseek-chat' },
        { signal: ac.signal } as never,
      )
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/typo\/deepseek-chat/)
      expect(r.message).not.toMatch(/DEEPSEEK_API_KEY/)
      expect(llm.calls.length).toBe(0)
    } finally {
      await clearYaml()
    }
  })

  it('generate_text: when model="typo/whatever" is requested AND no text model exists at all, returns a hard error naming the requested id', async () => {
    // Image-only fixture: no text models. The caller passed a wrong id,
    // AND there's no fallback. Error must name the rejected id explicitly.
    const yaml = [
      'llm-pi-ai:',
      '  providers:',
      '    agnes:',
      '      apiKeyEnv: AGNES_API_KEY',
      '      baseURL: https://api.agnes.example/v1',
      '      models:',
      '        - id: agnes-image-2.1-flash',
      '          name: Agnes Image',
      '',
    ].join('\n')
    process.env.AGNES_API_KEY = 'demo-key'
    const llm = makeFakeLlm()
    const { ctx, setYaml, clearYaml } = makeFakeCtx({ yamlSettings: yaml, llm })
    await setYaml(yaml)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_text')!
      const ac = new AbortController()
      const r = await t.def.execute(
        { prompt: 'hi', model: 'typo/whatever' },
        { signal: ac.signal } as never,
      )
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/typo\/whatever/)
      // prepareCall never reached because there is no text fallback.
      expect(llm.calls.length).toBe(0)
    } finally {
      delete process.env.AGNES_API_KEY
      await clearYaml()
    }
  })
})

// ── Protocol guard: 4 OpenAI-REST multimodal tools reject non-openai apiProtocol ──
//
// generate_text is intentionally NOT guarded — it routes through the harness's
// LlmRuntime (`ctx.llm.prepareCall`) which already speaks Claude / OpenAI /
// Anthropic / etc. The 4 multimodal tools call OpenAI-compatible REST endpoints
// directly (`/images/generations`, `/videos`, `/audio/speech`), so any non-openai
// apiProtocol must surface an actionable error before the network round-trip.
describe('plugin apply — OpenAI-protocol guard on the four multimodal tools', () => {
  const NON_OPENAI_YAML = [
    'llm-pi-ai:',
    '  providers:',
    '    claude-only:',
    '      apiProtocol: claude',
    '      apiKeyEnv: CLAUDE_KEY',
    '      baseURL: https://api.anthropic.example/v1',
    '      models:',
    '        - id: agnes-image-2.1-flash',
    '          name: Image',
    '        - id: agnes-video-2.5-flash',
    '          name: Video',
    '        - id: local-cosyvoice-tts',
    '          name: TTS',
    '        - id: local-musicgen',
    '          name: Music',
    '',
  ].join('\n')

  const setup = async () => {
    process.env.CLAUDE_KEY = 'demo-key'
    const { ctx, setYaml, clearYaml } = makeFakeCtx({ yamlSettings: NON_OPENAI_YAML })
    await setYaml(NON_OPENAI_YAML)
    return { ctx, clearYaml }
  }
  const teardown = async (clearYaml: () => Promise<void>) => {
    delete process.env.CLAUDE_KEY
    await clearYaml()
  }

  it('generate_image: rejects apiProtocol="claude" with an actionable error', async () => {
    const { ctx, clearYaml } = await setup()
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_image')!
      const r = await t.def.execute({ prompt: 'a cat', model: '' }, { signal: new AbortController().signal } as never)
      expect(r.success).toBe(false)
      // The error must name the model + the rejected protocol + the OpenAI endpoints.
      expect(r.message).toMatch(/apiProtocol="claude"/)
      expect(r.message).toMatch(/OpenAI/)
      expect(r.message).toMatch(/images\/generations|\/videos|audio\/speech/)
    } finally {
      await teardown(clearYaml)
    }
  })

  it('generate_video: rejects apiProtocol="claude" with an actionable error', async () => {
    const { ctx, clearYaml } = await setup()
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_video')!
      const r = await t.def.execute({ prompt: 'pan' }, { signal: new AbortController().signal } as never)
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/apiProtocol="claude"/)
      expect(r.message).toMatch(/OpenAI/)
    } finally {
      await teardown(clearYaml)
    }
  })

  it('generate_tts: rejects apiProtocol="claude" with an actionable error', async () => {
    const { ctx, clearYaml } = await setup()
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_tts')!
      const r = await t.def.execute({ text: 'hello' }, { signal: new AbortController().signal } as never)
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/apiProtocol="claude"/)
      expect(r.message).toMatch(/OpenAI/)
    } finally {
      await teardown(clearYaml)
    }
  })

  it('generate_music: rejects apiProtocol="claude" with an actionable error', async () => {
    const { ctx, clearYaml } = await setup()
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_music')!
      const r = await t.def.execute({ text: 'song' }, { signal: new AbortController().signal } as never)
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/apiProtocol="claude"/)
      expect(r.message).toMatch(/OpenAI/)
    } finally {
      await teardown(clearYaml)
    }
  })

  it('generate_image: ACCEPTS apiProtocol="openai" — no protocol rejection', async () => {
    // Sanity: the empty / "openai" / "OpenAI" / "OPENAI" forms must all pass
    // the guard, otherwise every existing llm-pi-ai provider breaks.
    const OPENAI_YAML = [
      'llm-pi-ai:',
      '  providers:',
      '    openai:',
      '      apiProtocol: openai',
      '      apiKeyEnv: OAI_KEY',
      '      baseURL: https://api.openai.example/v1',
      '      models:',
      '        - id: agnes-image-2.1-flash',
      '          name: Image',
      '',
    ].join('\n')
    process.env.OAI_KEY = 'demo-key'
    const origFetch = (globalThis as any).fetch
    ;(globalThis as any).fetch = async () =>
      new Response(JSON.stringify({ data: [{ url: 'https://x.com/a.png' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    const { ctx, setYaml, clearYaml } = makeFakeCtx({ yamlSettings: OPENAI_YAML })
    await setYaml(OPENAI_YAML)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_image')!
      const r = await t.def.execute({ prompt: 'a cat', model: '' }, { signal: new AbortController().signal } as never)
      expect(r.success).toBe(true)
      expect(r.message ?? '').not.toMatch(/apiProtocol/)
    } finally {
      ;(globalThis as any).fetch = origFetch
      delete process.env.OAI_KEY
      await clearYaml()
    }
  })

  it('generate_text: does NOT reject non-openai apiProtocol (text routes via harness LlmRuntime)', async () => {
    // generate_text uses `ctx.llm.prepareCall` which is the harness's own
    // multi-protocol router (OpenAI / Claude / Anthropic / ...). Rejecting
    // non-openai apiProtocol here would break Claude / Anthropic text
    // models that the harness already supports, so the plugin intentionally
    // does NOT guard generate_text.
    const TEXT_YAML = [
      'llm-pi-ai:',
      '  providers:',
      '    claude-only:',
      '      apiProtocol: claude',
      '      apiKeyEnv: CLAUDE_KEY',
      '      baseURL: https://api.anthropic.example/v1',
      '      models:',
      '        - id: claude-sonnet-4-5',
      '          name: Claude',
      '',
    ].join('\n')
    process.env.CLAUDE_KEY = 'demo-key'
    const llm = makeFakeLlm()
    const { ctx, setYaml, clearYaml } = makeFakeCtx({ yamlSettings: TEXT_YAML, llm })
    await setYaml(TEXT_YAML)
    try {
      const mod = await loadPlugin()
      await mod.apply(ctx as never)
      const t = ctx.tools.registered.find((x) => x.name === 'generate_text')!
      const r = await t.def.execute({ prompt: 'hi', model: '' }, { signal: new AbortController().signal } as never)
      // prepareCall was reached — the guard did NOT fire.
      expect(r.success).toBe(true)
      expect(llm.calls.length).toBe(1)
      // And the message must NOT contain the protocol-rejection wording.
      expect(r.message ?? '').not.toMatch(/apiProtocol="claude"/)
    } finally {
      delete process.env.CLAUDE_KEY
      await clearYaml()
    }
  })
})
