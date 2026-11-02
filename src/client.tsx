/**
 * dsh-llm-multimodal — client half (browser).
 *
 * Registers one card on the host's Plugins page (`plugins.item` slot), the
 * way `@deepseek-ai/dsh-client-ui-settings-agent-loop` does on DSH 0.2.x:
 *
 *   1. `inject` asks for `slots`, `locale` and `configForms`.
 *   2. `ctx.configForms.get('llm-multimodal')` returns the Host-owned form
 *      controller for this plugin's settings namespace (the profile entry id
 *      in `cordis.patch.yml`).
 *   3. `ctx.configForms.whileServed(['llm-multimodal'], …)` keeps the
 *      registration alive exactly while the Host serves that namespace, so a
 *      deployment without the plugin shows no trace of the card.
 *   4. The slot entry registers under `plugins.item` with `id:
 *      'llm-multimodal'` — the id the Plugins page lists and dispatches on.
 *
 * UI shape per modality (text / image / video / vision / tts / music):
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
 * Persistence: every change is one atomic `form.mutate([...])` against the
 * Host namespace. The controller serialises the writes, fences them with the
 * namespace revision and folds the accepted values back into the mirror, so
 * the card re-renders from the Host's own view.
 */

import {
  createElement as h,
  Fragment,
  useCallback,
  useEffect,
  useState,
  type ReactElement,
} from 'react'
import type { Context } from './context-types.ts'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { zh, en, type LocaleDict } from './client/locales.ts'
import { ensureStyles } from './client/styles.ts'

export const name = 'dsh-llm-multimodal-client'
export const inject = [
  'slots',
  'locale',
  'configForms',
]

/** Dictionary namespace owned by this card. */
export const NS = 'llm-multimodal.card'

/**
 * The Host-side settings namespace this card edits. It is the profile entry
 * id declared in `cordis.patch.yml` and the `Config` schema the host
 * validates the entry against.
 */
export const SETTINGS_NAMESPACE = 'llm-multimodal'

type ModalityKey = 'text' | 'image' | 'video' | 'vision' | 'tts' | 'music'
const MODALITY_ORDER: ModalityKey[] = ['text', 'image', 'video', 'vision', 'tts', 'music']

/**
 * Field names of the host `Config` schema, per modality. The Host only
 * accepts writes that address a *volatile leaf*, so every write is expanded
 * into one op per leaf — a section-level write (`["image"]`) is rejected by
 * `isVolatilePath()`.
 */
const MODEL_FIELDS: Array<keyof ModalityState> = [
  'provider',
  'apiProtocol',
  'baseURL',
  'apiKey',
  'defaultModel',
]
const AUDIO_FIELDS: Array<keyof ModalityState> = [...MODEL_FIELDS, 'voice']
const MODALITY_FIELDS: Record<ModalityKey, Array<keyof ModalityState>> = {
  text: MODEL_FIELDS,
  image: MODEL_FIELDS,
  video: MODEL_FIELDS,
  vision: MODEL_FIELDS,
  tts: AUDIO_FIELDS,
  music: AUDIO_FIELDS,
}


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

/**
 * Outcome of the last Host write. The Host may refuse a write (for example
 * when its namespace revision moved on), and a refused write leaves the
 * snapshot untouched — so the card has to show the outcome explicitly instead
 * of pretending the change was applied.
 */
interface WriteState {
  status: 'idle' | 'saving' | 'saved' | 'error'
  message: string
}

const IDLE_WRITE: WriteState = { status: 'idle', message: '' }

interface CardSnapshot {
  available: boolean
  writable: boolean
  write: WriteState
  text: ModalityState
  image: ModalityState
  video: ModalityState
  vision: ModalityState
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
  byModality: { text: [], image: [], video: [], vision: [], tts: [], music: [] },
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

/** Project the Host form snapshot into the card's own view model. */
function projectSnapshot(form: ConfigForm<unknown>): CardSnapshot {
  const snap = form.getSnapshot()
  const value = (snap.value ?? {}) as Record<string, unknown>
  return {
    available: snap.status === 'ready',
    writable: snap.writable,
    write: IDLE_WRITE,
    text: coerceModality(value.text),
    image: coerceModality(value.image),
    video: coerceModality(value.video),
    vision: coerceModality(value.vision),
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

/**
 * Loads the model catalog the Host discovers from `llm-pi-ai`.
 *
 * The catalog is only needed once the user can see a picker, so the fetch
 * starts when `enabled` flips to true.
 */
function useModelCatalog(enabled: boolean): {
  models: ModelsSnapshot
  loadingModels: boolean
  loadError: string
} {
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
            vision: data.byModality.vision ?? [],
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

  useEffect(() => {
    if (enabled && models.providers.length === 0 && !loadingModels) {
      void reloadModels()
    }
  }, [enabled, models.providers.length, loadingModels, reloadModels])

  return { models, loadingModels, loadError }
}

interface PickerProps {
  t: (key: keyof LocaleDict) => string
  snap: CardSnapshot
  models: ModelsSnapshot
  loadingModels: boolean
  loadError: string
  write: WriteState
  setField: (modality: ModalityKey, field: keyof ModalityState, value: string) => void
  setWhole: (modality: ModalityKey, value: ModalityState) => void
  reset: (modality: ModalityKey) => void
}

/**
 * The per-modality model pickers.
 *
 * Shared by the Plugins page card and the Plugins settings tab, so the same
 * controls are reachable from both entries.
 */
function ModelPicker(props: PickerProps): ReactElement {
  const { t, snap, models } = props
  const writable = snap.writable
  const sectionLabel: Record<ModalityKey, string> = {
    text: t('sectionText'),
    image: t('sectionImage'),
    video: t('sectionVideo'),
    vision: t('sectionVision'),
    tts: t('sectionTts'),
    music: t('sectionMusic'),
  }

  return h(
    Fragment,
    null,
    !writable ? h('p', { className: 'dsh-llmm-read-only', role: 'status' }, t('readOnly')) : null,
    props.write.status !== 'idle'
      ? h(
        'p',
        { className: 'dsh-llmm-write-status', role: 'status', 'data-status': props.write.status },
        props.write.status === 'saving'
          ? t('writeSaving')
          : props.write.status === 'saved'
            ? t('writeSaved')
            : props.write.message || t('writeFailed'),
      )
      : null,
    props.loadingModels ? h('p', { className: 'dsh-llmm-hint' }, t('loadingModels')) : null,
    props.loadError ? h('p', { className: 'dsh-llmm-hint' }, `${t('loadModelsFailed')}: ${props.loadError}`) : null,
    h(
      'ul',
      { className: 'dsh-llmm-section-list' },
      ...MODALITY_ORDER.map((m) => {
        const presets = models.byModality[m] ?? []
        const presetOptions = presets.map((p) => ({
          value: `${p.provider}:${p.id}`,
          label: `${p.provider} / ${p.name || p.id}`,
        }))
        // The configured model is always offered, even when the Host's catalog
        // no longer lists it (a removed provider, or a model that was written
        // by hand). Without this the `<select>` would fall back to the
        // placeholder and the saved selection would look lost.
        const state = snap[m]
        const currentValue =
          state.provider && state.provider !== 'custom' && state.defaultModel
            ? `${state.provider}:${state.defaultModel}`
            : ''
        const options =
          currentValue && !presetOptions.some((o) => o.value === currentValue)
            ? [...presetOptions, { value: currentValue, label: `${state.provider} / ${state.defaultModel} (${t('currentModelOption')})` }]
            : presetOptions
        return h(ModalitySection, {
          key: m,
          modality: m,
          label: sectionLabel[m],
          state,
          presetOptions: options,
          hasAnyPreset: presets.length > 0,
          t,
          writable,
          onDropdownChange: (val: string) => {
            if (val === '') {
              props.reset(m)
              return
            }
            if (val === 'custom') {
              props.setWhole(m, {
                provider: 'custom',
                apiProtocol: state.apiProtocol,
                baseURL: state.baseURL,
                apiKey: state.apiKey,
                defaultModel: state.defaultModel,
                voice: state.voice,
              })
              return
            }
            const splitIdx = val.indexOf(':')
            const pid = splitIdx > 0 ? val.slice(0, splitIdx) : val
            const modelId = splitIdx > 0 ? val.slice(splitIdx + 1) : ''
            props.setWhole(m, {
              provider: pid,
              apiProtocol: '',
              baseURL: '',
              apiKey: '',
              defaultModel: modelId,
              voice: state.voice,
            })
          },
          onFieldChange: (field: keyof ModalityState, value: string) => props.setField(m, field, value),
          onReset: () => props.reset(m),
        })
      }),
    ),
  )
}

interface SettingsCardProps {
  t: (key: keyof LocaleDict) => string
  /** The page asks for "summary" (a one-liner) or "page" (the whole card). */
  view?: string
  useLlmMultimodal: <R>(selector: (snapshot: CardSnapshot) => R) => R
  setField: (modality: ModalityKey, field: keyof ModalityState, value: string) => void
  setWhole: (modality: ModalityKey, value: ModalityState) => void
  reset: (modality: ModalityKey) => void
}

function SettingsCard(props: SettingsCardProps): ReactElement | null {
  const { t, setField, setWhole, reset } = props
  const snap = props.useLlmMultimodal((s) => s)
  const isPage = props.view !== 'summary'
  const [open, setOpen] = useState(isPage)
  const catalog = useModelCatalog(open)

  // The Plugins page renders this slot twice: once as the card's one-liner
  // and once as the plugin's own page.
  if (props.view === 'summary') return h('span', { className: 'dsh-llmm-summary' }, t('description'))

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
    open ? h(ModelPicker, {
      t,
      snap,
      models: catalog.models,
      loadingModels: catalog.loadingModels,
      loadError: catalog.loadError,
      write: snap.write,
      setField,
      setWhole,
      reset,
    }) : null,
  )
}

/**
 * The same pickers, mounted as a page inside the host's Plugins settings
 * section (`settings.plugins.tab`).
 *
 * The Plugins page card and this tab share one body, so the models can be
 * configured from either entry.
 */
function SettingsTab(props: SettingsCardProps): ReactElement {
  const { t, setField, setWhole, reset } = props
  const snap = props.useLlmMultimodal((s) => s)
  const catalog = useModelCatalog(true)
  return h(
    'div',
    { className: 'dsh-llmm-card dsh-llmm-card-open' },
    h(ModelPicker, {
      t,
      snap,
      models: catalog.models,
      loadingModels: catalog.loadingModels,
      loadError: catalog.loadError,
      write: snap.write,
      setField,
      setWhole,
      reset,
    }),
  )
}

export function apply(ctx: Context): void {
  ensureStyles()
  const t = ctx.locale.bind(NS)
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'dsh-llm-multimodal: dictionaries',
  )

  // The Host-owned form for this plugin's settings namespace. Its snapshot
  // carries the accepted values, the namespace revision and the writability
  // flag; its writes go straight back to the profile patch.
  const form = ctx.configForms.get<Record<string, unknown>>(SETTINGS_NAMESPACE)

  // The outcome of the last write lives outside the Host snapshot: a refused
  // write leaves that snapshot untouched, so the card needs its own channel to
  // tell the user what happened.
  let writeState: WriteState = IDLE_WRITE
  const project = (): CardSnapshot => ({ ...projectSnapshot(form), write: writeState })
  const store = createSnapshotStore(project()) as SnapshotStore<CardSnapshot>
  const publish = () => store.set(project())
  ctx.effect(() => {
    const off = form.subscribe(publish)
    return () => {
      off()
      void form.dispose?.()
    }
  }, 'dsh-llm-multimodal: form subscription')

  /**
   * One atomic Host write per user action.
   *
   * `form.mutate()` resolves to `false` when the Host refuses the write — most
   * often because the namespace revision moved on since the card last read it
   * (another writer, a profile edit, or a second surface of this card). The
   * controller reloads the mirror before giving up, so one retry carries the
   * fresh revision and is accepted. The outcome is published to the card,
   * because a refused write would otherwise look exactly like "nothing
   * happened".
   */
  type PathOp = { op: 'set'; path: string[]; value: string } | { op: 'unset'; path: string[] }
  type PathOps = Parameters<ConfigForm<unknown>['mutate']>[0]

  const runWrite = async (ops: PathOp[]): Promise<boolean> => {
    writeState = { status: 'saving', message: '' }
    publish()
    let ok = false
    try {
      ok = await form.mutate(ops as PathOps)
    } catch {
      ok = false
    }
    if (!ok) {
      // The controller has recovered the mirror by now, so the retry fences
      // the write with the revision the Host actually holds.
      await new Promise((resolve) => setTimeout(resolve, 150))
      try {
        ok = await form.mutate(ops as PathOps)
      } catch {
        ok = false
      }
    }
    writeState = ok
      ? { status: 'saved', message: '' }
      : { status: 'error', message: t('writeFailed') }
    publish()
    return ok
  }

  const setField = (m: ModalityKey, field: keyof ModalityState, value: string) => {
    void runWrite([{ op: 'set', path: [m, field], value }])
  }

  const setWhole = (m: ModalityKey, value: ModalityState) => {
    const ops = MODALITY_FIELDS[m].map((field) => ({
      op: 'set' as const,
      path: [m, field],
      value: value[field] ?? '',
    }))
    void runWrite(ops)
  }

  const resetModality = (m: ModalityKey) => {
    const ops = MODALITY_FIELDS[m].map((field) => ({
      op: 'unset' as const,
      path: [m, field],
    }))
    void runWrite(ops)
  }

  // Stay registered exactly while the Host serves the `llm-multimodal`
  // namespace, so a deployment without this plugin shows no trace of it.
  ctx.effect(
    () => ctx.configForms.whileServed([SETTINGS_NAMESPACE], () =>
      ctx.slots.inject('plugins.item', () =>
        ctx.slots.register({
          name: 'plugins.item',
          // The id the Plugins page lists and dispatches the slot by.
          id: SETTINGS_NAMESPACE,
          order: 40,
          label: () => t('title'),
          locale: NS,
          inject: () => ({
            hooks: { llmMultimodal: store },
            setField,
            setWhole,
            reset: resetModality,
          }),
        }, SettingsCard))),
    'dsh-llm-multimodal: page',
  )

  // The same page inside the host's Plugins settings section, so the models
  // are configurable from Settings → Plugins as well as from the Plugins
  // page itself.
  ctx.effect(
    () => ctx.configForms.whileServed([SETTINGS_NAMESPACE], () =>
      ctx.slots.inject('settings.plugins.tab', () =>
        ctx.slots.register({
          name: 'settings.plugins.tab',
          // The id the Plugins settings section lists the tab by.
          id: SETTINGS_NAMESPACE,
          order: 20,
          label: () => t('title'),
          locale: NS,
          inject: () => ({
            hooks: { llmMultimodal: store },
            setField,
            setWhole,
            reset: resetModality,
          }),
        }, SettingsTab))),
    'dsh-llm-multimodal: settings tab',
  )
}
