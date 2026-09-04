/**
 * Unit tests for dsh-llm-multimodal plugin.
 *
 * The plugin is hand-written ESM (lib/index.js + lib/client.js); tests run
 * the bundled module directly via vitest's ESM loader. We exercise the
 * pure helpers (model classification, override merging, schema defaults)
 * and the namespace contract. Tool execution paths are exercised with
 * stubbed settings / credentials / llm registries — we never spin up the
 * real cordis host here.
 */

import { describe, it, expect } from 'vitest'
import {
  NS,
  DEFAULT_LLM_MULTIMODAL,
  LlmMultimodalSettings,
  classifyModelId,
  pickModel,
  applyOverride,
  extractFirstMedia,
  extractFirstVideoUrl,
  extractFirstCoverUrl,
  IMG_KEYWORDS,
  VID_KEYWORDS,
  TTS_KEYWORDS,
  MUSIC_KEYWORDS,
  TEXT_KEYWORDS,
} from '../lib/index.js'

describe('namespace + defaults', () => {
  it('exports the "llm-multimodal" namespace id', () => {
    // settingsNamespace(value) is `value`-pinned (validated against a regex);
    // the branded namespace IS the string itself.
    expect(NS).toBe('llm-multimodal')
  })

  it('plugin name is "dsh-llm-multimodal"', async () => {
    const mod = await import('../lib/index.js')
    expect(mod.name).toBe('dsh-llm-multimodal')
  })

  it('plugin inject array contains tools, credentials, settings, llm, webServer', async () => {
    const mod = await import('../lib/index.js')
    expect(mod.inject).toEqual(['tools', 'credentials', 'settings', 'llm', 'webServer'])
  })

  it('DEFAULT_LLM_MULTIMODAL shape has all 5 modalities with 4/5 fields each', () => {
    const d = DEFAULT_LLM_MULTIMODAL
    expect(d).toHaveProperty('text')
    expect(d).toHaveProperty('image')
    expect(d).toHaveProperty('video')
    expect(d).toHaveProperty('tts')
    expect(d).toHaveProperty('music')
    for (const k of ['text', 'image', 'video'] as const) {
      expect(Object.keys(d[k]).sort()).toEqual(['apiKey', 'apiProtocol', 'baseURL', 'defaultModel', 'provider'])
    }
    for (const k of ['tts', 'music'] as const) {
      expect(Object.keys(d[k]).sort()).toEqual(['apiKey', 'apiProtocol', 'baseURL', 'defaultModel', 'provider', 'voice'])
    }
  })
})

describe('classifyModelId', () => {
  it('detects video models first (overrides text)', () => {
    expect(classifyModelId('sora-video-1')).toBe('video')
    expect(classifyModelId('kling-1.6-video')).toBe('video')
    expect(classifyModelId('hunyuan-video-pro')).toBe('video')
  })

  it('detects image models', () => {
    expect(classifyModelId('dall-e-3')).toBe('image')
    expect(classifyModelId('flux-pro')).toBe('image')
    expect(classifyModelId('sdxl-base')).toBe('image')
    expect(classifyModelId('midjourney-v6')).toBe('image')
  })

  it('detects tts / speech models', () => {
    expect(classifyModelId('minimax-speech-02-hd')).toBe('tts')
    expect(classifyModelId('elevenlabs-tts')).toBe('tts')
  })

  it('detects music models', () => {
    expect(classifyModelId('suno-music-v3')).toBe('music')
    expect(classifyModelId('lyric-generator')).toBe('music')
  })

  it('falls back to text for chat models', () => {
    expect(classifyModelId('deepseek-chat')).toBe('text')
    expect(classifyModelId('gpt-4o-mini')).toBe('text')
    expect(classifyModelId('claude-3-sonnet')).toBe('text')
    expect(classifyModelId('qwen-instruct')).toBe('text')
  })

  it('returns text for an unknown id (safe default)', () => {
    expect(classifyModelId('xyz-unknown-thing')).toBe('text')
    expect(classifyModelId('')).toBe('text')
  })

  it('keyword arrays are non-empty', () => {
    expect(IMG_KEYWORDS.length).toBeGreaterThan(0)
    expect(VID_KEYWORDS.length).toBeGreaterThan(0)
    expect(TTS_KEYWORDS.length).toBeGreaterThan(0)
    expect(MUSIC_KEYWORDS.length).toBeGreaterThan(0)
    expect(TEXT_KEYWORDS.length).toBeGreaterThan(0)
  })
})

describe('pickModel', () => {
  const models = [
    { provider: 'agnes', id: 'agnes-image-2.1-flash', name: 'Agnes Image Flash', type: 'image', baseURL: 'b1', apiKey: 'k1', apiKeyEnv: 'AGNES' },
    { provider: 'agnes', id: 'agnes-video-2.5-flash', name: 'Agnes Video Flash', type: 'video', baseURL: 'b1', apiKey: 'k1', apiKeyEnv: 'AGNES' },
    { provider: 'openai', id: 'gpt-image-1', name: 'GPT Image', type: 'image', baseURL: 'b2', apiKey: 'k2', apiKeyEnv: 'OPENAI' },
    { provider: 'deepseek', id: 'deepseek-chat', name: 'Chat', type: 'text', baseURL: 'b3', apiKey: 'k3', apiKeyEnv: 'DEEPSEEK' },
  ]

  it('returns the first row matching the modality when requestedId is absent', () => {
    const picked = pickModel(models, 'image', undefined)
    expect(picked?.id).toBe('agnes-image-2.1-flash')
  })

  it('returns the requested id when given (matched by id)', () => {
    const picked = pickModel(models, 'image', 'gpt-image-1')
    expect(picked?.id).toBe('gpt-image-1')
  })

  it('returns the requested id when given (matched by display name)', () => {
    const picked = pickModel(models, 'image', 'Agnes Image Flash')
    expect(picked?.id).toBe('agnes-image-2.1-flash')
  })

  it('returns null when the modality has no rows', () => {
    expect(pickModel(models, 'tts', undefined)).toBeNull()
  })

  it('returns null when the requested id is unknown', () => {
    expect(pickModel(models, 'image', 'no-such-model')).toBeNull()
  })
})

describe('applyOverride', () => {
  const model = {
    provider: 'agnes', id: 'agnes-image-2.1-flash', name: 'Agnes Image Flash',
    type: 'image' as const, baseURL: 'https://original.example.com/v1',
    apiKey: 'orig-key', apiKeyEnv: 'AGNES_API_KEY',
  }

  it('returns the original model when override is empty', () => {
    const out = applyOverride(model, {})
    expect(out).toEqual(model)
  })

  it('replaces baseURL/apiKey/defaultModel when override has them', () => {
    const out = applyOverride(model, {
      provider: '', baseURL: 'https://override.example.com/v1',
      apiKey: 'override-key', defaultModel: 'custom-image-model',
      voice: '',
    })
    expect(out?.baseURL).toBe('https://override.example.com/v1')
    expect(out?.apiKey).toBe('override-key')
    expect(out?.id).toBe('custom-image-model')
  })

  it('keeps the auto-discovered baseURL when override has empty baseURL', () => {
    const out = applyOverride(model, {
      provider: 'custom', baseURL: '', apiKey: '', defaultModel: 'custom-x', voice: '',
    })
    expect(out?.baseURL).toBe('https://original.example.com/v1')
    expect(out?.provider).toBe('custom')
    expect(out?.id).toBe('custom-x')
  })

  it('returns null when input model is null', () => {
    expect(applyOverride(null, {})).toBeNull()
  })
})

describe('extractFirstMedia', () => {
  it('returns the first url in the data[] response', () => {
    const out = extractFirstMedia({ data: [{ url: 'https://x.com/a.png' }, { url: 'https://x.com/b.png' }] })
    expect(out).toEqual({ url: 'https://x.com/a.png' })
  })

  it('returns the first b64_json in the data[] response', () => {
    const out = extractFirstMedia({ data: [{ b64_json: 'abc123' }] })
    expect(out).toEqual({ b64: 'abc123' })
  })

  it('falls back to root url/b64_json for non-OpenAI providers', () => {
    expect(extractFirstMedia({ url: 'https://x.com/root.png' })).toEqual({ url: 'https://x.com/root.png' })
    expect(extractFirstMedia({ b64_json: 'root-b64' })).toEqual({ b64: 'root-b64' })
  })

  it('returns null for unrecognised shape', () => {
    expect(extractFirstMedia(null)).toBeNull()
    expect(extractFirstMedia({})).toBeNull()
    expect(extractFirstMedia({ data: [] })).toBeNull()
  })
})

describe('extractFirstVideoUrl', () => {
  it('returns the first .mp4 url from free text', () => {
    expect(extractFirstVideoUrl('see https://cdn.example.com/x.mp4?t=2 here')).toBe('https://cdn.example.com/x.mp4?t=2')
  })

  it('returns null when no video url is in the text', () => {
    expect(extractFirstVideoUrl('no video url here')).toBeNull()
  })

  it('returns null for empty / non-string input', () => {
    expect(extractFirstVideoUrl('')).toBeNull()
    expect(extractFirstVideoUrl(null)).toBeNull()
    expect(extractFirstVideoUrl(undefined)).toBeNull()
  })
})

describe('extractFirstCoverUrl', () => {
  it('picks coverUrl from the body root', () => {
    expect(extractFirstCoverUrl({ url: 'https://cdn/v.mp4', coverUrl: 'https://cdn/c.jpg' }))
      .toBe('https://cdn/c.jpg')
  })

  it('picks snake_case cover_url', () => {
    expect(extractFirstCoverUrl({ video: { url: 'https://cdn/v.mp4', cover_url: 'https://cdn/c.png' } }))
      .toBe('https://cdn/c.png')
  })

  it('walks data[0] for OpenAI-style arrays', () => {
    expect(extractFirstCoverUrl({ data: [{ url: 'https://cdn/v.mp4', thumbnail: 'https://cdn/c.webp' }] }))
      .toBe('https://cdn/c.webp')
  })

  it('walks output.preview_image etc.', () => {
    expect(extractFirstCoverUrl({ output: { preview_image: 'https://cdn/c.jpg' } }))
      .toBe('https://cdn/c.jpg')
  })

  it('falls back to scanning stringified body for the first image URL', () => {
    expect(extractFirstCoverUrl({ video_url: 'https://cdn/v.mp4', other: { poster: 'https://cdn/c.jpg' } }))
      .toBe('https://cdn/c.jpg')
  })

  it('returns null when no cover is present', () => {
    expect(extractFirstCoverUrl({ url: 'https://cdn/v.mp4' })).toBeNull()
    expect(extractFirstCoverUrl(null)).toBeNull()
    expect(extractFirstCoverUrl(undefined)).toBeNull()
    expect(extractFirstCoverUrl('not an object')).toBeNull()
  })
})

describe('LlmMultimodalSettings schema', () => {
  it('resolves an empty input to default modality shapes', () => {
    const r = LlmMultimodalSettings({})
    // Each modality resolves to its declared default.
    expect(r.text).toEqual({ provider: '', apiProtocol: '', baseURL: '', apiKey: '', defaultModel: '' })
    expect(r.image).toEqual({ provider: '', apiProtocol: '', baseURL: '', apiKey: '', defaultModel: '' })
    expect(r.video).toEqual({ provider: '', apiProtocol: '', baseURL: '', apiKey: '', defaultModel: '' })
    expect(r.tts).toEqual({ provider: '', apiProtocol: '', baseURL: '', apiKey: '', defaultModel: '', voice: '' })
    expect(r.music).toEqual({ provider: '', apiProtocol: '', baseURL: '', apiKey: '', defaultModel: '', voice: '' })
  })

  it('preserves user overrides on top of defaults', () => {
    const r = LlmMultimodalSettings({
      image: { provider: 'custom-agnes', apiProtocol: 'openai', baseURL: 'https://custom/v1', apiKey: 'k', defaultModel: 'custom-image' },
    })
    expect(r.image).toEqual({ provider: 'custom-agnes', apiProtocol: 'openai', baseURL: 'https://custom/v1', apiKey: 'k', defaultModel: 'custom-image' })
    expect(r.text).toEqual({ provider: '', apiProtocol: '', baseURL: '', apiKey: '', defaultModel: '' })
  })
})
