/**
 * Capability resolution — the 0.4 replacement for the keyword table.
 *
 * Every case here is a real model id from the reporters' own
 * `llm-pi-ai.providers` (a MiniMax endpoint, the Agnes gateway, and the
 * SayGM aggregator). The ids that used to be wrong are marked "regression".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MODALITIES,
  resolveCapabilities,
  hasModality,
  normalizeModalities,
  normalizeModelKey,
  describeCandidates,
  pickModel,
  capabilityStorePath,
  loadCapabilityStore,
  saveCapabilityStore,
  applyOverrideEntry,
  fetchProviderCatalog,
  setProviderMeta,
  getProviderMeta,
  clearProviderMeta,
  defaultRules,
} from '../lib/capabilities.js'

const mods = (input) => resolveCapabilities(input).modalities

describe('resolveCapabilities — declared metadata wins', () => {
  it('uses pi-ai input/output modalities (the signal 0.3 threw away)', () => {
    // Regression: MiniMax-M3 declares input: [text, image] but 0.3 only read
    // id/name, so generate_vision could never see it.
    const r = resolveCapabilities({
      id: 'MiniMax-M3',
      name: 'MiniMax M3',
      meta: { input: ['text', 'image'], output: ['text'] },
    })
    expect(r.modalities).toEqual(['text', 'vision'])
    expect(r.primary).toBe('text')
    expect(r.confidence).toBe(0.9)
    expect(r.sources[0].level).toBe('declared')
  })

  it('text-only metadata produces a text row', () => {
    const r = resolveCapabilities({
      id: 'MiniMax-M2.7',
      meta: { input: ['text'], output: ['text'] },
    })
    expect(r.modalities).toEqual(['text'])
  })

  it('declared image output makes an image model, not a chat model', () => {
    const r = resolveCapabilities({
      id: 'some-generator',
      meta: { input: ['text'], output: ['image'] },
    })
    expect(r.modalities).toEqual(['image'])
    expect(r.primary).toBe('image')
  })

  it('declared audio output classifies as tts', () => {
    const r = resolveCapabilities({
      id: 'some-voice',
      meta: { input: ['text'], output: ['audio'] },
    })
    expect(r.modalities).toContain('tts')
  })
})

describe('resolveCapabilities — the ids that used to be misclassified', () => {
  it('image models an aggregator names without an "image" token', () => {
    // Regression: both fell through to text, so generate_image had nothing
    // to pick and the "nano banana" models were unreachable.
    expect(mods({ id: 'gemini-nano-banana-2.1', name: 'Nano Banana 2.1' })).toEqual(['image'])
    expect(mods({ id: 'gemini-3-pro-image', name: 'Nano Banana Pro' })).toEqual(['image'])
    expect(mods({ id: 'gemini-3.1-flash-image' })).toEqual(['image'])
    expect(mods({ id: 'flux.2-klein-4b' })).toEqual(['image'])
    expect(mods({ id: 'agnes-image-2.1-flash' })).toEqual(['image'])
  })

  it('video models keep winning over the generic chat tokens in their name', () => {
    expect(mods({ id: 'google/veo-3.1-fast' })).toEqual(['video'])
    expect(mods({ id: 'wan-ai/wan-2.6-t2v' })).toEqual(['video'])
    expect(mods({ id: 'agnes-video-2.5-flash' })).toEqual(['video'])
    expect(mods({ id: 'local-wan', name: 'Wan 2.2 (本地)' })).toEqual(['video'])
    expect(mods({ id: 'ltx-video-0.9.8' })).toEqual(['video'])
  })

  it('a hosted chat model named "h3" is NOT a video model', () => {
    // Regression: the bare keyword "h3" made `minimax/h3` a video model, so
    // the chat model vanished from generate_text.
    const r = resolveCapabilities({ id: 'minimax/h3', name: 'MiniMax H3' })
    expect(r.modalities).toEqual(['text'])
    expect(hasModality(r, 'video')).toBe(false)
  })

  it('a local gateway id labelled 视频生成 IS a video model', () => {
    // Same family, different product: the local gateway route a
    // "MiniMax-H3 视频生成" endpoint, and only the display name says so.
    expect(mods({ id: 'local-h3', name: 'MiniMax-H3 视频生成 (本地)' })).toEqual(['video'])
    expect(mods({ id: 'local-minimax-h3', name: 'MiniMax Hailuo 视频生成 (本地)' })).toEqual(['video'])
  })

  it('frontier chat models are multi-label: text AND vision', () => {
    for (const id of [
      'claude-opus-5',
      'claude-sonnet-5',
      'gpt-5.6-sol',
      'gpt-6.1-terra',
      'gemini-3.1-pro-preview',
      'gemini-3.8-flash',
      'kimi-k3.1-pro',
      'qwen-vl-plus',
      'gpt-4o-mini',
    ]) {
      const r = resolveCapabilities({ id })
      expect(hasModality(r, 'text'), id).toBe(true)
      expect(hasModality(r, 'vision'), id).toBe(true)
      // `primary` stays text so the flat legacy `type` field keeps these
      // models in the text pool.
      expect(r.primary).toBe('text')
    }
  })

  it('unknown ids degrade to text with low confidence, never to a generation modality', () => {
    const r = resolveCapabilities({ id: 'mystery-model-7b' })
    expect(r.modalities).toEqual(['text'])
    expect(r.confidence).toBe(0.3)
    expect(r.sources[0].level).toBe('fallback')
  })

  it('tts and music stay separate', () => {
    expect(mods({ id: 'minimax-speech-02-hd' })).toEqual(['tts'])
    expect(mods({ id: 'local-voxcpm' })).toEqual(['tts'])
    expect(mods({ id: 'musicgen-melody' })).toEqual(['music'])
    expect(mods({ id: 'suno-music-v3' })).toEqual(['music'])
    // A chat model must not be dragged in by a "minimax" brand token.
    expect(mods({ id: 'MiniMax-M2.7' })).toEqual(['text'])
  })
})

describe('resolveCapabilities — override and provider evidence', () => {
  it('a user override outranks every other layer, including declared metadata', () => {
    const r = resolveCapabilities({
      id: 'gemini-3-pro-image',
      meta: { input: ['text'], output: ['text'] },
      override: { modalities: ['text'] },
    })
    expect(r.modalities).toEqual(['text'])
    expect(r.confidence).toBe(1)
    expect(r.sources[0].level).toBe('override')
  })

  it('an override can add a modality the rules missed', () => {
    const r = resolveCapabilities({
      id: 'my-private-vlm-01',
      override: { modalities: ['text', 'vision'] },
    })
    expect(r.modalities).toEqual(['text', 'vision'])
  })

  it('provider /models metadata is used when nothing else knows', () => {
    const r = resolveCapabilities({
      id: 'my-private-model',
      providerMeta: { architecture: { input_modalities: ['text', 'image'] } },
    })
    expect(r.modalities).toEqual(['text', 'vision'])
    expect(r.confidence).toBe(0.8)
  })

  it('a custom user rule is consulted before the built-ins', () => {
    const rules = [
      ...defaultRules(),
      { id: 'user.my-image', pattern: '(?:^|[-_/.])mypaint(?:[-_/.]|$)', modalities: ['image'], note: 'house style' },
    ]
    expect(resolveCapabilities({ id: 'mypaint-v2', rules }).modalities).toEqual(['image'])
  })
})

describe('pickModel — explicit ids are honoured or reported, never swapped', () => {
  const rows = [
    { provider: 'agnes', id: 'agnes-image-2.1-flash', name: 'Agnes Image 2.1', modalities: ['image'] },
    { provider: 'saygm', id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', modalities: ['text', 'vision'] },
    { provider: 'minimax-cn', id: 'MiniMax-M3', name: 'MiniMax M3', modalities: ['text', 'vision'] },
  ]

  it('auto-picks the first row of the requested modality', () => {
    const pick = pickModel(rows, 'image')
    expect(pick.model?.id).toBe('agnes-image-2.1-flash')
    expect(pick.requestedButMissing).toBe(false)
  })

  it('finds a vision model even though the pool is a subset of the rows', () => {
    // The 0.3 bug: the pool was filtered to type === "vision" *before* the
    // explicit id was looked up, so the empty pool hid every chat+VL model.
    const pick = pickModel(rows, 'vision', 'MiniMax-M3')
    expect(pick.model?.id).toBe('MiniMax-M3')
    expect(pick.requestedButMissing).toBe(false)
    expect(pick.capabilityMismatch).toBe(false)
  })

  it('accepts "<provider>/<id>" and "<provider>:<id>" spellings', () => {
    expect(pickModel(rows, 'text', 'saygm/gemini-3.1-pro-preview').model?.id).toBe('gemini-3.1-pro-preview')
    expect(pickModel(rows, 'text', 'saygm:gemini-3.1-pro-preview').model?.id).toBe('gemini-3.1-pro-preview')
  })

  it('reports an unknown id instead of substituting another model', () => {
    const pick = pickModel(rows, 'image', 'flux')
    expect(pick.model).toBeNull()
    expect(pick.requestedButMissing).toBe(true)
  })

  it('honours an explicit id the resolver did not label with that modality', () => {
    const pick = pickModel(rows, 'image', 'gemini-3.1-pro-preview')
    expect(pick.model?.id).toBe('gemini-3.1-pro-preview')
    expect(pick.capabilityMismatch).toBe(true)
  })

  it('returns an empty pick when the modality has no rows', () => {
    const pick = pickModel(rows, 'music')
    expect(pick.model).toBeNull()
    expect(pick.requestedButMissing).toBe(false)
  })
})

describe('describeCandidates / normalizeModalities / normalizeModelKey', () => {
  it('lists candidates with provider and display name', () => {
    const text = describeCandidates(
      [
        { provider: 'saygm', id: 'gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image' },
        { provider: 'agnes', id: 'agnes-image-2.5-flash' },
        { provider: 'saygm', id: 'deepseek-v4-flash', name: 'DeepSeek V4' },
      ],
      'image',
    )
    expect(text).toContain('saygm:gemini-3.1-flash-image (Gemini 3.1 Flash Image)')
    expect(text).toContain('agnes:agnes-image-2.5-flash')
    expect(text).not.toContain('deepseek-v4-flash')
  })

  it('returns an empty string when nothing matches', () => {
    expect(describeCandidates([{ provider: 'a', id: 'b', modalities: ['text'] }], 'music')).toBe('')
  })

  it('drops unknown and duplicate modality names', () => {
    expect(normalizeModalities(['image', 'IMAGE', 'bogus', 'text', 'image'])).toEqual(['image', 'text'])
    expect(normalizeModalities(undefined)).toEqual([])
  })

  it('keys an override by "<provider>:<id>"', () => {
    expect(normalizeModelKey('saygm', 'minimax/h3')).toBe('saygm:minimax/h3')
    expect(normalizeModelKey('', 'x')).toBe(':x')
  })

  it('every default rule compiles and none throws', () => {
    for (const rule of defaultRules()) {
      expect(() => new RegExp(rule.pattern, 'i')).not.toThrow()
    }
    expect(MODALITIES).toEqual(['text', 'image', 'video', 'vision', 'tts', 'music'])
  })
})

describe('capability store — read, pin, clear', () => {
  let dir
  let file

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llm-mm-caps-'))
    file = join(dir, 'llm-multimodal-capabilities.json')
  })

  it('derives the sidecar path from the profile patch file', () => {
    expect(capabilityStorePath('/home/u/.dsh/profiles/desktop/cordis.patch.yml'))
      .toBe('/home/u/.dsh/profiles/desktop/llm-multimodal-capabilities.json')
  })

  it('treats a missing file as "no overrides"', async () => {
    const store = await loadCapabilityStore(file, readFile)
    expect(store).toEqual({ overrides: {}, rules: [] })
  })

  it('round-trips a pin through save + load', async () => {
    const pinned = applyOverrideEntry({ overrides: {}, rules: [] }, 'saygm:some-model', ['text', 'vision'])
    await saveCapabilityStore(file, pinned, writeFile, async () => {})
    const back = await loadCapabilityStore(file, readFile)
    expect(back.overrides['saygm:some-model'].modalities).toEqual(['text', 'vision'])
  })

  it('survives a hand-edited / corrupt file', async () => {
    await writeFile(file, '{ not json', 'utf8')
    expect(await loadCapabilityStore(file, readFile)).toEqual({ overrides: {}, rules: [] })
  })

  it('an empty modality list clears the pin', () => {
    const withPin = applyOverrideEntry({ overrides: {}, rules: [] }, 'a:b', ['image'])
    expect(withPin.overrides['a:b']).toBeDefined()
    const cleared = applyOverrideEntry(withPin, 'a:b', [])
    expect(cleared.overrides['a:b']).toBeUndefined()
  })

  it('a pin changes what the resolver says', () => {
    const store = applyOverrideEntry({ overrides: {}, rules: [] }, 'saygm:minimax/h3', ['text', 'vision'])
    const r = resolveCapabilities({
      id: 'minimax/h3',
      override: store.overrides['saygm:minimax/h3'],
    })
    expect(r.modalities).toEqual(['text', 'vision'])
    expect(r.sources[0].level).toBe('override')
  })
})

describe('fetchProviderCatalog — online evidence, never fatal', () => {
  afterEach(() => clearProviderMeta())

  it('indexes GET /models rows by id', async () => {
    const seen = []
    const result = await fetchProviderCatalog('https://api.example.com/v1', 'k', {
      fetchImpl: async (url, init) => {
        seen.push({ url, auth: init.headers.Authorization })
        return new Response(
          JSON.stringify({ data: [{ id: 'a-model', architecture: { input_modalities: ['text', 'image'] } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    })
    expect(result.ok).toBe(true)
    expect(result.models).toBe(1)
    expect(Object.keys(result.byId)).toEqual(['a-model'])
    expect(seen[0].url).toBe('https://api.example.com/v1/models')
    expect(seen[0].auth).toBe('Bearer k')
  })

  it('degrades to ok:false on HTTP errors and thrown requests', async () => {
    const denied = await fetchProviderCatalog('https://api.example.com/v1', 'k', {
      fetchImpl: async () => new Response('nope', { status: 401 }),
    })
    expect(denied.ok).toBe(false)
    expect(denied.error).toMatch(/401/)

    const thrown = await fetchProviderCatalog('https://api.example.com/v1', 'k', {
      fetchImpl: async () => { throw new Error('ECONNREFUSED') },
    })
    expect(thrown.ok).toBe(false)
    expect(thrown.error).toMatch(/ECONNREFUSED/)
  })

  it('refuses to probe a provider without baseURL', async () => {
    const r = await fetchProviderCatalog('', 'k', { fetchImpl: async () => new Response('{}') })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/baseURL/)
  })

  it('keeps probed metadata in memory for discovery to read', () => {
    setProviderMeta('saygm', { 'x-model': { id: 'x-model' } })
    expect(getProviderMeta('saygm')['x-model']).toBeDefined()
    clearProviderMeta()
    expect(getProviderMeta('saygm')).toBeNull()
  })
})
