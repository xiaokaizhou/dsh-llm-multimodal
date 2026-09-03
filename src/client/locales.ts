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
}