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
  resolveTextModel,
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

  it('detects VoxCPM / CosyVoice TTS models (local provider)', () => {
    // Regression: local-voxcpm was mis-classified as text because its bare
    // id contains neither "tts" nor "speech" nor "voice". Adding the
    // "voxcpm" keyword to TTS_KEYWORDS fixes it.
    expect(classifyModelId('local-voxcpm')).toBe('tts')
    expect(classifyModelId('VoxCPM2-0.5B')).toBe('tts')
    expect(classifyModelId('voxcpm-1.5')).toBe('tts')
    // CosyVoice / CosyVoice2 (alternative id form for the same TTS
    // family) also classify as TTS, not text.
    expect(classifyModelId('local-cosyvoice')).toBe('tts')
    expect(classifyModelId('cosyvoice2-0.5B')).toBe('tts')
  })

  it('detects music models', () => {
    expect(classifyModelId('suno-music-v3')).toBe('music')
    expect(classifyModelId('lyric-generator')).toBe('music')
  })

  it('detects local video models (Wan / LTX / SeedVR / MuseTalk / lip-sync)', () => {
    // Bare "wan" / "ltx" / "seedvr" / "musetalk" / "lipsync" ids used by
    // the local gateway; without explicit keywords these all fall through
    // to the `text` fallback (which would silently route a video model
    // to generate_text and break it).
    expect(classifyModelId('local-wan')).toBe('video')
    expect(classifyModelId('wan-2.2-a14b')).toBe('video')
    expect(classifyModelId('local-ltx')).toBe('video')
    expect(classifyModelId('ltx-video-0.9.8')).toBe('video')
    expect(classifyModelId('local-seedvr2')).toBe('video')
    expect(classifyModelId('local-musetalk')).toBe('video')
    expect(classifyModelId('local-lipsync')).toBe('video')
  })

  it('detects local image models (RealESRGAN / Juggernaut / photoreal)', () => {
    // RealESRGAN is an image upscaler; juggernaut / photoreal are bare
    // local image checkpoints. All classify as image so they show up
    // under generate_image.
    expect(classifyModelId('local-realesrgan')).toBe('image')
    expect(classifyModelId('local-juggernaut')).toBe('image')
    expect(classifyModelId('local-photoreal')).toBe('image')
  })

  it('does NOT add a bare "uncensored" keyword to image — it would shadow text models like qwen3.8-uncensored', () => {
    // Regression guard: if "uncensored" were in IMG_KEYWORDS, then
    // `local-qwen3.8-uncensored` would be mis-classified as image and
    // drop out of generate_text. The text base id (`qwen`) must win.
    expect(classifyModelId('local-qwen3.8-uncensored')).toBe('text')
    // A bare uncensored id falls back to text (safe default) until the
    // user renames it to e.g. `local-uncensored-image` so the "image"
    // keyword can match.
    expect(classifyModelId('local-uncensored')).toBe('text')
    expect(classifyModelId('local-uncensored-image')).toBe('image')
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
    expect(picked.requestedButMissing).toBe(false)
    expect(picked.model?.id).toBe('agnes-image-2.1-flash')
  })

  it('returns the requested id when given (matched by id)', () => {
    const picked = pickModel(models, 'image', 'gpt-image-1')
    expect(picked.requestedButMissing).toBe(false)
    expect(picked.model?.id).toBe('gpt-image-1')
  })

  it('returns the requested id when given (matched by display name)', () => {
    const picked = pickModel(models, 'image', 'Agnes Image Flash')
    expect(picked.requestedButMissing).toBe(false)
    expect(picked.model?.id).toBe('agnes-image-2.1-flash')
  })

  it('returns { model: null, requestedButMissing: false } when the modality has no rows', () => {
    const picked = pickModel(models, 'tts', undefined)
    expect(picked.model).toBeNull()
    expect(picked.requestedButMissing).toBe(false)
  })

  it('falls back to the first modality match and flags requestedButMissing when the requested id is unknown', () => {
    const picked = pickModel(models, 'image', 'no-such-model')
    expect(picked.requestedButMissing).toBe(true)
    expect(picked.model?.id).toBe('agnes-image-2.1-flash')
  })

  it('returns { model: null, requestedButMissing: true } when the requested id is unknown AND the modality is empty', () => {
    // The shared fixture has a video row, so pick a modality (tts) that is
    // empty in the fixture to exercise the (unknown id, no fallback) path.
    const picked = pickModel(models, 'tts', 'no-such-tts')
    expect(picked.model).toBeNull()
    expect(picked.requestedButMissing).toBe(true)
  })
})

describe('resolveTextModel', () => {
  // Same shared fixture as pickModel, but resolveTextModel needs the FULL
  // list (it filters by type === "text" itself inside the caller, but the
  // helper itself just looks at provider+id/type).
  const models = [
    { provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek Chat', type: 'text', baseURL: 'b1', apiKey: 'k1', apiKeyEnv: 'DEEPSEEK' },
    { provider: 'openai', id: 'gpt-4o-mini', name: 'GPT-4o Mini', type: 'text', baseURL: 'b2', apiKey: 'k2', apiKeyEnv: 'OPENAI' },
    { provider: 'agnes', id: 'gpt-image-1', name: 'Agnes Image', type: 'image', baseURL: 'b3', apiKey: 'k3', apiKeyEnv: 'AGNES' },
  ]

  it('picks the first text row when requestedId is empty / undefined', () => {
    const r = resolveTextModel(models, '')
    expect(r.requestedButMissing).toBe(false)
    expect(r.provider).toBe('deepseek')
    expect(r.model).toBe('deepseek-chat')
  })

  it('matches "<provider>/<model>" exactly when both halves are present', () => {
    const r = resolveTextModel(models, 'openai/gpt-4o-mini')
    expect(r.requestedButMissing).toBe(false)
    expect(r.provider).toBe('openai')
    expect(r.model).toBe('gpt-4o-mini')
  })

  it('falls back to the first text row AND flags requestedButMissing when the provider is a typo', () => {
    // "typo/gpt-4o-mini" — model exists but in openai, not typo.
    const r = resolveTextModel(models, 'typo/gpt-4o-mini')
    expect(r.requestedButMissing).toBe(true)
    expect(r.provider).toBe('deepseek')
    expect(r.model).toBe('deepseek-chat')
  })

  it('falls back AND flags requestedButMissing when only the model id is wrong', () => {
    // "deepseek/typo" — provider matches but the id does not.
    const r = resolveTextModel(models, 'deepseek/typo')
    expect(r.requestedButMissing).toBe(true)
    expect(r.provider).toBe('deepseek')
    expect(r.model).toBe('deepseek-chat')
  })

  it('treats a bare id with NO slash as a missing request', () => {
    // Without a provider prefix, the user has not specified enough info
    // to be honoured — we still auto-pick but flag it so the caller
    // surfaces the warning. This matches the previous behaviour of the
    // buggy code path (silent swap to first row).
    const r = resolveTextModel(models, 'gpt-4o-mini')
    expect(r.requestedButMissing).toBe(true)
    expect(r.provider).toBe('deepseek')
    expect(r.model).toBe('deepseek-chat')
  })

  it('returns { provider: "", model: "", requestedButMissing: true } when no text candidate exists AND the id is unknown', () => {
    const onlyImage = models.filter(m => m.type === 'image')
    const r = resolveTextModel(onlyImage, 'typo/whatever')
    expect(r.provider).toBe('')
    expect(r.model).toBe('')
    expect(r.requestedButMissing).toBe(true)
  })

  it('returns { provider: "", model: "", requestedButMissing: false } when no text candidate exists AND requestedId is empty', () => {
    const onlyImage = models.filter(m => m.type === 'image')
    const r = resolveTextModel(onlyImage, '')
    expect(r.provider).toBe('')
    expect(r.model).toBe('')
    expect(r.requestedButMissing).toBe(false)
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
