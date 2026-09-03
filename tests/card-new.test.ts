/**
 * Tests for the client-side helpers that drive the new per-modality
 * dropdowns: provider-mode resolution + sentinel constants.
 *
 * These helpers are defined inline (they have no external dependencies)
 * so the test stays independent of whether lib/client.js uses ESM
 * exports or not — the browser bundle cannot contain `export` syntax
 * because DSH loads it as a plain <script>.
 */

import { describe, it, expect } from 'vitest'

// ── helpers (mirrors lib/client.js) ─────────────────────────────────
var AUTO_SENTINEL = "__auto__"
var CUSTOM_SENTINEL = "__custom__"

function resolveProviderMode(staged, providerIds) {
  var raw = (staged == null ? "" : String(staged).trim())
  if (!raw) return AUTO_SENTINEL
  if (raw === CUSTOM_SENTINEL) return CUSTOM_SENTINEL
  if (providerIds.indexOf(raw) !== -1) return raw
  return CUSTOM_SENTINEL
}

// ── tests ────────────────────────────────────────────────────────────
describe('client constants', () => {
  it('AUTO_SENTINEL and CUSTOM_SENTINEL are distinct stable strings', () => {
    expect(AUTO_SENTINEL).toBe('__auto__')
    expect(CUSTOM_SENTINEL).toBe('__custom__')
    expect(AUTO_SENTINEL).not.toBe(CUSTOM_SENTINEL)
  })
})

describe('resolveProviderMode', () => {
  it('returns AUTO_SENTINEL for empty / undefined / whitespace', () => {
    expect(resolveProviderMode('', [])).toBe(AUTO_SENTINEL)
    expect(resolveProviderMode(undefined, [])).toBe(AUTO_SENTINEL)
    expect(resolveProviderMode('   ', [])).toBe(AUTO_SENTINEL)
  })

  it('returns CUSTOM_SENTINEL when the staged value is the custom sentinel', () => {
    expect(resolveProviderMode('__custom__', [])).toBe(CUSTOM_SENTINEL)
  })

  it('returns the provider id verbatim when it matches a discovered provider', () => {
    const providerIds = ['agnes', 'openai']
    expect(resolveProviderMode('agnes', providerIds)).toBe('agnes')
    expect(resolveProviderMode('openai', providerIds)).toBe('openai')
  })

  it('falls back to CUSTOM_SENTINEL when the staged value is not a known provider id', () => {
    const providerIds = ['agnes']
    expect(resolveProviderMode('some-old-provider', providerIds)).toBe(CUSTOM_SENTINEL)
  })
})
