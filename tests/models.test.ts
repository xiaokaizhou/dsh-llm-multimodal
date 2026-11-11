/**
 * Tests for the per-modality model grouping used by the new settings
 * card dropdowns. The card filters models strictly by modality: a Text
 * picker shows only text models, Image only images, etc.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildModelsSnapshot, pickForTool } from '../lib/index.js'

async function writeYaml(content) {
  const dir = join(tmpdir(), 'llm-multimodal-models-' + Date.now())
  await mkdir(dir, { recursive: true })
  const p = join(dir, 'settings.yaml')
  await writeFile(p, content, 'utf8')
  process.env.DSH_SETTINGS_PATH = p
  return p
}

describe('buildModelsSnapshot — provider + per-modality grouping', () => {
  let savedPath

  beforeEach(() => {
    savedPath = process.env.DSH_SETTINGS_PATH
  })

  afterEach(() => {
    if (savedPath === undefined) delete process.env.DSH_SETTINGS_PATH
    else process.env.DSH_SETTINGS_PATH = savedPath
  })

  it('groups every model under its provider id and bucketed by modality', async () => {
    await writeYaml([
      'llm-pi-ai:',
      '  providers:',
      '    agnes:',
      '      displayName: Agnes',
      '      apiKeyEnv: AGNES_API_KEY',
      '      baseURL: https://apihub.agnes-ai.com/v1',
      '      models:',
      '        - id: agnes-image-2.1-flash',
      '          name: Agnes Image Flash',
      '        - id: agnes-video-2.5-flash',
      '          name: Agnes Video Flash',
      '        - id: agnes-text-01',
      '          name: Agnes Text',
      '        - id: minimax-speech-02-hd',
      '          name: Agnes Speech HD',
      '    openai:',
      '      displayName: OpenAI',
      '      apiKeyEnv: OPENAI_API_KEY',
      '      baseURL: https://api.openai.com/v1',
      '      models:',
      '        - id: gpt-image-1',
      '          name: GPT Image',
      '        - id: gpt-4o-mini',
      '          name: GPT-4o mini',
      '',
    ].join('\n'))

    const snap = await buildModelsSnapshot({ resolve: async () => ({ value: '' }) })

    // Two provider rows
    expect(snap.providers).toHaveLength(2)
    expect(snap.providers.map((p) => p.id).sort()).toEqual(['agnes', 'openai'])
    expect(snap.providers[0].baseURL).toBe('https://apihub.agnes-ai.com/v1')
    expect(snap.providers[0].apiKeyEnv).toBe('AGNES_API_KEY')

    // Per-modality buckets — verify counts match classification
    const buckets = snap.byModality
    expect(buckets.image.map((m) => m.id).sort()).toEqual(['agnes-image-2.1-flash', 'gpt-image-1'])
    expect(buckets.video.map((m) => m.id).sort()).toEqual(['agnes-video-2.5-flash'])
    expect(buckets.text.map((m) => m.id).sort()).toEqual(['agnes-text-01', 'gpt-4o-mini'])
    expect(buckets.tts.map((m) => m.id).sort()).toEqual(['minimax-speech-02-hd'])
    expect(buckets.music).toEqual([])
    // `gpt-4o-mini` is a *multimodal chat* model: it stays in the text
    // bucket AND appears under vision. Single-label bucketing could not
    // express that, which is why `byModality` is now built from
    // `modalities` instead of `type`.
    expect(buckets.vision.map((m) => m.id).sort()).toEqual(['gpt-4o-mini'])

    // Every model also carries its provider id so the client can render
    // <optgroup> rows per provider.
    expect(buckets.image[0]).toHaveProperty('provider')
    expect(buckets.image[0].provider).toMatch(/agnes|openai/)
  })

  it('returns empty buckets when no llm-pi-ai section exists', async () => {
    await writeYaml('settings:\n  hello: world\n')
    const snap = await buildModelsSnapshot({ resolve: async () => ({ value: '' }) })
    expect(snap.providers).toEqual([])
    expect(snap.byModality).toEqual({
      text: [], image: [], video: [], vision: [], tts: [], music: [],
    })
  })

  it('omits providers with empty models arrays', async () => {
    await writeYaml([
      'llm-pi-ai:',
      '  providers:',
      '    empty:',
      '      baseURL: https://empty.example.com/v1',
      '      models: []',
      '    agnes:',
      '      baseURL: https://apihub.agnes-ai.com/v1',
      '      models:',
      '        - id: agnes-video-2.5-flash',
      '          name: Agnes Video',
      '',
    ].join('\n'))
    const snap = await buildModelsSnapshot({ resolve: async () => ({ value: '' }) })
    expect(snap.providers.map((p) => p.id)).toEqual(['agnes'])
    expect(snap.byModality.video).toHaveLength(1)
  })

  it('falls back to provider id for displayName when missing', async () => {
    await writeYaml([
      'llm-pi-ai:',
      '  providers:',
      '    agnes:',
      '      baseURL: https://apihub.agnes-ai.com/v1',
      '      models:',
      '        - id: agnes-image-2.1-flash',
      '',
    ].join('\n'))
    const snap = await buildModelsSnapshot({ resolve: async () => ({ value: '' }) })
    expect(snap.providers[0].displayName).toBe('agnes')
    expect(snap.providers[0].id).toBe('agnes')
  })

  it('routes vision-classified ids (qwen-vl / gpt-4o-vision / llava) into the vision bucket', async () => {
    await writeYaml([
      'llm-pi-ai:',
      '  providers:',
      '    openai:',
      '      baseURL: https://api.openai.com/v1',
      '      models:',
      '        - id: gpt-4o-vision',
      '          name: GPT-4o Vision',
      '    qwen:',
      '      baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1',
      '      models:',
      '        - id: qwen-vl-plus',
      '          name: Qwen VL Plus',
      '        - id: qwen-7b-chat',
      '          name: Qwen 7B Chat',
      '    local:',
      '      baseURL: http://localhost:11434/v1',
      '      models:',
      '        - id: llava-1.5-7b',
      '          name: LLaVA 1.5',
      '',
    ].join('\n'))
    const snap = await buildModelsSnapshot({ resolve: async () => ({ value: '' }) })
    // The vision bucket must contain ONLY the VL-classified rows; bare
    // qwen-7b-chat must NOT leak in (it stays in text).
    expect(snap.byModality.vision.map((m) => m.id).sort()).toEqual([
      'gpt-4o-vision',
      'llava-1.5-7b',
      'qwen-vl-plus',
    ])
    // Vision rows are chat models too, so they also serve generate_text.
    expect(snap.byModality.text.map((m) => m.id).sort()).toEqual([
      'gpt-4o-vision',
      'llava-1.5-7b',
      'qwen-7b-chat',
      'qwen-vl-plus',
    ])
    // Each vision row carries its provider so the UI can render <optgroup>.
    for (const m of snap.byModality.vision) {
      expect(m.provider).toMatch(/openai|qwen|local/)
    }
  })

  // Regression: ~/models 网关把 local-h3 / local-h3c / local-minimax-h3 都
  // 路由到 MiniMax-H3（视频生成器）。id 中没有 "video" 关键字，旧版会被
  // 错认为 text（h3 / h3c）或 tts（minimax 关键字），于是视频下拉框里看不到。
  // 修复后必须全部进 video 桶。
  it('routes local MiniMax Hailuo h3 family ids into the video bucket', async () => {
    await writeYaml([
      'llm-pi-ai:',
      '  providers:',
      '    local:',
      '      displayName: Local (M5 Pro)',
      '      baseURL: http://127.0.0.1:8000/v1',
      '      models:',
      '        - id: local-h3c',
      '          name: H3C 视频生成 (本地)',
      '        - id: local-h3',
      '          name: MiniMax-H3 视频生成 (本地)',
      '        - id: local-minimax-h3',
      '          name: MiniMax Hailuo 视频生成 (本地)',
      '        - id: local-hailuo-pro',
      '          name: Hailuo Pro 视频生成 (本地)',
      '',
    ].join('\n'))
    const snap = await buildModelsSnapshot({ resolve: async () => ({ value: '' }) })
    expect(snap.byModality.video.map((m) => m.id).sort()).toEqual([
      'local-h3',
      'local-h3c',
      'local-hailuo-pro',
      'local-minimax-h3',
    ])
    // None of them leaked into the wrong bucket.
    expect(snap.byModality.text.find((m) => m.id === 'local-h3')).toBeUndefined()
    expect(snap.byModality.tts.find((m) => m.id === 'local-minimax-h3')).toBeUndefined()
  })
})

describe('pickForTool — auto-pick stays callable', () => {
  const rows = [
    // A harness-routed provider: listed, but no endpoint to call.
    { provider: 'minimax-cn', id: 'MiniMax-M3', name: 'MiniMax M3', modalities: ['text', 'vision'], baseURL: '' },
    { provider: 'saygm', id: 'claude-opus-5', name: 'Claude Opus 5', modalities: ['text', 'vision'], baseURL: 'https://api.saygm.com/v1' },
  ]

  it('skips a row without baseURL when auto-picking', () => {
    expect(pickForTool(rows, 'vision').model?.id).toBe('claude-opus-5')
  })

  it('keeps an explicitly named row so the caller gets the precise error', () => {
    expect(pickForTool(rows, 'vision', 'MiniMax-M3').model?.id).toBe('MiniMax-M3')
  })

  it('falls back to the first row when nothing is callable', () => {
    const noEndpoint = [{ provider: 'x', id: 'y', modalities: ['image'], baseURL: '' }]
    expect(pickForTool(noEndpoint, 'image').model?.id).toBe('y')
  })
})
