/**
 * Locale dictionary for the dsh-llm-multimodal settings card.
 *
 * Keys are exposed through `ctx.locale.bind(NS)` and consumed in the
 * card via `t(key)`. Mirrors the pattern in dsh-restart / dsh-rewind-plugin.
 */

export type Locale = 'zh' | 'en'

export interface LocaleDict {
  title: string
  description: string
  expand: string
  collapse: string
  readOnly: string
  notConfigured: string
  configuredFromPreset: string
  selected: string
  chooseModel: string
  chooseCustom: string
  sectionText: string
  sectionImage: string
  sectionVideo: string
  sectionVision: string
  sectionTts: string
  sectionMusic: string
  apiProtocol: string
  apiProtocolHint: string
  baseURL: string
  baseURLHint: string
  apiKey: string
  apiKeyHint: string
  apiKeyConfigured: string
  apiKeyNotConfigured: string
  defaultModel: string
  defaultModelHint: string
  defaultModelPlaceholderPreset: string
  defaultModelPlaceholderCustom: string
  voice: string
  voiceHint: string
  loadingModels: string
  loadModelsFailed: string
  noModelsHint: string
  resetToNone: string
  writeSaving: string
  writeSaved: string
  writeFailed: string
  currentModelOption: string
  // ── Model capability matrix ────────────────────────────────────────────
  capabilityTitle: string
  capabilityTitleHint: string
  capabilityLoading: string
  capabilityLoadFailed: string
  capabilityEmpty: string
  capabilityColumnModel: string
  capabilityColumnModalities: string
  capabilityColumnConfidence: string
  capabilityColumnSources: string
  capabilityConfidence: string
  capabilityPrimary: string
  capabilityContextWindow: string
  capabilityMaxTokens: string
  capabilityEdit: string
  capabilitySave: string
  capabilityCancel: string
  capabilityClear: string
  capabilitySaving: string
  capabilitySaved: string
  capabilitySaveFailed: string
  capabilityCleared: string
  capabilityClearFailed: string
  capabilityRedetect: string
  capabilityDetecting: string
  capabilityDetectDone: string
  capabilityDetectFailed: string
  capabilityMerged: string
  capabilityMergedUnit: string
  capabilityOverridesFile: string
  capabilityRules: string
  capabilityRulesUnit: string
  capabilityNoOverride: string
  sourceOverride: string
  sourceOverrideHint: string
  sourceDeclared: string
  sourceDeclaredHint: string
  sourceProvider: string
  sourceProviderHint: string
  sourceRule: string
  sourceRuleHint: string
  sourceFamily: string
  sourceFamilyHint: string
  sourceFallback: string
  sourceFallbackHint: string
}

export const zh: LocaleDict = {
  title: 'LLM 多模态',
  description: '为 generate_text / generate_image / generate_video / generate_tts / generate_music 五个工具配置模型。可直接选择 llm-pi-ai 中已配置的模型，或自定义一个新的 API 接入。',
  expand: '展开',
  collapse: '收起',
  readOnly: '当前设置不可写。',
  notConfigured: '未配置',
  configuredFromPreset: '已选择',
  selected: '已选',
  chooseModel: '请选择模型…',
  chooseCustom: '自定义',
  sectionText: '文本',
  sectionImage: '图像',
  sectionVideo: '视频',
  sectionVision: '视觉理解',
  sectionTts: '语音合成',
  sectionMusic: '音乐 / 音效',
  apiProtocol: 'API 协议',
  apiProtocolHint: 'openai / claude / anthropic / minimax 等。决定如何发送请求。',
  baseURL: 'Base URL',
  baseURLHint: '兼容 OpenAI 协议的服务地址（不含尾部路径），如 https://api.example.com/v1。',
  apiKey: 'API Key / 凭证',
  apiKeyHint: '明文保存到 settings.yaml。建议改用环境变量。',
  apiKeyConfigured: '已配置',
  apiKeyNotConfigured: '未配置',
  defaultModel: '模型 ID',
  defaultModelHint: '模型标识符，例：gpt-4o、claude-sonnet-4-5、minimax-speech-02-hd。',
  defaultModelPlaceholderPreset: '从下方下拉中选一个，或手动输入模型 ID',
  defaultModelPlaceholderCustom: '例如 gpt-4o、claude-sonnet-4-5',
  voice: '语音 ID',
  voiceHint: '语音预设 ID（MiniMax TTS 可填 male-qn-jingying / male-qn-qingse 等）。',
  loadingModels: '加载可用模型…',
  loadModelsFailed: '加载模型列表失败',
  noModelsHint: '「llm-pi-ai」中没有已配置的模型。直接选「自定义」即可接入。',
  resetToNone: '取消选择',
  writeSaving: '保存中…',
  writeSaved: '已保存',
  writeFailed: '保存失败（Host 拒绝了这次写入），请重试',
  currentModelOption: '当前配置',
  // ── Model capability matrix ────────────────────────────────────────────
  capabilityTitle: '模型能力矩阵',
  capabilityTitleHint: '展示每个模型被判定出的模态、判定来源与置信度。可手动纠正，纠正结果会持久化保存。',
  capabilityLoading: '加载能力矩阵…',
  capabilityLoadFailed: '加载能力矩阵失败',
  capabilityEmpty: '没有可显示的模型。',
  capabilityColumnModel: '模型',
  capabilityColumnModalities: '判定模态',
  capabilityColumnConfidence: '置信度',
  capabilityColumnSources: '判定来源',
  capabilityConfidence: '置信度',
  capabilityPrimary: '主',
  capabilityContextWindow: '上下文',
  capabilityMaxTokens: '最大输出',
  capabilityEdit: '编辑模态',
  capabilitySave: '保存',
  capabilityCancel: '取消',
  capabilityClear: '清除覆盖',
  capabilitySaving: '保存中…',
  capabilitySaved: '已保存手动判定',
  capabilitySaveFailed: '保存手动判定失败',
  capabilityCleared: '已清除手动判定，恢复自动判定',
  capabilityClearFailed: '清除手动判定失败',
  capabilityRedetect: '重新探测',
  capabilityDetecting: '探测中…',
  capabilityDetectDone: '探测完成',
  capabilityDetectFailed: '探测失败',
  capabilityMerged: '已合并',
  capabilityMergedUnit: '条服务端元数据',
  capabilityOverridesFile: '覆盖文件',
  capabilityRules: '生效规则',
  capabilityRulesUnit: '条',
  capabilityNoOverride: '无手动覆盖',
  sourceOverride: '手动指定',
  sourceOverrideHint: '你在本卡片手动指定，优先级最高，覆盖所有自动判定。',
  sourceDeclared: '服务商声明',
  sourceDeclaredHint: '来自服务商配置或模型列表中显式声明的字段。',
  sourceProvider: '在线探测',
  sourceProviderHint: '对服务商的模型列表接口在线探测得到的结果。',
  sourceRule: '家族规则',
  sourceRuleHint: '命中内置的模型家族规则（例如 gpt-4o 系列）。',
  sourceFamily: '家族默认',
  sourceFamilyHint: '该模型所属家族的默认模态集合。',
  sourceFallback: '兜底判定',
  sourceFallbackHint: '没有任何依据时的兜底结果，通常只保留文本。',
}

export const en: LocaleDict = {
  title: 'LLM Multimodal',
  description: 'Configure models for generate_text / generate_image / generate_video / generate_tts / generate_music. Pick a model from llm-pi-ai, or define a custom endpoint.',
  expand: 'Expand',
  collapse: 'Collapse',
  readOnly: 'Settings are read-only.',
  notConfigured: 'Not configured',
  configuredFromPreset: 'Selected',
  selected: 'Selected',
  chooseModel: 'Choose a model…',
  chooseCustom: 'Custom',
  sectionText: 'Text',
  sectionImage: 'Image',
  sectionVideo: 'Video',
  sectionVision: 'Vision',
  sectionTts: 'Speech (TTS)',
  sectionMusic: 'Music / Sound',
  apiProtocol: 'API Protocol',
  apiProtocolHint: 'openai / claude / anthropic / minimax / … Determines how requests are dispatched.',
  baseURL: 'Base URL',
  baseURLHint: 'OpenAI-compatible endpoint root, e.g. https://api.example.com/v1.',
  apiKey: 'API Key / Credential',
  apiKeyHint: 'Stored in settings.yaml in plain text. Prefer environment variables.',
  apiKeyConfigured: 'Configured',
  apiKeyNotConfigured: 'Not configured',
  defaultModel: 'Model ID',
  defaultModelHint: 'Model identifier, e.g. gpt-4o, claude-sonnet-4-5, minimax-speech-02-hd.',
  defaultModelPlaceholderPreset: 'Pick from the dropdown, or type a model ID',
  defaultModelPlaceholderCustom: 'e.g. gpt-4o, claude-sonnet-4-5',
  voice: 'Voice ID',
  voiceHint: 'Voice preset ID (e.g. MiniMax TTS male-qn-jingying / male-qn-qingse).',
  loadingModels: 'Loading available models…',
  loadModelsFailed: 'Failed to load model list',
  noModelsHint: 'No models configured under "llm-pi-ai". Pick "Custom" to define one.',
  resetToNone: 'Clear selection',
  writeSaving: 'Saving…',
  writeSaved: 'Saved',
  writeFailed: 'Save failed (the Host refused the write), please retry',
  currentModelOption: 'current',
  // ── Model capability matrix ────────────────────────────────────────────
  capabilityTitle: 'Model capability matrix',
  capabilityTitleHint: 'Shows every model\'s detected modalities, the evidence behind them and the confidence. Detections can be corrected by hand, and corrections are persisted.',
  capabilityLoading: 'Loading the capability matrix…',
  capabilityLoadFailed: 'Failed to load the capability matrix',
  capabilityEmpty: 'No models to show.',
  capabilityColumnModel: 'Model',
  capabilityColumnModalities: 'Detected modalities',
  capabilityColumnConfidence: 'Confidence',
  capabilityColumnSources: 'Evidence',
  capabilityConfidence: 'Confidence',
  capabilityPrimary: 'primary',
  capabilityContextWindow: 'Context',
  capabilityMaxTokens: 'Max output',
  capabilityEdit: 'Edit modalities',
  capabilitySave: 'Save',
  capabilityCancel: 'Cancel',
  capabilityClear: 'Clear override',
  capabilitySaving: 'Saving…',
  capabilitySaved: 'Manual detection saved',
  capabilitySaveFailed: 'Failed to save the manual detection',
  capabilityCleared: 'Manual detection cleared, automatic detection restored',
  capabilityClearFailed: 'Failed to clear the manual detection',
  capabilityRedetect: 'Re-probe',
  capabilityDetecting: 'Probing…',
  capabilityDetectDone: 'Probe finished',
  capabilityDetectFailed: 'Probe failed',
  capabilityMerged: 'merged',
  capabilityMergedUnit: 'server metadata entries',
  capabilityOverridesFile: 'Override file',
  capabilityRules: 'Active rules',
  capabilityRulesUnit: '',
  capabilityNoOverride: 'No manual override',
  sourceOverride: 'Manual',
  sourceOverrideHint: 'Set by you in this card — the strongest evidence, it overrides every automatic detection.',
  sourceDeclared: 'Declared',
  sourceDeclaredHint: 'Declared by the provider\'s own configuration or model list.',
  sourceProvider: 'Probed',
  sourceProviderHint: 'Collected by probing the provider\'s model list online.',
  sourceRule: 'Family rule',
  sourceRuleHint: 'An internal family rule matched this model id.',
  sourceFamily: 'Family default',
  sourceFamilyHint: 'The default modality set of the model\'s family.',
  sourceFallback: 'Fallback',
  sourceFallbackHint: 'No evidence matched, so the generic fallback was used.',
}