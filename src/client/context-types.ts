/**
 * Minimal type definitions for the cordis-shaped Context the DSH client
 * runtime injects into plugin apply() functions. We only type what we use
 * to keep the source free of the full cordis TypeScript surface.
 *
 * DSH 0.2.x replaces the old `settingsScope` service with `configForms`:
 * the Host owns the settings namespace, hands out a form controller and
 * applies every write through `settings.mutate` on the host side.
 */

import type { ReactElement } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { LocaleDict } from './locales.ts'

type SlotRegistrar<T> = (descriptor: {
  name: string
  id?: string
  key?: string
  locale?: string
  order?: number
  label?: () => string
  inject?: () => Record<string, unknown>
}, component: (props: any) => ReactElement | null) => () => void

/**
 * The six modalities this plugin serves. The same key set names the settings
 * sections (`text` / `image` / …), the capability verdict's modality list and
 * the capability matrix's inline editor.
 */
export type ModalityKey = 'text' | 'image' | 'video' | 'vision' | 'tts' | 'music'

/**
 * Where a modality verdict came from, as reported by the server's layered
 * capability resolution. The levels are ordered from the strongest to the
 * weakest evidence.
 *
 *   override — the user pinned the verdict by hand (persisted server-side)
 *   declared — the provider's own configuration / model list declares it
 *   provider — an online probe of the provider's model list
 *   rule     — an internal family rule matched the model id
 *   family   — the default verdict of the model's family
 *   fallback — nothing matched; the generic fallback was used
 */
export type CapabilitySourceLevel =
  | 'override'
  | 'declared'
  | 'provider'
  | 'rule'
  | 'family'
  | 'fallback'

/** One piece of evidence behind a modality verdict. */
export interface CapabilitySource {
  /** The level this piece of evidence was collected at. */
  level: string
  /** Optional identifier of the concrete source (a rule id, a field name…). */
  id?: string
  /** Optional human-readable detail, shown as the tag's tooltip. */
  detail?: string
}

/**
 * One model row of the capability matrix.
 *
 * The server fills `modalities` / `primary` / `confidence` / `sources`; the
 * optional fields carry the extra metadata the provider reported.
 */
export interface CapabilityModelRow {
  provider: string
  id: string
  name?: string
  /** The provider's own model type ("chat" / "image" / …). */
  type?: string
  /** Every modality the model was judged to serve. */
  modalities?: ModalityKey[]
  /** The modality the model is primarily used for. */
  primary?: string
  /** How sure the resolver is, 0…1. */
  confidence?: number
  /** The evidence behind the verdict, strongest first. */
  sources?: CapabilitySource[]
  contextWindow?: number
  maxTokens?: number
}

/** One provider of the catalog, with the models it offers. */
export interface CapabilityProviderRow {
  id: string
  /** Display name of the provider (newer contract). */
  name?: string
  /** Display name of the provider (older contract). */
  displayName?: string
  baseURL?: string
  apiProtocol?: string
  models?: CapabilityModelRow[]
}

/** One persisted manual correction, keyed by `"<provider>:<model id>"`. */
export interface CapabilityOverrideEntry {
  modalities: string[]
  updatedAt?: string
}

/** The payload of `GET /api/llm-multimodal/capabilities`. */
export interface CapabilitiesSnapshot {
  overrides: Record<string, CapabilityOverrideEntry>
  rules: unknown[]
  file: string
}

/** The payload of `POST /api/llm-multimodal/detect`. */
export interface DetectResult {
  ok?: boolean
  provider?: string
  models?: unknown
  merged?: number | unknown[]
}

export interface Context {
  /** Host-owned settings forms (DSH 0.2.x `configForms` service). */
  configForms: {
    /** Form controller for one settings namespace (the profile entry id). */
    get<T>(entryId: string): ConfigForm<T>
    /** Run `register` while the Host serves any of `namespaces`. */
    whileServed(
      namespaces: readonly string[],
      register: (served: ReadonlySet<string>) => () => void,
    ): () => void
  }
  locale: {
    register(ns: string, dict: { zh: LocaleDict; en: LocaleDict }): () => void
    bind(ns: string): (key: keyof LocaleDict) => string
  }
  slots: {
    inject(path: string, fn: () => unknown): () => void
    register: SlotRegistrar<unknown>
  }
  effect(fn: () => unknown, key: string): () => void
}

// Local re-export so the types above are reachable without runtime cost.
export type { ConfigForm }
