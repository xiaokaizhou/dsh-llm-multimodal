/**
 * Minimal type definitions for the cordis-shaped Context the DSH client
 * runtime injects into plugin apply() functions. We only type what we use
 * to keep the source free of the full cordis TypeScript surface.
 */

import type { ReactElement } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
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
  settingsScope: { bind<T>(spec: { namespace: string }): SettingsScope<T> }
  locale: {
    register(ns: string, dict: { zh: LocaleDict; en: LocaleDict }): () => void
    bind(ns: string): (key: keyof LocaleDict) => string
  }
  slots: {
    inject(path: string, fn: () => unknown): () => void
    register: SlotRegistrar<unknown>
  }
  effect(fn: () => unknown, key: string): () => void
  /**
   * SnapshotStore from dsh-client-runtime — declared here as a structural
   * type so the imports stay local. The plugin gets the actual instance
   * passed via the `hooks` slot inject prop.
   */
  __hooks?: { llmMultimodal?: SnapshotStore<any> }
}

// Local re-export so the type above is reachable without runtime cost.
export type { SettingsScope, SnapshotStore }