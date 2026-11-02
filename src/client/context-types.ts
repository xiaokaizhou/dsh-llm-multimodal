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
