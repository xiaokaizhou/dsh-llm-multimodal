/**
 * Tests for the per-modality model grouping used by the new settings
 * card dropdowns. The card filters models strictly by modality: a Text
 * picker shows only text models, Image only images, etc.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildModelsSnapshot } from '../lib/index.js'

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
      text: [], image: [], video: [], tts: [], music: [],
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
})
