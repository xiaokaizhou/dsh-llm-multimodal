/**
 * dsh-llm-multimodal — client half (browser).
 *
 * Registers one card under the host's "Settings → 插件" tab. The card is a
 * self-contained React component (no shared UI primitives import — see
 * `references/dsh-client-ui-internal-symbols-not-esm-importable.md` for why
 * that always fails) bound to the `llm-multimodal` settings namespace.
 *
 * UI shape per modality (text / image / video / tts / music):
 *
 *   1. A `<select>` whose first option is "自定义" and whose remaining
 *      options come from `GET /api/llm-multimodal/models` (auto-discovered
 *      llm-pi-ai rows filtered by modality). The dropdown value is
 *      `"<provider>:<id>"` for presets or `"custom"` for the custom slot.
 *
 *   2. When the user picks "自定义", a small form is rendered with fields
 *      for `apiProtocol`, `baseURL`, `apiKey` (secret), `defaultModel`
 *      (and `voice` for tts/music). When they pick a preset, only
 *      `defaultModel` is editable (baseURL/apiKey are inherited from
 *      llm-pi-ai at tool-call time via `applyOverride()`).
 *
 * Persistence: every change calls `scope.set(field, value)` and forgets
 * the promise — UI never blocks on disk writes. The host's serialized
 * write queue handles ordering; the latest revision fences conflicts.
 * `scope.subscribe` rerenders on commit.
 *
 * Custom-path caveat: the client `SettingsScope.set(field, value)` API
 * takes a single path segment, not a dotted path. We therefore write the
 * whole modality object via `scope.set('image', {…})` when the user picks
 * "自定义", since that's how the host's `mutate()` path-op applies
 * recursively (see `applyPathOp` in dsh-settings/lib/index.js).
 */

import {
  createElement as h,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react'
import type { Context } from './context-types.ts'
import { createSnapshotStore, type SettingsScope, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { zh, en, type LocaleDict } from './client/locales.ts'
import { ensureStyles } from './client/styles.ts'

export const name = 'dsh-llm-multimodal-client'
export const inject = [
  'slots',
  'locale',
  'settingsScope',
]

export const NS = 'llm-multimodal.card'

type ModalityKey = 'text' | 'image' | 'video' | 'tts' | 'music'
const MODALITY_ORDER: ModalityKey[] = ['text', 'image', 'video', 'tts', 'music']

interface ModalityState {
  provider: string
  apiProtocol: string
  baseURL: string
  apiKey: string
  defaultModel: string
  voice: string
}

const EMPTY_MODALITY: ModalityState = {
  provider: '',
  apiProtocol: '',
  baseURL: '',
  apiKey: '',
  defaultModel: '',
  voice: '',
}

interface CardSnapshot {
  available: boolean
  writable: boolean
  text: ModalityState
  image: ModalityState
  video: ModalityState
  tts: ModalityState
  music: ModalityState
}

interface ModelsSnapshot {
  providers: Array<{
    id: string
    displayName: string
    baseURL: string
    apiKeyEnv: string
    models: Array<{ id: string; name: string; type: string }>
  }>
  byModality: Record<ModalityKey, Array<{ provider: string; id: string; name: string; baseURL: string }>>
}

const EMPTY_MODELS: ModelsSnapshot = {
  providers: [],
  byModality: { text: [], image: [], video: [], tts: [], music: [] },
}

function coerceModality(v: unknown): ModalityState {
  if (!v || typeof v !== 'object') return { ...EMPTY_MODALITY }
  const r = v as Record<string, unknown>
  return {
    provider: typeof r.provider === 'string' ? r.provider : '',
    apiProtocol: typeof r.apiProtocol === 'string' ? r.apiProtocol : '',
    baseURL: typeof r.baseURL === 'string' ? r.baseURL : '',
    apiKey: typeof r.apiKey === 'string' ? r.apiKey : '',
    defaultModel: typeof r.defaultModel === 'string' ? r.defaultModel : '',
    voice: typeof r.voice === 'string' ? r.voice : '',
  }
}

function projectSnapshot(scope: SettingsScope<unknown>): CardSnapshot {
  const snap = scope.getSnapshot()
  const value = (snap.value ?? {}) as Record<string, unknown>
  return {
    available: snap.status === 'ready',
    writable: snap.writable,
    text: coerceModality(value.text),
    image: coerceModality(value.image),
    video: coerceModality(value.video),
    tts: coerceModality(value.tts),
    music: coerceModality(value.music),
  }
}

function ModalitySection(props: {
  modality: ModalityKey
  label: string
  state: ModalityState
  presetOptions: Array<{ value: string; label: string }>
  hasAnyPreset: boolean
  t: (key: keyof LocaleDict) => string
  writable: boolean
  onDropdownChange: (value: string) => void
  onFieldChange: (field: keyof ModalityState, value: string) => void
  onReset: () => void
}): ReactElement {
  const isCustom = props.state.provider === 'custom'
  const isPreset = props.state.provider !== '' && props.state.provider !== 'custom'
  // Resolve the <select>'s controlled value to the matching option's `value`.
  // Preset option values use the full `"<provider>:<id>"` shape, but the
  // stored state only carries `provider` (with the model id in
  // `defaultModel`). Looking up the matching preset option here keeps the
  // dropdown's selected label in sync with the saved selection instead of
  // silently falling back to the empty placeholder.
  const matchedPresetValue =
    isPreset && props.state.defaultModel
      ? `${props.state.provider}:${props.state.defaultModel}`
      : ''
  const dropdownValue = isCustom
    ? 'custom'
    : isPreset
      ? (props.presetOptions.some((o) => o.value === matchedPresetValue) ? matchedPresetValue : '')
      : ''
  const includeVoice = props.modality === 'tts' || props.modality === 'music'

  const summary = (() => {
    if (props.state.provider === '') return props.t('notConfigured')
    if (props.state.provider === 'custom') {
      const m = props.state.defaultModel || '…'
      return `${props.t('selected')}: custom / ${m}`
    }
    return `${props.t('selected')}: ${props.state.provider} / ${props.state.defaultModel || '…'}`
  })()

  return h(
    'li',
    { className: 'dsh-llmm-section' },
    h(
      'div',
      { className: 'dsh-llmm-section-row' },
      h('span', { className: 'dsh-llmm-section-label' }, props.label),
      h('span', { className: 'dsh-llmm-section-summary' }, summary),
      h(
        'button',
        {
          type: 'button',
          className: 'dsh-llmm-reset-btn',
          disabled: !props.writable || props.state.provider === '',
          onClick: () => props.onReset(),
        },
        props.t('resetToNone'),
      ),
    ),
    h(
      'div',
      { className: 'dsh-llmm-section-body' },
      h(
        'label',
        { className: 'dsh-llmm-field' },
        h('span', { className: 'dsh-llmm-label' }, props.t('defaultModel')),
        h(
          'select',
          {
            className: 'dsh-llmm-select',
            value: dropdownValue,
            disabled: !props.writable,
            onChange: (e: any) => props.onDropdownChange(e.target.value),
          },
          h('option', { value: '' }, props.t('chooseModel')),
          h('option', { value: 'custom' }, props.t('chooseCustom')),
          ...props.presetOptions.map((o) => h('option', { key: o.value, value: o.value }, o.label)),
        ),
        h('span', { className: 'dsh-llmm-hint' }, props.t('defaultModelHint')),
      ),
      isCustom && h(Fragment, null,
        h(
          'label',
          { className: 'dsh-llmm-field' },
          h('span', { className: 'dsh-llmm-label' }, props.t('apiProtocol')),
          h(
            'select',
            {
              className: 'dsh-llmm-select',
              value: props.state.apiProtocol,
              disabled: !props.writable,
              onChange: (e: any) => props.onFieldChange('apiProtocol', e.target.value),
            },
            h('option', { value: '' }, props.t('chooseModel')),
            h('option', { value: 'openai' }, 'openai'),
            h('option', { value: 'claude' }, 'claude'),
            h('option', { value: 'anthropic' }, 'anthropic'),
            h('option', { value: 'minimax' }, 'minimax'),
            h('option', { value: 'elevenlabs' }, 'elevenlabs'),
          ),
          h('span', { className: 'dsh-llmm-hint' }, props.t('apiProtocolHint')),
        ),
        h(
          'label',
          { className: 'dsh-llmm-field' },
          h('span', { className: 'dsh-llmm-label' }, props.t('baseURL')),
          h('input', {
            className: 'dsh-llmm-input',
            type: 'text',
            value: props.state.baseURL,
            placeholder: 'https://api.example.com/v1',
            disabled: !props.writable,
            onChange: (e: any) => props.onFieldChange('baseURL', e.target.value),
          }),
          h('span', { className: 'dsh-llmm-hint' }, props.t('baseURLHint')),
        ),
        h(
          'label',
          { className: 'dsh-llmm-field' },
          h('span', { className: 'dsh-llmm-label' }, props.t('apiKey')),
          h('input', {
            className: 'dsh-llmm-input',
            type: 'password',
            value: props.state.apiKey,
            disabled: !props.writable,
            onChange: (e: any) => props.onFieldChange('apiKey', e.target.value),
          }),
          h('span', { className: 'dsh-llmm-hint' }, props.t('apiKeyHint')),
        ),
        h(
          'label',
          { className: 'dsh-llmm-field' },
          h('span', { className: 'dsh-llmm-label' }, props.t('defaultModel')),
          h('input', {
            className: 'dsh-llmm-input',
            type: 'text',
            value: props.state.defaultModel,
            placeholder: props.t('defaultModelPlaceholderCustom'),
            disabled: !props.writable,
            onChange: (e: any) => props.onFieldChange('defaultModel', e.target.value),
          }),
          h('span', { className: 'dsh-llmm-hint' }, props.t('defaultModelHint')),
        ),
      ),
      includeVoice && (isCustom || isPreset) && h(
        'label',
        { className: 'dsh-llmm-field' },
        h('span', { className: 'dsh-llmm-label' }, props.t('voice')),
        h('input', {
          className: 'dsh-llmm-input',
          type: 'text',
          value: props.state.voice,
          disabled: !props.writable,
          onChange: (e: any) => props.onFieldChange('voice', e.target.value),
        }),
        h('span', { className: 'dsh-llmm-hint' }, props.t('voiceHint')),
      ),
      !props.hasAnyPreset && !props.state.provider && h(
        'p',
        { className: 'dsh-llmm-hint' },
        props.t('noModelsHint'),
      ),
    ),
  )
}

type SettingsCardProps = PropsLocale<typeof NS> & {
  useLlmMultimodal: <R>(selector: (snapshot: CardSnapshot) => R) => R
  setField: (modality: ModalityKey, field: keyof ModalityState, value: string) => void
  setWhole: (modality: ModalityKey, value: ModalityState) => void
  reset: (modality: ModalityKey) => void
}

function SettingsCard(props: SettingsCardProps): ReactElement | null {
  const { t, setField, setWhole, reset } = props
  const snap = props.useLlmMultimodal((s) => s)
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelsSnapshot>(EMPTY_MODELS)
  const [loadingModels, setLoadingModels] = useState(false)
  const [loadError, setLoadError] = useState('')

  const reloadModels = useCallback(async () => {
    setLoadingModels(true)
    setLoadError('')
    try {
      const r = await fetch('/api/llm-multimodal/models', { method: 'GET' })
      const data = await r.json()
      if (data && data.ok && data.byModality) {
        setModels({
          providers: data.providers ?? [],
          byModality: {
            text: data.byModality.text ?? [],
            image: data.byModality.image ?? [],
            video: data.byModality.video ?? [],
            tts: data.byModality.tts ?? [],
            music: data.byModality.music ?? [],
          },
        })
      } else {
        setLoadError((data && data.error) || 'unexpected response')
      }
    } catch (e: any) {
      setLoadError(e?.message || String(e))
    } finally {
      setLoadingModels(false)
    }
  }, [])

  // Refresh model catalog when the card is first opened.
  useEffect(() => {
    if (open && models.providers.length === 0 && !loadingModels) {
      void reloadModels()
    }
  }, [open, models.providers.length, loadingModels, reloadModels])

  // TEMP DEBUG — expose raw scope and props so we can probe from devtools
  if (typeof window !== 'undefined') {
    const w = window as any
    if (!w.__dsh_llmm_debug) w.__dsh_llmm_debug = { count: 0 }
    w.__dsh_llmm_debug.count++
    w.__dsh_llmm_debug.last_snap = snap
    w.__dsh_llmm_debug.last_props = { setField, setWhole, reset }
    w.__dsh_llmm_debug.last_snap_value = snap
  }

  // if (!snap.available) return null
  const writable = snap.writable
  const disabled = !writable

  const sectionLabel: Record<ModalityKey, string> = {
    text: t('sectionText'),
    image: t('sectionImage'),
    video: t('sectionVideo'),
    tts: t('sectionTts'),
    music: t('sectionMusic'),
  }

  return h(
    'li',
    { className: open ? 'dsh-llmm-card dsh-llmm-card-open' : 'dsh-llmm-card' },
    h(
      'button',
      {
        type: 'button',
        className: 'dsh-llmm-header',
        'aria-expanded': open,
        'aria-label': `${t(open ? 'collapse' : 'expand')}: ${t('title')}`,
        onClick: () => setOpen(!open),
      },
      h('span', { className: 'dsh-llmm-head-text' },
        h('span', { className: 'dsh-llmm-name' }, t('title')),
        h('span', { className: 'dsh-llmm-description' }, t('description')),
      ),
      h(
        'svg',
        { className: open ? 'dsh-llmm-chevron dsh-llmm-chevron-open' : 'dsh-llmm-chevron',
          viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': 'true' },
        h('path', {
          d: 'M3.5 5.5 7 9l3.5-3.5', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
      ),
    ),
    open ? h(Fragment, null,
      disabled ? h('p', { className: 'dsh-llmm-read-only', role: 'status' }, t('readOnly')) : null,
      loadingModels ? h('p', { className: 'dsh-llmm-hint' }, t('loadingModels')) : null,
      loadError ? h('p', { className: 'dsh-llmm-hint' }, `${t('loadModelsFailed')}: ${loadError}`) : null,
      h('ul', { className: 'dsh-llmm-section-list' },
        ...MODALITY_ORDER.map((m) => {
          const presets = models.byModality[m] ?? []
          const presetOptions = presets.map((p) => ({
            value: `${p.provider}:${p.id}`,
            label: `${p.provider} / ${p.name || p.id}`,
          }))
          return h(ModalitySection, {
            key: m,
            modality: m,
            label: sectionLabel[m],
            state: snap[m],
            presetOptions,
            hasAnyPreset: presets.length > 0,
            t,
            writable,
            onDropdownChange: (val: string) => {
              if (val === '') {
                reset(m)
                return
              }
              if (val === 'custom') {
                setWhole(m, {
                  provider: 'custom',
                  apiProtocol: snap[m].apiProtocol,
                  baseURL: snap[m].baseURL,
                  apiKey: snap[m].apiKey,
                  defaultModel: snap[m].defaultModel,
                  voice: snap[m].voice,
                })
                return
              }
              const splitIdx = val.indexOf(':')
              const pid = splitIdx > 0 ? val.slice(0, splitIdx) : val
              const modelId = splitIdx > 0 ? val.slice(splitIdx + 1) : ''
              setWhole(m, {
                provider: pid,
                apiProtocol: '',
                baseURL: '',
                apiKey: '',
                defaultModel: modelId,
                voice: snap[m].voice,
              })
            },
            onFieldChange: (field: keyof ModalityState, value: string) => setField(m, field, value),
            onReset: () => reset(m),
          })
        }),
      ),
    ) : null,
  )
}

export function apply(ctx: Context): void {
  ensureStyles()
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'dsh-llm-multimodal: dictionaries',
  )

  const scope = ctx.settingsScope.bind({ namespace: 'llm-multimodal' }) as SettingsScope<unknown>

  const project = () => projectSnapshot(scope)
  const store = createSnapshotStore(project()) as SnapshotStore<CardSnapshot>
  scope.subscribe(() => { store.set(project()) })

  const setField = useCallbackForApply((m: ModalityKey, field: keyof ModalityState, value: string) => {
    // Read current section, replace one field, write the whole section back.
    // (The client SettingsScope API only takes a single-segment path, not a
    // dotted path; rewriting the whole modality section is the simplest way
    // to handle nested fields without losing other fields.)
    const cur = coerceModality(((scope.getSnapshot().value ?? {}) as Record<string, unknown>)[m])
    const next: ModalityState = { ...cur, [field]: value }
    void scope.set(m, next)
  }, [scope])

  const setWhole = useCallbackForApply((m: ModalityKey, value: ModalityState) => {
    void scope.set(m, value)
  }, [scope])

  const resetModality = useCallbackForApply((m: ModalityKey) => {
    void scope.unset(m)
  }, [scope])

  // slots / locale / settingsScope are all on the inject list (the cordis
  // fiber parks until each is provided by some entry's apply()), so we can
  // read them directly via ctx.X.
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    // The card key MUST match the settings namespace name; the host settings UI
    // dispatches this slot per-namespace (`renderSlot(..., {entryKey: ns})`).
    key: 'llm-multimodal',
    locale: NS,
    inject: () => ({
      hooks: { llmMultimodal: store },
      setField,
      setWhole,
      reset: resetModality,
    }),
  }, SettingsCard))
}

/**
 * Apply runs once per plugin activation, NOT inside a React render. We
 * still want stable handler references so that the registered slot's
 * `inject()` factory doesn't churn when its subscribers fire. A simple
 * memoized closure tied to `scope` is enough — `scope` itself is stable
 * for the lifetime of the plugin.
 */
function useCallbackForApply<T extends (...args: any[]) => any>(fn: T, _deps: any[]): T {
  return useMemoStable(fn)
}

function useMemoStable<T>(fn: T): T {
  // Plain stable alias — apply() is invoked exactly once, so we don't
  // need a real useMemo; this keeps the code small and lets the same
  // closure be reused across the two registry slots.
  return fn
}