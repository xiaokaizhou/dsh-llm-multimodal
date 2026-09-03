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
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface RecordedTool {
  name: string
  description: string
  def: unknown
}

async function loadPlugin() {
  return await import('../lib/index.js')
}

function makeFakeCtx(opts: {
  yamlSettings?: string
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
      llm: undefined,
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

describe('plugin apply — registers all five generator tools', () => {
  it('registers generate_text, generate_image, generate_video, generate_tts, generate_music', async () => {
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
