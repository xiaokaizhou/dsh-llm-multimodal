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
  useMemo,
  useState,
  type ReactElement,
} from 'react'
import type {
  CapabilityModelRow,
  CapabilityOverrideEntry,
  CapabilityProviderRow,
  CapabilitySource,
  Context,
  ModalityKey,
} from './context-types.ts'
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

/**
 * The six modalities this plugin serves. The key set is shared with the
 * capability matrix (see `context-types.ts`).
 */
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

/** Field-wise equality for one modality section (used to retire a local draft). */
function modalityEquals(m: ModalityKey, a: ModalityState, b: ModalityState): boolean {
  return MODALITY_FIELDS[m].every((field) => (a[field] ?? '') === (b[field] ?? ''))
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

/**
 * Structural styles for the pickers, applied inline for the same reason as
 * the capability panel: a stylesheet that the host scopes or rewrites must not
 * be able to flatten a settings form into unformatted text. Everything reads
 * its colours from host custom properties, which inherit across boundaries.
 */
const PICK = {
  section: { listStyle: 'none', margin: 0, padding: '10px 0', borderTop: '1px solid var(--dsw-alias-border-l2)' },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  sectionLabel: { fontSize: 13, fontWeight: 600 as const, color: 'var(--dsw-alias-label-primary)' },
  summary: { flex: '1 1 160px', minWidth: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  body: { display: 'flex', flexDirection: 'column' as const, gap: 2, marginTop: 6 },
  field: { display: 'flex', flexDirection: 'column' as const, gap: 4, padding: '6px 0' },
  label: { fontSize: 12.5, fontWeight: 500 as const, color: 'var(--dsw-alias-label-secondary)' },
  hint: { margin: 0, fontSize: 11.5, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  input: {
    height: 32,
    padding: '0 10px',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8,
    background: 'var(--dsw-alias-bg-layer-2)',
    font: 'inherit',
    fontSize: 12.5,
    color: 'var(--dsw-alias-label-primary)',
    boxSizing: 'border-box' as const,
    width: '100%',
  },
  btn: {
    appearance: 'none' as const,
    font: 'inherit',
    fontSize: 11.5,
    padding: '3px 10px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
  },
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
    { className: 'dsh-llmm-section', style: PICK.section },
    h(
      'div',
      { className: 'dsh-llmm-section-row', style: PICK.row },
      h('span', { className: 'dsh-llmm-section-label', style: PICK.sectionLabel }, props.label),
      h('span', { className: 'dsh-llmm-section-summary', style: PICK.summary }, summary),
      h(
        'button',
        {
          type: 'button',
          className: 'dsh-llmm-reset-btn',
          style: withStyle(PICK.btn, props.state.provider === '' ? { opacity: 0.45 } : null),
          disabled: !props.writable || props.state.provider === '',
          onClick: () => props.onReset(),
        },
        props.t('resetToNone'),
      ),
    ),
    h(
      'div',
      { className: 'dsh-llmm-section-body', style: PICK.body },
      h(
        'label',
        { className: 'dsh-llmm-field', style: PICK.field },
        h('span', { className: 'dsh-llmm-label', style: PICK.label }, props.t('defaultModel')),
        h(
          'select',
          {
            className: 'dsh-llmm-select',
            style: { ...PICK.input, appearance: 'auto' as const },
            value: dropdownValue,
            disabled: !props.writable,
            onChange: (e: any) => props.onDropdownChange(e.target.value),
          },
          h('option', { value: '' }, props.t('chooseModel')),
          h('option', { value: 'custom' }, props.t('chooseCustom')),
          ...props.presetOptions.map((o) => h('option', { key: o.value, value: o.value }, o.label)),
        ),
        h('span', { className: 'dsh-llmm-hint', style: PICK.hint }, props.t('defaultModelHint')),
      ),
      isCustom && h(Fragment, null,
        h(
          'label',
          { className: 'dsh-llmm-field', style: PICK.field },
          h('span', { className: 'dsh-llmm-label', style: PICK.label }, props.t('apiProtocol')),
          h(
            'select',
            {
              className: 'dsh-llmm-select',
            style: { ...PICK.input, appearance: 'auto' as const },
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
          h('span', { className: 'dsh-llmm-hint', style: PICK.hint }, props.t('apiProtocolHint')),
        ),
        h(
          'label',
          { className: 'dsh-llmm-field', style: PICK.field },
          h('span', { className: 'dsh-llmm-label', style: PICK.label }, props.t('baseURL')),
          h('input', {
            className: 'dsh-llmm-input',
            style: PICK.input,
            type: 'text',
            value: props.state.baseURL,
            placeholder: 'https://api.example.com/v1',
            disabled: !props.writable,
            onChange: (e: any) => props.onFieldChange('baseURL', e.target.value),
          }),
          h('span', { className: 'dsh-llmm-hint', style: PICK.hint }, props.t('baseURLHint')),
        ),
        h(
          'label',
          { className: 'dsh-llmm-field', style: PICK.field },
          h('span', { className: 'dsh-llmm-label', style: PICK.label }, props.t('apiKey')),
          h('input', {
            className: 'dsh-llmm-input',
            style: PICK.input,
            type: 'password',
            value: props.state.apiKey,
            disabled: !props.writable,
            onChange: (e: any) => props.onFieldChange('apiKey', e.target.value),
          }),
          h('span', { className: 'dsh-llmm-hint', style: PICK.hint }, props.t('apiKeyHint')),
        ),
        h(
          'label',
          { className: 'dsh-llmm-field', style: PICK.field },
          h('span', { className: 'dsh-llmm-label', style: PICK.label }, props.t('defaultModel')),
          h('input', {
            className: 'dsh-llmm-input',
            style: PICK.input,
            type: 'text',
            value: props.state.defaultModel,
            placeholder: props.t('defaultModelPlaceholderCustom'),
            disabled: !props.writable,
            onChange: (e: any) => props.onFieldChange('defaultModel', e.target.value),
          }),
          h('span', { className: 'dsh-llmm-hint', style: PICK.hint }, props.t('defaultModelHint')),
        ),
      ),
      includeVoice && (isCustom || isPreset) && h(
        'label',
        { className: 'dsh-llmm-field', style: PICK.field },
        h('span', { className: 'dsh-llmm-label', style: PICK.label }, props.t('voice')),
        h('input', {
          className: 'dsh-llmm-input',
            style: PICK.input,
          type: 'text',
          value: props.state.voice,
          disabled: !props.writable,
          onChange: (e: any) => props.onFieldChange('voice', e.target.value),
        }),
        h('span', { className: 'dsh-llmm-hint', style: PICK.hint }, props.t('voiceHint')),
      ),
      // An empty bucket is the normal state for a modality the configured
      // providers simply do not serve (no speech model at all, say). Say so
      // instead of showing a dropdown with nothing but the placeholder.
      !props.hasAnyPreset && !props.state.provider && h(
        'p',
        { className: 'dsh-llmm-hint', style: PICK.hint },
        `${props.label}: ${props.t('noModelsHint')}`,
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

/* ── Capability matrix ─────────────────────────────────────────────────────
 *
 * The pickers above answer "which model do I use for each modality?". This
 * panel answers the question underneath it: "why was this model judged to be
 * an image model at all?" Every row shows the modalities the server resolved,
 * the evidence behind them (with its level) and the confidence, and every row
 * can be corrected by hand. A correction is persisted server-side next to the
 * profile patch file, so it survives a restart and outranks every automatic
 * guess — including the provider's own declared metadata.
 */

const CAPABILITY_LEVEL_LABEL: Record<string, keyof LocaleDict> = {
  override: 'sourceOverride',
  declared: 'sourceDeclared',
  provider: 'sourceProvider',
  rule: 'sourceRule',
  family: 'sourceFamily',
  fallback: 'sourceFallback',
}

const CAPABILITY_LEVEL_HINT: Record<string, keyof LocaleDict> = {
  override: 'sourceOverrideHint',
  declared: 'sourceDeclaredHint',
  provider: 'sourceProviderHint',
  rule: 'sourceRuleHint',
  family: 'sourceFamilyHint',
  fallback: 'sourceFallbackHint',
}

const MODALITY_LABEL: Record<ModalityKey, string> = {
  text: 'text',
  image: 'image',
  video: 'video',
  vision: 'vision',
  tts: 'tts',
  music: 'music',
}

function capabilityKeyOf(provider: string, id: string): string {
  return `${provider}:${id}`
}

function modalitiesOf(row: CapabilityModelRow): ModalityKey[] {
  const list = Array.isArray(row.modalities) ? row.modalities : []
  const known = list.filter((m): m is ModalityKey => MODALITY_ORDER.includes(m as ModalityKey))
  // A row from an older host build carries only the flat `type`; fall back to
  // it so the panel still renders something truthful.
  if (known.length > 0) return known
  const flat = (row.primary || row.type || 'text') as ModalityKey
  return MODALITY_ORDER.includes(flat) ? [flat] : ['text']
}

interface CapabilityStatus {
  kind: 'idle' | 'saved' | 'error'
  text: string
}

/** Loads and mutates the server's capability model. */
function useCapabilityMatrix(enabled: boolean) {
  const [providers, setProviders] = useState<CapabilityProviderRow[]>([])
  const [overrides, setOverrides] = useState<Record<string, CapabilityOverrideEntry>>({})
  const [file, setFile] = useState('')
  const [rules, setRules] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [detecting, setDetecting] = useState('')
  const [status, setStatus] = useState<CapabilityStatus>({ kind: 'idle', text: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [modelsRes, capsRes] = await Promise.all([
        fetch('/api/llm-multimodal/models', { method: 'GET' }),
        fetch('/api/llm-multimodal/capabilities', { method: 'GET' }),
      ])
      const modelsData = await modelsRes.json()
      const capsData = await capsRes.json()
      if (!modelsData || !modelsData.ok) {
        setLoadError((modelsData && modelsData.error) || 'unexpected response')
        return
      }
      setProviders(Array.isArray(modelsData.providers) ? modelsData.providers : [])
      if (capsData && capsData.ok) {
        setOverrides(capsData.overrides && typeof capsData.overrides === 'object' ? capsData.overrides : {})
        setFile(String(capsData.file || ''))
        setRules(Array.isArray(capsData.rules) ? capsData.rules.length : 0)
      }
    } catch (e: any) {
      setLoadError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (enabled && providers.length === 0 && !loading && !loadError) void load()
  }, [enabled, providers.length, loading, loadError, load])

  /** Applies a server reply that carries a fresh catalog. */
  const applyCatalog = useCallback((data: any) => {
    if (Array.isArray(data?.providers)) setProviders(data.providers)
    if (data?.overrides && typeof data.overrides === 'object') setOverrides(data.overrides)
  }, [])

  const pin = useCallback(async (key: string, modalities: ModalityKey[]) => {
    setBusyKey(key)
    setStatus({ kind: 'idle', text: '' })
    try {
      const r = await fetch('/api/llm-multimodal/capabilities/override', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, modalities }),
      })
      const data = await r.json()
      if (!data || !data.ok) throw new Error((data && data.error) || `HTTP ${r.status}`)
      applyCatalog(data)
      setOverrides(data.overrides && typeof data.overrides === 'object' ? data.overrides : {})
      setStatus({ kind: 'saved', text: modalities.length > 0 ? 'saved' : 'cleared' })
      return true
    } catch (e: any) {
      setStatus({ kind: 'error', text: e?.message || String(e) })
      return false
    } finally {
      setBusyKey('')
    }
  }, [applyCatalog])

  const detect = useCallback(async (provider: string) => {
    setDetecting(provider)
    setStatus({ kind: 'idle', text: '' })
    try {
      const r = await fetch('/api/llm-multimodal/detect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      const data = await r.json()
      if (!data || !data.ok) throw new Error((data && data.error) || `HTTP ${r.status}`)
      applyCatalog(data)
      const merged = typeof data.merged === 'number'
        ? data.merged
        : Array.isArray(data.results)
          ? data.results.reduce((sum: number, item: any) => sum + Number(item?.models || 0), 0)
          : 0
      setStatus({ kind: 'saved', text: `detected:${merged}` })
      return true
    } catch (e: any) {
      setStatus({ kind: 'error', text: e?.message || String(e) })
      return false
    } finally {
      setDetecting('')
    }
  }, [applyCatalog])

  return { providers, overrides, file, rules, loading, loadError, busyKey, detecting, status, load, pin, detect }
}

interface CapabilityMatrixProps {
  t: (key: keyof LocaleDict) => string
  enabled: boolean
}

/**
 * The "模型能力矩阵" panel.
 *
 * Rendering is deliberately read-mostly: the chips are the *verdict*, and only
 * an explicit "编辑模态" turns them into a control. That keeps a stray click
 * from overwriting a model's capabilities for every future tool call.
 */
const CAPS = {
  head: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: 8 },
  title: { fontSize: 13, fontWeight: 600 as const, color: 'var(--dsw-alias-label-primary)' },
  meta: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' as const },
  file: {
    display: 'block',
    marginTop: 6,
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    fontSize: 11,
    lineHeight: 1.5,
    color: 'var(--dsw-alias-label-tertiary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    maxWidth: '100%',
  },
  hint: { margin: '6px 0 0', fontSize: 12, lineHeight: 1.55, color: 'var(--dsw-alias-label-tertiary)' },
  status: { margin: '8px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  groups: { listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column' as const, gap: 10 },
  group: {
    listStyle: 'none',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 10,
    background: 'var(--dsw-alias-bg-layer-3)',
    padding: '10px 12px',
  },
  groupHead: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  groupName: { fontSize: 13, fontWeight: 600 as const, color: 'var(--dsw-alias-label-primary)' },
  groupMeta: {
    flex: '1 1 180px',
    minWidth: 0,
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    fontSize: 11,
    color: 'var(--dsw-alias-label-tertiary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  rows: { listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column' as const },
  row: { listStyle: 'none', borderTop: '1px solid var(--dsw-alias-border-l2)', padding: '9px 0' },
  rowHead: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' as const },
  id: {
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    fontSize: 12,
    color: 'var(--dsw-alias-label-primary)',
    wordBreak: 'break-all' as const,
  },
  name: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' },
  conf: { marginLeft: 'auto', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' as const },
  chips: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginTop: 7 },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 9px',
    borderRadius: 999,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-2)',
    fontSize: 11.5,
    lineHeight: 1.5,
    color: 'var(--dsw-alias-label-secondary)',
  },
  chipOn: { borderColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)' },
  chipPrimary: { borderStyle: 'dashed' as const },
  chipBadge: { fontSize: 9.5, letterSpacing: '.04em', textTransform: 'uppercase' as const, opacity: 0.75 },
  sources: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginTop: 7 },
  source: {
    padding: '1px 7px',
    borderRadius: 5,
    border: '1px solid var(--dsw-alias-border-l2)',
    fontSize: 11,
    lineHeight: 1.6,
    color: 'var(--dsw-alias-label-tertiary)',
  },
  actions: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginTop: 9, justifyContent: 'flex-end' },
  btn: {
    appearance: 'none' as const,
    font: 'inherit',
    fontSize: 11.5,
    lineHeight: 1.4,
    padding: '3px 10px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
  },
}

/** Merge a base style with conditional bits, skipping false entries. */
function withStyle(base: any, ...extra: Array<any>): any {
  const out = { ...base }
  for (const item of extra) if (item) Object.assign(out, item)
  return out
}

/**
 * The "模型能力矩阵" panel.
 *
 * Rendering is deliberately read-mostly: the chips are the *verdict*, and only
 * an explicit "编辑模态" turns them into a control. That keeps a stray click
 * from overwriting a model's capabilities for every future tool call.
 *
 * Layout is carried by inline styles rather than only by the injected
 * stylesheet: this panel is wide, dense and lives inside a host-rendered
 * card, and a stylesheet that fails to land (a host that scopes or rewrites
 * injected CSS) would otherwise leave a wall of unformatted text.
 */
function CapabilityMatrix(props: CapabilityMatrixProps): ReactElement {
  const { t, enabled } = props
  const matrix = useCapabilityMatrix(enabled)
  const [editing, setEditing] = useState('')
  const [draft, setDraft] = useState<ModalityKey[]>([])

  const beginEdit = (key: string, current: ModalityKey[]) => {
    setEditing(key)
    setDraft(current.slice())
  }

  const toggleDraft = (m: ModalityKey) => {
    setDraft((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))
  }

  const statusText = (() => {
    const { status } = matrix
    if (!status.text) return ''
    if (status.kind === 'error') return `${t('capabilitySaveFailed')}: ${status.text}`
    if (status.text === 'cleared') return t('capabilityCleared')
    if (status.text === 'saved') return t('capabilitySaved')
    if (status.text.startsWith('detected:')) {
      const n = status.text.slice('detected:'.length)
      return `${t('capabilityDetectDone')} · ${t('capabilityMerged')} ${n} ${t('capabilityMergedUnit')}`
    }
    return status.text
  })()

  const head = h(
    'div',
    { style: CAPS.head },
    h('span', { className: 'dsh-llmm-cap-title', style: CAPS.title }, t('capabilityTitle')),
    matrix.rules > 0
      ? h('span', { className: 'dsh-llmm-cap-meta', style: CAPS.meta }, `${t('capabilityRules')} ${matrix.rules} ${t('capabilityRulesUnit')}`)
      : null,
    h(
      'button',
      {
        type: 'button',
        className: 'dsh-llmm-cap-btn',
        style: withStyle(CAPS.btn, { marginLeft: 'auto' }, { opacity: matrix.loading ? 0.5 : 1 }),
        disabled: matrix.loading,
        onClick: () => { void matrix.load() },
      },
      matrix.loading ? t('capabilityLoading') : t('capabilityRedetect'),
    ),
  )

  const fileLine = matrix.file
    ? h('span', { className: 'dsh-llmm-cap-meta', style: CAPS.file, title: matrix.file }, `${t('capabilityOverridesFile')}: ${matrix.file}`)
    : null

  const renderRow = (pid: string, row: CapabilityModelRow, index: number) => {
    const key = capabilityKeyOf(pid, row.id)
    const current = modalitiesOf(row)
    const isEditing = editing === key
    const pinned = Boolean(matrix.overrides[key])
    const shown = isEditing ? draft : current
    const sources = Array.isArray(row.sources) ? row.sources : []
    const busy = matrix.busyKey === key
    return h(
      'li',
      {
        className: 'dsh-llmm-cap-row',
        key,
        style: withStyle(CAPS.row, index === 0 ? { borderTop: '0', paddingTop: 0 } : null),
      },
      h(
        'div',
        { style: CAPS.rowHead },
        h('span', { className: 'dsh-llmm-cap-id', style: CAPS.id }, row.id),
        row.name && row.name !== row.id ? h('span', { className: 'dsh-llmm-cap-name', style: CAPS.name }, row.name) : null,
        typeof row.confidence === 'number'
          ? h('span', { className: 'dsh-llmm-cap-conf', style: CAPS.conf }, `${t('capabilityConfidence')} ${row.confidence.toFixed(2)}`)
          : null,
      ),
      h(
        'div',
        { style: CAPS.chips, role: isEditing ? 'group' : undefined },
        ...MODALITY_ORDER.map((m) => {
          const on = shown.includes(m)
          if (!isEditing && !on) return null
          const isPrimary = (row.primary || row.type) === m
          const style = withStyle(
            CAPS.chip,
            on && !isEditing ? CAPS.chipOn : null,
            isPrimary ? CAPS.chipPrimary : null,
            isEditing ? { cursor: 'pointer', opacity: on ? 1 : 0.55 } : null,
            isEditing && on ? CAPS.chipOn : null,
          )
          const children = [
            h('span', { key: 'l' }, MODALITY_LABEL[m]),
            isPrimary ? h('span', { key: 'b', style: CAPS.chipBadge }, t('capabilityPrimary')) : null,
          ]
          if (!isEditing) {
            return h('span', { key: m, className: 'dsh-llmm-cap-chip', style, 'data-on': on ? 'true' : 'false' }, ...children)
          }
          return h(
            'button',
            {
              type: 'button',
              key: m,
              className: 'dsh-llmm-cap-chip dsh-llmm-cap-chip-btn',
              style,
              'data-on': on ? 'true' : 'false',
              'aria-pressed': on ? 'true' : 'false',
              disabled: busy,
              onClick: () => toggleDraft(m),
            },
            ...children,
          )
        }),
      ),
      sources.length > 0 && !isEditing
        ? h(
          'div',
          { style: CAPS.sources },
          ...sources.map((source, i) => {
            const level = String((source as any)?.level || 'fallback')
            const labelKey = CAPABILITY_LEVEL_LABEL[level] || 'sourceFallback'
            const hintKey = CAPABILITY_LEVEL_HINT[level] || 'sourceFallbackHint'
            return h(
              'span',
              {
                key: `${level}-${i}`,
                className: 'dsh-llmm-cap-source',
                style: withStyle(CAPS.source, level === 'override' ? CAPS.chipOn : null),
                'data-level': level,
                title: t(hintKey),
              },
              t(labelKey),
              (source as any)?.id
                ? h('span', { className: 'dsh-llmm-cap-source-id', style: { opacity: 0.8, marginLeft: 4 } }, String((source as any).id))
                : null,
            )
          }),
        )
        : null,
      h(
        'div',
        { style: CAPS.actions },
        isEditing
          ? h(Fragment, null,
            h('button', {
              type: 'button',
              className: 'dsh-llmm-cap-btn',
              style: CAPS.btn,
              disabled: busy || draft.length === 0,
              onClick: async () => {
                const ok = await matrix.pin(key, draft)
                if (ok) setEditing('')
              },
            }, busy ? t('capabilitySaving') : t('capabilitySave')),
            h('button', {
              type: 'button',
              className: 'dsh-llmm-cap-btn',
              style: CAPS.btn,
              onClick: () => setEditing(''),
            }, t('capabilityCancel')),
            pinned
              ? h('button', {
                type: 'button',
                className: 'dsh-llmm-cap-btn',
                style: CAPS.btn,
                disabled: busy,
                onClick: async () => {
                  const ok = await matrix.pin(key, [])
                  if (ok) setEditing('')
                },
              }, t('capabilityClear'))
              : null,
          )
          : h(Fragment, null,
            h('button', {
              type: 'button',
              className: 'dsh-llmm-cap-btn',
              style: CAPS.btn,
              disabled: busy,
              onClick: () => beginEdit(key, current),
            }, t('capabilityEdit')),
            pinned
              ? h('button', {
                type: 'button',
                className: 'dsh-llmm-cap-btn',
                style: CAPS.btn,
                disabled: busy,
                onClick: async () => { await matrix.pin(key, []) },
              }, t('capabilityClear'))
              : null,
          ),
      ),
    )
  }

  const body = (() => {
    if (matrix.loading && matrix.providers.length === 0) {
      return h('p', { className: 'dsh-llmm-cap-status', style: CAPS.status }, t('capabilityLoading'))
    }
    if (matrix.loadError) {
      return h('p', { className: 'dsh-llmm-cap-status', style: CAPS.status, 'data-status': 'error' }, `${t('capabilityLoadFailed')}: ${matrix.loadError}`)
    }
    if (matrix.providers.length === 0) {
      return h('p', { className: 'dsh-llmm-cap-status', style: CAPS.status }, t('capabilityEmpty'))
    }
    return h(
      'ul',
      { className: 'dsh-llmm-cap-groups', style: CAPS.groups },
      ...matrix.providers.map((provider) => {
        const pid = provider.id
        const models = Array.isArray(provider.models) ? provider.models : []
        const detecting = matrix.detecting === pid
        const noEndpoint = !provider.baseURL
        return h(
          'li',
          { className: 'dsh-llmm-cap-group', key: pid, style: CAPS.group },
          h(
            'div',
            { style: CAPS.groupHead },
            h('span', { className: 'dsh-llmm-cap-group-name', style: CAPS.groupName }, provider.displayName || provider.name || pid),
            h(
              'span',
              { className: 'dsh-llmm-cap-group-meta', style: CAPS.groupMeta, title: provider.baseURL || '' },
              `${pid} · ${models.length} ${t('capabilityModelsUnit')} · ${provider.baseURL || '—'}`,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-llmm-cap-btn',
                style: withStyle(CAPS.btn, (noEndpoint || detecting) ? { opacity: 0.5 } : null),
                disabled: noEndpoint || detecting,
                title: noEndpoint ? t('capabilityNoEndpoint') : '',
                onClick: () => { void matrix.detect(pid) },
              },
              detecting ? t('capabilityDetecting') : t('capabilityDetectGroup'),
            ),
          ),
          models.length === 0
            ? h('p', { style: CAPS.hint }, t('capabilityGroupEmpty'))
            : h('ul', { className: 'dsh-llmm-cap-rows', style: CAPS.rows }, ...models.map((row, i) => renderRow(pid, row, i))),
        )
      }),
    )
  })()

  return h(
    'div',
    { className: 'dsh-llmm-cap', style: { borderTop: '1px solid var(--dsw-alias-border-l2)', marginTop: 12, paddingTop: 12 } },
    head,
    fileLine,
    h('p', { className: 'dsh-llmm-cap-hint', style: CAPS.hint }, t('capabilityTitleHint')),
    statusText
      ? h('p', { className: 'dsh-llmm-cap-status', style: CAPS.status, 'data-status': matrix.status.kind, role: 'status' }, statusText)
      : null,
    body,
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
    open ? h(Fragment, null,
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
      // Below the pickers: the panel that explains (and can correct) the
      // modality verdict behind every catalog row.
      h(CapabilityMatrix, { t, enabled: open }),
    ) : null,
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
    h(CapabilityMatrix, { t, enabled: true }),
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
  // Selection made in this card, held until the Host snapshot catches up.
  //
  // `mutate()` writes the profile patch, but the Host does not always push a
  // fresh snapshot back to the writer that made the change. Projecting only
  // `form.getSnapshot()` therefore showed the *old* value right after a
  // successful write — the dropdown snapped back to “choose a model” and the
  // selection looked lost. A draft per modality is published immediately and
  // retired as soon as the snapshot agrees with it, so the card is correct
  // whether or not the Host echo arrives.
  const draft: Partial<Record<ModalityKey, ModalityState>> = {}
  const baseSnapshot = (): CardSnapshot => projectSnapshot(form)
  const project = (): CardSnapshot => {
    const base = baseSnapshot()
    const merged: CardSnapshot = { ...base, write: writeState }
    for (const m of MODALITY_ORDER) {
      const local = draft[m]
      if (local) merged[m] = { ...local, voice: local.voice ?? base[m].voice }
    }
    return merged
  }
  /** Drop drafts the Host snapshot already agrees with. */
  const retireSettledDrafts = (): void => {
    const base = baseSnapshot()
    for (const m of MODALITY_ORDER) {
      const local = draft[m]
      if (local && modalityEquals(m, base[m], local)) delete draft[m]
    }
  }
  const store = createSnapshotStore(project()) as SnapshotStore<CardSnapshot>
  const publish = () => store.set(project())
  ctx.effect(() => {
    const off = form.subscribe(() => {
      retireSettledDrafts()
      publish()
    })
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

  /**
   * Apply the ops through the plugin's HTTP settings route.
   *
   * Exists purely as a fallback for the card: the Host form refuses a write
   * when its namespace revision moved on, and a controller that keeps
   * resending a stale revision turns every selection into a no-op.
   */
  const postSettingsOps = async (ops: PathOp[]): Promise<boolean> => {
    try {
      const res = await fetch('/api/llm-multimodal/settings/mutate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ops }),
      })
      if (!res.ok) return false
      const payload = (await res.json()) as { ok?: boolean }
      return payload?.ok === true
    } catch {
      return false
    }
  }

  type PathOps = Parameters<ConfigForm<unknown>['mutate']>[0]

  const runWrite = async (ops: PathOp[], rollback?: () => void): Promise<boolean> => {
    writeState = { status: 'saving', message: '' }
    publish()
    let ok = false
    try {
      ok = await form.mutate(ops as PathOps)
    } catch {
      ok = false
    }
    for (const delay of [120, 400]) {
      if (ok) break
      // The controller has recovered the mirror by now, so the retry fences
      // the write with the revision the Host actually holds.
      await new Promise((resolve) => setTimeout(resolve, delay))
      try {
        ok = await form.mutate(ops as PathOps)
      } catch {
        ok = false
      }
    }
    // Last resort: the plugin's own settings route applies the very same ops
    // through the Host's settings provider without revision fencing. A card
    // whose controller keeps a stale revision would otherwise look dead — the
    // dropdown simply snapping back to “choose a model”.
    if (!ok) ok = await postSettingsOps(ops)
    if (ok) {
      // Ask the controller for the accepted value; when it has none to give
      // the local draft keeps the card truthful either way.
      try {
        await (form as { reload?: () => Promise<unknown> }).reload?.()
      } catch {
        /* a controller without reload() keeps the draft as the source */
      }
      retireSettledDrafts()
    } else {
      rollback?.()
    }
    writeState = ok
      ? { status: 'saved', message: '' }
      : { status: 'error', message: t('writeFailed') }
    publish()
    return ok
  }

  const setField = (m: ModalityKey, field: keyof ModalityState, value: string) => {
    const previous = draft[m]
    draft[m] = { ...(draft[m] ?? projectSnapshot(form)[m]), [field]: value }
    publish()
    void runWrite([{ op: 'set', path: [m, field], value }], () => {
      if (previous) draft[m] = previous
      else delete draft[m]
    })
  }

  const setWhole = (m: ModalityKey, value: ModalityState) => {
    const previous = draft[m]
    draft[m] = { ...value }
    publish()
    const ops = MODALITY_FIELDS[m].map((field) => ({
      op: 'set' as const,
      path: [m, field],
      value: value[field] ?? '',
    }))
    void runWrite(ops, () => {
      if (previous) draft[m] = previous
      else delete draft[m]
    })
  }

  const resetModality = (m: ModalityKey) => {
    const previous = draft[m]
    draft[m] = { ...EMPTY_MODALITY, voice: projectSnapshot(form)[m].voice }
    publish()
    const ops = MODALITY_FIELDS[m].map((field) => ({
      op: 'unset' as const,
      path: [m, field],
    }))
    void runWrite(ops, () => {
      if (previous) draft[m] = previous
      else delete draft[m]
    })
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
