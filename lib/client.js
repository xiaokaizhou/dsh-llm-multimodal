window.__ModuleLoader__.load({
	id: "dsh-llm-multimodal",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		//#region src/client/locales.ts
		const zh = {
			title: "LLM 多模态",
			description: "为 generate_text / generate_image / generate_video / generate_tts / generate_music 五个工具配置模型。可直接选择 llm-pi-ai 中已配置的模型，或自定义一个新的 API 接入。",
			expand: "展开",
			collapse: "收起",
			readOnly: "当前设置不可写。",
			notConfigured: "未配置",
			configuredFromPreset: "已选择",
			selected: "已选",
			chooseModel: "请选择模型…",
			chooseCustom: "自定义",
			sectionText: "文本",
			sectionImage: "图像",
			sectionVideo: "视频",
			sectionVision: "视觉理解",
			sectionTts: "语音合成",
			sectionMusic: "音乐 / 音效",
			apiProtocol: "API 协议",
			apiProtocolHint: "openai / claude / anthropic / minimax 等。决定如何发送请求。",
			baseURL: "Base URL",
			baseURLHint: "兼容 OpenAI 协议的服务地址（不含尾部路径），如 https://api.example.com/v1。",
			apiKey: "API Key / 凭证",
			apiKeyHint: "明文保存到 settings.yaml。建议改用环境变量。",
			apiKeyConfigured: "已配置",
			apiKeyNotConfigured: "未配置",
			defaultModel: "模型 ID",
			defaultModelHint: "模型标识符，例：gpt-4o、claude-sonnet-4-5、minimax-speech-02-hd。",
			defaultModelPlaceholderPreset: "从下方下拉中选一个，或手动输入模型 ID",
			defaultModelPlaceholderCustom: "例如 gpt-4o、claude-sonnet-4-5",
			voice: "语音 ID",
			voiceHint: "语音预设 ID（MiniMax TTS 可填 male-qn-jingying / male-qn-qingse 等）。",
			loadingModels: "加载可用模型…",
			loadModelsFailed: "加载模型列表失败",
			noModelsHint: "没有识别到该分类的模型。可在下方「模型能力矩阵」把某个模型标记为此分类，或到「llm-pi-ai」给对应 provider 补充模型；也可以选「自定义」直接填 provider 接入。",
			resetToNone: "取消选择",
			writeSaving: "保存中…",
			writeSaved: "已保存",
			writeFailed: "保存失败（Host 拒绝了这次写入），请重试",
			currentModelOption: "当前配置",
			capabilityTitle: "模型能力矩阵",
			capabilityTitleHint: "展示每个模型被判定出的模态、判定来源与置信度。可手动纠正，纠正结果会持久化保存。",
			capabilityLoading: "加载能力矩阵…",
			capabilityLoadFailed: "加载能力矩阵失败",
			capabilityEmpty: "没有可显示的模型。",
			capabilityColumnModel: "模型",
			capabilityColumnModalities: "判定模态",
			capabilityColumnConfidence: "置信度",
			capabilityColumnSources: "判定来源",
			capabilityConfidence: "置信度",
			capabilityPrimary: "主",
			capabilityContextWindow: "上下文",
			capabilityMaxTokens: "最大输出",
			capabilityEdit: "编辑模态",
			capabilitySave: "保存",
			capabilityCancel: "取消",
			capabilityClear: "清除覆盖",
			capabilitySaving: "保存中…",
			capabilitySaved: "已保存手动判定",
			capabilitySaveFailed: "保存手动判定失败",
			capabilityCleared: "已清除手动判定，恢复自动判定",
			capabilityClearFailed: "清除手动判定失败",
			capabilityRedetect: "重新探测",
			capabilityDetecting: "探测中…",
			capabilityDetectDone: "探测完成",
			capabilityDetectFailed: "探测失败",
			capabilityMerged: "已合并",
			capabilityMergedUnit: "条服务端元数据",
			capabilityOverridesFile: "覆盖文件",
			capabilityRules: "生效规则",
			capabilityRulesUnit: "条",
			capabilityNoOverride: "无手动覆盖",
			sourceOverride: "手动指定",
			sourceOverrideHint: "你在本卡片手动指定，优先级最高，覆盖所有自动判定。",
			sourceDeclared: "服务商声明",
			sourceDeclaredHint: "来自服务商配置或模型列表中显式声明的字段。",
			sourceProvider: "在线探测",
			sourceProviderHint: "对服务商的模型列表接口在线探测得到的结果。",
			sourceRule: "家族规则",
			sourceRuleHint: "命中内置的模型家族规则（例如 gpt-4o 系列）。",
			sourceFamily: "家族默认",
			sourceFamilyHint: "该模型所属家族的默认模态集合。",
			sourceFallback: "兜底判定",
			sourceFallbackHint: "没有任何依据时的兜底结果，通常只保留文本。"
		};
		const en = {
			title: "LLM Multimodal",
			description: "Configure models for generate_text / generate_image / generate_video / generate_tts / generate_music. Pick a model from llm-pi-ai, or define a custom endpoint.",
			expand: "Expand",
			collapse: "Collapse",
			readOnly: "Settings are read-only.",
			notConfigured: "Not configured",
			configuredFromPreset: "Selected",
			selected: "Selected",
			chooseModel: "Choose a model…",
			chooseCustom: "Custom",
			sectionText: "Text",
			sectionImage: "Image",
			sectionVideo: "Video",
			sectionVision: "Vision",
			sectionTts: "Speech (TTS)",
			sectionMusic: "Music / Sound",
			apiProtocol: "API Protocol",
			apiProtocolHint: "openai / claude / anthropic / minimax / … Determines how requests are dispatched.",
			baseURL: "Base URL",
			baseURLHint: "OpenAI-compatible endpoint root, e.g. https://api.example.com/v1.",
			apiKey: "API Key / Credential",
			apiKeyHint: "Stored in settings.yaml in plain text. Prefer environment variables.",
			apiKeyConfigured: "Configured",
			apiKeyNotConfigured: "Not configured",
			defaultModel: "Model ID",
			defaultModelHint: "Model identifier, e.g. gpt-4o, claude-sonnet-4-5, minimax-speech-02-hd.",
			defaultModelPlaceholderPreset: "Pick from the dropdown, or type a model ID",
			defaultModelPlaceholderCustom: "e.g. gpt-4o, claude-sonnet-4-5",
			voice: "Voice ID",
			voiceHint: "Voice preset ID (e.g. MiniMax TTS male-qn-jingying / male-qn-qingse).",
			loadingModels: "Loading available models…",
			loadModelsFailed: "Failed to load model list",
			noModelsHint: "No model resolves to this modality. Mark one in the capability matrix below, add models to the provider in \"llm-pi-ai\", or pick \"Custom\" to point at a provider yourself.",
			resetToNone: "Clear selection",
			writeSaving: "Saving…",
			writeSaved: "Saved",
			writeFailed: "Save failed (the Host refused the write), please retry",
			currentModelOption: "current",
			capabilityTitle: "Model capability matrix",
			capabilityTitleHint: "Shows every model's detected modalities, the evidence behind them and the confidence. Detections can be corrected by hand, and corrections are persisted.",
			capabilityLoading: "Loading the capability matrix…",
			capabilityLoadFailed: "Failed to load the capability matrix",
			capabilityEmpty: "No models to show.",
			capabilityColumnModel: "Model",
			capabilityColumnModalities: "Detected modalities",
			capabilityColumnConfidence: "Confidence",
			capabilityColumnSources: "Evidence",
			capabilityConfidence: "Confidence",
			capabilityPrimary: "primary",
			capabilityContextWindow: "Context",
			capabilityMaxTokens: "Max output",
			capabilityEdit: "Edit modalities",
			capabilitySave: "Save",
			capabilityCancel: "Cancel",
			capabilityClear: "Clear override",
			capabilitySaving: "Saving…",
			capabilitySaved: "Manual detection saved",
			capabilitySaveFailed: "Failed to save the manual detection",
			capabilityCleared: "Manual detection cleared, automatic detection restored",
			capabilityClearFailed: "Failed to clear the manual detection",
			capabilityRedetect: "Re-probe",
			capabilityDetecting: "Probing…",
			capabilityDetectDone: "Probe finished",
			capabilityDetectFailed: "Probe failed",
			capabilityMerged: "merged",
			capabilityMergedUnit: "server metadata entries",
			capabilityOverridesFile: "Override file",
			capabilityRules: "Active rules",
			capabilityRulesUnit: "",
			capabilityNoOverride: "No manual override",
			sourceOverride: "Manual",
			sourceOverrideHint: "Set by you in this card — the strongest evidence, it overrides every automatic detection.",
			sourceDeclared: "Declared",
			sourceDeclaredHint: "Declared by the provider's own configuration or model list.",
			sourceProvider: "Probed",
			sourceProviderHint: "Collected by probing the provider's model list online.",
			sourceRule: "Family rule",
			sourceRuleHint: "An internal family rule matched this model id.",
			sourceFamily: "Family default",
			sourceFamilyHint: "The default modality set of the model's family.",
			sourceFallback: "Fallback",
			sourceFallbackHint: "No evidence matched, so the generic fallback was used."
		};
		//#endregion
		//#region src/client/styles.ts
		/**
		* Card chrome styles. Self-contained CSS injected once at apply() so the
		* settings card looks identical to other plugin cards in the
		* "Settings → 插件" tab.
		*
		* All visual properties use `var(--dsw-alias-*)` design tokens so the card
		* follows the host theme (light/dark) without extra wiring.
		*/
		const STYLE_ID = "dsh-llmm-card-styles";
		function ensureStyles() {
			if (document.getElementById(STYLE_ID) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = `
.dsh-llmm-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s;margin-bottom:12px}
.dsh-llmm-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-llmm-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dsh-llmm-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}
.dsh-llmm-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-llmm-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-llmm-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsh-llmm-description{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-llmm-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.dsh-llmm-chevron-open{transform:rotate(180deg)}
.dsh-llmm-read-only{margin:0 16px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-llmm-write-status{margin:0 16px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-llmm-write-status[data-status="saved"]{color:var(--dsw-alias-label-secondary)}
.dsh-llmm-write-status[data-status="error"]{color:var(--dsw-alias-alert-danger,var(--dsw-alias-label-primary))}
.dsh-llmm-section-list{list-style:none;padding:0 16px 16px;margin:0;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-llmm-section{list-style:none;border-top:1px solid var(--dsw-alias-border-l2);padding:10px 0}
.dsh-llmm-section-row{display:flex;align-items:center;gap:10px}
.dsh-llmm-section-label{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-llmm-section-summary{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-llmm-reset-btn{appearance:none;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 9px;cursor:pointer}
.dsh-llmm-reset-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsh-llmm-reset-btn:disabled{opacity:.4;cursor:default}
.dsh-llmm-section-body{display:flex;flex-direction:column;gap:10px;margin-top:8px}
.dsh-llmm-field{display:flex;flex-direction:column;gap:4px;padding:6px 0}
.dsh-llmm-label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-llmm-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-llmm-input,.dsh-llmm-select{height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-llmm-select{appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--dsw-alias-label-tertiary) 50%),linear-gradient(135deg,var(--dsw-alias-label-tertiary) 50%,transparent 50%);background-position:calc(100% - 16px) 16px,calc(100% - 11px) 16px;background-size:5px 5px;background-repeat:no-repeat;padding-right:32px}
.dsh-llmm-input:focus-visible,.dsh-llmm-select:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dsh-llmm-input:disabled,.dsh-llmm-select:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dsh-llmm-preset-info{font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3);border:1px dashed var(--dsw-alias-border-l2);border-radius:6px;padding:6px 10px}
.dsh-llmm-mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-label-primary)}
.dsh-llmm-cap{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px 16px;padding:14px 0 0}
.dsh-llmm-cap-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dsh-llmm-cap-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-llmm-cap-meta{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsh-llmm-cap-hint{margin:6px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-llmm-cap-status{margin:8px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-llmm-cap-status[data-status="saved"]{color:var(--dsw-alias-label-secondary)}
.dsh-llmm-cap-status[data-status="error"]{color:var(--dsw-alias-alert-danger,var(--dsw-alias-label-primary))}
.dsh-llmm-cap-groups{list-style:none;padding:0;margin:10px 0 0;display:flex;flex-direction:column;gap:12px}
.dsh-llmm-cap-group{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3);padding:10px 12px}
.dsh-llmm-cap-group-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dsh-llmm-cap-group-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-llmm-cap-group-meta{flex:1;min-width:0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-llmm-cap-btn{appearance:none;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 9px;cursor:pointer}
.dsh-llmm-cap-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsh-llmm-cap-btn:disabled{opacity:.4;cursor:default}
.dsh-llmm-cap-rows{list-style:none;padding:0;margin:10px 0 0;display:flex;flex-direction:column;gap:8px}
.dsh-llmm-cap-row{border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}
.dsh-llmm-cap-row:first-child{border-top:0;padding-top:0}
.dsh-llmm-cap-row-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.dsh-llmm-cap-id{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-primary)}
.dsh-llmm-cap-name{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsh-llmm-cap-conf{margin-left:auto;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.dsh-llmm-cap-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.dsh-llmm-cap-chip{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;line-height:1.4;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dsh-llmm-cap-chip[data-on="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsh-llmm-cap-chip-primary{border-style:dashed}
.dsh-llmm-cap-chip-badge{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary)}
.dsh-llmm-cap-chip-btn{appearance:none;font:inherit;cursor:pointer}
.dsh-llmm-cap-chip-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-llmm-cap-sources{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.dsh-llmm-cap-source{font-size:11px;line-height:1.4;padding:1px 7px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}
.dsh-llmm-cap-source[data-level="override"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsh-llmm-cap-source-id{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.dsh-llmm-cap-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
`;
			document.head.append(style);
		}
		//#endregion
		//#region src/client.tsx
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
		const name = "dsh-llm-multimodal-client";
		const inject = [
			"slots",
			"locale",
			"configForms"
		];
		/** Dictionary namespace owned by this card. */
		const NS = "llm-multimodal.card";
		/**
		* The Host-side settings namespace this card edits. It is the profile entry
		* id declared in `cordis.patch.yml` and the `Config` schema the host
		* validates the entry against.
		*/
		const SETTINGS_NAMESPACE = "llm-multimodal";
		/**
		* The six modalities this plugin serves. The key set is shared with the
		* capability matrix (see `context-types.ts`).
		*/
		const MODALITY_ORDER = [
			"text",
			"image",
			"video",
			"vision",
			"tts",
			"music"
		];
		/**
		* Field names of the host `Config` schema, per modality. The Host only
		* accepts writes that address a *volatile leaf*, so every write is expanded
		* into one op per leaf — a section-level write (`["image"]`) is rejected by
		* `isVolatilePath()`.
		*/
		const MODEL_FIELDS = [
			"provider",
			"apiProtocol",
			"baseURL",
			"apiKey",
			"defaultModel"
		];
		const AUDIO_FIELDS = [...MODEL_FIELDS, "voice"];
		const MODALITY_FIELDS = {
			text: MODEL_FIELDS,
			image: MODEL_FIELDS,
			video: MODEL_FIELDS,
			vision: MODEL_FIELDS,
			tts: AUDIO_FIELDS,
			music: AUDIO_FIELDS
		};
		const EMPTY_MODALITY = {
			provider: "",
			apiProtocol: "",
			baseURL: "",
			apiKey: "",
			defaultModel: "",
			voice: ""
		};
		const IDLE_WRITE = {
			status: "idle",
			message: ""
		};
		const EMPTY_MODELS = {
			providers: [],
			byModality: {
				text: [],
				image: [],
				video: [],
				vision: [],
				tts: [],
				music: []
			}
		};
		function coerceModality(v) {
			if (!v || typeof v !== "object") return { ...EMPTY_MODALITY };
			const r = v;
			return {
				provider: typeof r.provider === "string" ? r.provider : "",
				apiProtocol: typeof r.apiProtocol === "string" ? r.apiProtocol : "",
				baseURL: typeof r.baseURL === "string" ? r.baseURL : "",
				apiKey: typeof r.apiKey === "string" ? r.apiKey : "",
				defaultModel: typeof r.defaultModel === "string" ? r.defaultModel : "",
				voice: typeof r.voice === "string" ? r.voice : ""
			};
		}
		/** Field-wise equality for one modality section (used to retire a local draft). */
		function modalityEquals(m, a, b) {
			return MODALITY_FIELDS[m].every((field) => (a[field] ?? "") === (b[field] ?? ""));
		}
		/** Project the Host form snapshot into the card's own view model. */
		function projectSnapshot(form) {
			const snap = form.getSnapshot();
			const value = snap.value ?? {};
			return {
				available: snap.status === "ready",
				writable: snap.writable,
				write: IDLE_WRITE,
				text: coerceModality(value.text),
				image: coerceModality(value.image),
				video: coerceModality(value.video),
				vision: coerceModality(value.vision),
				tts: coerceModality(value.tts),
				music: coerceModality(value.music)
			};
		}
		function ModalitySection(props) {
			const isCustom = props.state.provider === "custom";
			const isPreset = props.state.provider !== "" && props.state.provider !== "custom";
			const matchedPresetValue = isPreset && props.state.defaultModel ? `${props.state.provider}:${props.state.defaultModel}` : "";
			const dropdownValue = isCustom ? "custom" : isPreset ? props.presetOptions.some((o) => o.value === matchedPresetValue) ? matchedPresetValue : "" : "";
			const includeVoice = props.modality === "tts" || props.modality === "music";
			const summary = (() => {
				if (props.state.provider === "") return props.t("notConfigured");
				if (props.state.provider === "custom") {
					const m = props.state.defaultModel || "…";
					return `${props.t("selected")}: custom / ${m}`;
				}
				return `${props.t("selected")}: ${props.state.provider} / ${props.state.defaultModel || "…"}`;
			})();
			return (0, react.createElement)("li", { className: "dsh-llmm-section" }, (0, react.createElement)("div", { className: "dsh-llmm-section-row" }, (0, react.createElement)("span", { className: "dsh-llmm-section-label" }, props.label), (0, react.createElement)("span", { className: "dsh-llmm-section-summary" }, summary), (0, react.createElement)("button", {
				type: "button",
				className: "dsh-llmm-reset-btn",
				disabled: !props.writable || props.state.provider === "",
				onClick: () => props.onReset()
			}, props.t("resetToNone"))), (0, react.createElement)("div", { className: "dsh-llmm-section-body" }, (0, react.createElement)("label", { className: "dsh-llmm-field" }, (0, react.createElement)("span", { className: "dsh-llmm-label" }, props.t("defaultModel")), (0, react.createElement)("select", {
				className: "dsh-llmm-select",
				value: dropdownValue,
				disabled: !props.writable,
				onChange: (e) => props.onDropdownChange(e.target.value)
			}, (0, react.createElement)("option", { value: "" }, props.t("chooseModel")), (0, react.createElement)("option", { value: "custom" }, props.t("chooseCustom")), ...props.presetOptions.map((o) => (0, react.createElement)("option", {
				key: o.value,
				value: o.value
			}, o.label))), (0, react.createElement)("span", { className: "dsh-llmm-hint" }, props.t("defaultModelHint"))), isCustom && (0, react.createElement)(react.Fragment, null, (0, react.createElement)("label", { className: "dsh-llmm-field" }, (0, react.createElement)("span", { className: "dsh-llmm-label" }, props.t("apiProtocol")), (0, react.createElement)("select", {
				className: "dsh-llmm-select",
				value: props.state.apiProtocol,
				disabled: !props.writable,
				onChange: (e) => props.onFieldChange("apiProtocol", e.target.value)
			}, (0, react.createElement)("option", { value: "" }, props.t("chooseModel")), (0, react.createElement)("option", { value: "openai" }, "openai"), (0, react.createElement)("option", { value: "claude" }, "claude"), (0, react.createElement)("option", { value: "anthropic" }, "anthropic"), (0, react.createElement)("option", { value: "minimax" }, "minimax"), (0, react.createElement)("option", { value: "elevenlabs" }, "elevenlabs")), (0, react.createElement)("span", { className: "dsh-llmm-hint" }, props.t("apiProtocolHint"))), (0, react.createElement)("label", { className: "dsh-llmm-field" }, (0, react.createElement)("span", { className: "dsh-llmm-label" }, props.t("baseURL")), (0, react.createElement)("input", {
				className: "dsh-llmm-input",
				type: "text",
				value: props.state.baseURL,
				placeholder: "https://api.example.com/v1",
				disabled: !props.writable,
				onChange: (e) => props.onFieldChange("baseURL", e.target.value)
			}), (0, react.createElement)("span", { className: "dsh-llmm-hint" }, props.t("baseURLHint"))), (0, react.createElement)("label", { className: "dsh-llmm-field" }, (0, react.createElement)("span", { className: "dsh-llmm-label" }, props.t("apiKey")), (0, react.createElement)("input", {
				className: "dsh-llmm-input",
				type: "password",
				value: props.state.apiKey,
				disabled: !props.writable,
				onChange: (e) => props.onFieldChange("apiKey", e.target.value)
			}), (0, react.createElement)("span", { className: "dsh-llmm-hint" }, props.t("apiKeyHint"))), (0, react.createElement)("label", { className: "dsh-llmm-field" }, (0, react.createElement)("span", { className: "dsh-llmm-label" }, props.t("defaultModel")), (0, react.createElement)("input", {
				className: "dsh-llmm-input",
				type: "text",
				value: props.state.defaultModel,
				placeholder: props.t("defaultModelPlaceholderCustom"),
				disabled: !props.writable,
				onChange: (e) => props.onFieldChange("defaultModel", e.target.value)
			}), (0, react.createElement)("span", { className: "dsh-llmm-hint" }, props.t("defaultModelHint")))), includeVoice && (isCustom || isPreset) && (0, react.createElement)("label", { className: "dsh-llmm-field" }, (0, react.createElement)("span", { className: "dsh-llmm-label" }, props.t("voice")), (0, react.createElement)("input", {
				className: "dsh-llmm-input",
				type: "text",
				value: props.state.voice,
				disabled: !props.writable,
				onChange: (e) => props.onFieldChange("voice", e.target.value)
			}), (0, react.createElement)("span", { className: "dsh-llmm-hint" }, props.t("voiceHint"))), !props.hasAnyPreset && !props.state.provider && (0, react.createElement)("p", { className: "dsh-llmm-hint" }, `${props.label}: ${props.t("noModelsHint")}`)));
		}
		/**
		* Loads the model catalog the Host discovers from `llm-pi-ai`.
		*
		* The catalog is only needed once the user can see a picker, so the fetch
		* starts when `enabled` flips to true.
		*/
		function useModelCatalog(enabled) {
			const [models, setModels] = (0, react.useState)(EMPTY_MODELS);
			const [loadingModels, setLoadingModels] = (0, react.useState)(false);
			const [loadError, setLoadError] = (0, react.useState)("");
			const reloadModels = (0, react.useCallback)(async () => {
				setLoadingModels(true);
				setLoadError("");
				try {
					const data = await (await fetch("/api/llm-multimodal/models", { method: "GET" })).json();
					if (data && data.ok && data.byModality) setModels({
						providers: data.providers ?? [],
						byModality: {
							text: data.byModality.text ?? [],
							image: data.byModality.image ?? [],
							video: data.byModality.video ?? [],
							vision: data.byModality.vision ?? [],
							tts: data.byModality.tts ?? [],
							music: data.byModality.music ?? []
						}
					});
					else setLoadError(data && data.error || "unexpected response");
				} catch (e) {
					setLoadError(e?.message || String(e));
				} finally {
					setLoadingModels(false);
				}
			}, []);
			(0, react.useEffect)(() => {
				if (enabled && models.providers.length === 0 && !loadingModels) reloadModels();
			}, [
				enabled,
				models.providers.length,
				loadingModels,
				reloadModels
			]);
			return {
				models,
				loadingModels,
				loadError
			};
		}
		/**
		* The per-modality model pickers.
		*
		* Shared by the Plugins page card and the Plugins settings tab, so the same
		* controls are reachable from both entries.
		*/
		function ModelPicker(props) {
			const { t, snap, models } = props;
			const writable = snap.writable;
			const sectionLabel = {
				text: t("sectionText"),
				image: t("sectionImage"),
				video: t("sectionVideo"),
				vision: t("sectionVision"),
				tts: t("sectionTts"),
				music: t("sectionMusic")
			};
			return (0, react.createElement)(react.Fragment, null, !writable ? (0, react.createElement)("p", {
				className: "dsh-llmm-read-only",
				role: "status"
			}, t("readOnly")) : null, props.write.status !== "idle" ? (0, react.createElement)("p", {
				className: "dsh-llmm-write-status",
				role: "status",
				"data-status": props.write.status
			}, props.write.status === "saving" ? t("writeSaving") : props.write.status === "saved" ? t("writeSaved") : props.write.message || t("writeFailed")) : null, props.loadingModels ? (0, react.createElement)("p", { className: "dsh-llmm-hint" }, t("loadingModels")) : null, props.loadError ? (0, react.createElement)("p", { className: "dsh-llmm-hint" }, `${t("loadModelsFailed")}: ${props.loadError}`) : null, (0, react.createElement)("ul", { className: "dsh-llmm-section-list" }, ...MODALITY_ORDER.map((m) => {
				const presets = models.byModality[m] ?? [];
				const presetOptions = presets.map((p) => ({
					value: `${p.provider}:${p.id}`,
					label: `${p.provider} / ${p.name || p.id}`
				}));
				const state = snap[m];
				const currentValue = state.provider && state.provider !== "custom" && state.defaultModel ? `${state.provider}:${state.defaultModel}` : "";
				const options = currentValue && !presetOptions.some((o) => o.value === currentValue) ? [...presetOptions, {
					value: currentValue,
					label: `${state.provider} / ${state.defaultModel} (${t("currentModelOption")})`
				}] : presetOptions;
				return (0, react.createElement)(ModalitySection, {
					key: m,
					modality: m,
					label: sectionLabel[m],
					state,
					presetOptions: options,
					hasAnyPreset: presets.length > 0,
					t,
					writable,
					onDropdownChange: (val) => {
						if (val === "") {
							props.reset(m);
							return;
						}
						if (val === "custom") {
							props.setWhole(m, {
								provider: "custom",
								apiProtocol: state.apiProtocol,
								baseURL: state.baseURL,
								apiKey: state.apiKey,
								defaultModel: state.defaultModel,
								voice: state.voice
							});
							return;
						}
						const splitIdx = val.indexOf(":");
						const pid = splitIdx > 0 ? val.slice(0, splitIdx) : val;
						const modelId = splitIdx > 0 ? val.slice(splitIdx + 1) : "";
						props.setWhole(m, {
							provider: pid,
							apiProtocol: "",
							baseURL: "",
							apiKey: "",
							defaultModel: modelId,
							voice: state.voice
						});
					},
					onFieldChange: (field, value) => props.setField(m, field, value),
					onReset: () => props.reset(m)
				});
			})));
		}
		const CAPABILITY_LEVEL_LABEL = {
			override: "sourceOverride",
			declared: "sourceDeclared",
			provider: "sourceProvider",
			rule: "sourceRule",
			family: "sourceFamily",
			fallback: "sourceFallback"
		};
		const CAPABILITY_LEVEL_HINT = {
			override: "sourceOverrideHint",
			declared: "sourceDeclaredHint",
			provider: "sourceProviderHint",
			rule: "sourceRuleHint",
			family: "sourceFamilyHint",
			fallback: "sourceFallbackHint"
		};
		const MODALITY_LABEL = {
			text: "text",
			image: "image",
			video: "video",
			vision: "vision",
			tts: "tts",
			music: "music"
		};
		function capabilityKeyOf(provider, id) {
			return `${provider}:${id}`;
		}
		function modalitiesOf(row) {
			const known = (Array.isArray(row.modalities) ? row.modalities : []).filter((m) => MODALITY_ORDER.includes(m));
			if (known.length > 0) return known;
			const flat = row.primary || row.type || "text";
			return MODALITY_ORDER.includes(flat) ? [flat] : ["text"];
		}
		/** Loads and mutates the server's capability model. */
		function useCapabilityMatrix(enabled) {
			const [providers, setProviders] = (0, react.useState)([]);
			const [overrides, setOverrides] = (0, react.useState)({});
			const [file, setFile] = (0, react.useState)("");
			const [rules, setRules] = (0, react.useState)(0);
			const [loading, setLoading] = (0, react.useState)(false);
			const [loadError, setLoadError] = (0, react.useState)("");
			const [busyKey, setBusyKey] = (0, react.useState)("");
			const [detecting, setDetecting] = (0, react.useState)("");
			const [status, setStatus] = (0, react.useState)({
				kind: "idle",
				text: ""
			});
			const load = (0, react.useCallback)(async () => {
				setLoading(true);
				setLoadError("");
				try {
					const [modelsRes, capsRes] = await Promise.all([fetch("/api/llm-multimodal/models", { method: "GET" }), fetch("/api/llm-multimodal/capabilities", { method: "GET" })]);
					const modelsData = await modelsRes.json();
					const capsData = await capsRes.json();
					if (!modelsData || !modelsData.ok) {
						setLoadError(modelsData && modelsData.error || "unexpected response");
						return;
					}
					setProviders(Array.isArray(modelsData.providers) ? modelsData.providers : []);
					if (capsData && capsData.ok) {
						setOverrides(capsData.overrides && typeof capsData.overrides === "object" ? capsData.overrides : {});
						setFile(String(capsData.file || ""));
						setRules(Array.isArray(capsData.rules) ? capsData.rules.length : 0);
					}
				} catch (e) {
					setLoadError(e?.message || String(e));
				} finally {
					setLoading(false);
				}
			}, []);
			(0, react.useEffect)(() => {
				if (enabled && providers.length === 0 && !loading && !loadError) load();
			}, [
				enabled,
				providers.length,
				loading,
				loadError,
				load
			]);
			/** Applies a server reply that carries a fresh catalog. */
			const applyCatalog = (0, react.useCallback)((data) => {
				if (Array.isArray(data?.providers)) setProviders(data.providers);
				if (data?.overrides && typeof data.overrides === "object") setOverrides(data.overrides);
			}, []);
			return {
				providers,
				overrides,
				file,
				rules,
				loading,
				loadError,
				busyKey,
				detecting,
				status,
				load,
				pin: (0, react.useCallback)(async (key, modalities) => {
					setBusyKey(key);
					setStatus({
						kind: "idle",
						text: ""
					});
					try {
						const r = await fetch("/api/llm-multimodal/capabilities/override", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({
								key,
								modalities
							})
						});
						const data = await r.json();
						if (!data || !data.ok) throw new Error(data && data.error || `HTTP ${r.status}`);
						applyCatalog(data);
						setOverrides(data.overrides && typeof data.overrides === "object" ? data.overrides : {});
						setStatus({
							kind: "saved",
							text: modalities.length > 0 ? "saved" : "cleared"
						});
						return true;
					} catch (e) {
						setStatus({
							kind: "error",
							text: e?.message || String(e)
						});
						return false;
					} finally {
						setBusyKey("");
					}
				}, [applyCatalog]),
				detect: (0, react.useCallback)(async (provider) => {
					setDetecting(provider);
					setStatus({
						kind: "idle",
						text: ""
					});
					try {
						const r = await fetch("/api/llm-multimodal/detect", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ provider })
						});
						const data = await r.json();
						if (!data || !data.ok) throw new Error(data && data.error || `HTTP ${r.status}`);
						applyCatalog(data);
						const merged = typeof data.merged === "number" ? data.merged : Array.isArray(data.results) ? data.results.reduce((sum, item) => sum + Number(item?.models || 0), 0) : 0;
						setStatus({
							kind: "saved",
							text: `detected:${merged}`
						});
						return true;
					} catch (e) {
						setStatus({
							kind: "error",
							text: e?.message || String(e)
						});
						return false;
					} finally {
						setDetecting("");
					}
				}, [applyCatalog])
			};
		}
		/**
		* The "模型能力矩阵" panel.
		*
		* Rendering is deliberately read-mostly: the chips are the *verdict*, and only
		* an explicit "编辑模态" turns them into a control. That keeps a stray click
		* from overwriting a model's capabilities for every future tool call.
		*/
		function CapabilityMatrix(props) {
			const { t, enabled } = props;
			const matrix = useCapabilityMatrix(enabled);
			const [editing, setEditing] = (0, react.useState)("");
			const [draft, setDraft] = (0, react.useState)([]);
			const beginEdit = (key, current) => {
				setEditing(key);
				setDraft(current.slice());
			};
			const toggleDraft = (m) => {
				setDraft((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);
			};
			const statusText = (() => {
				const { status } = matrix;
				if (!status.text) return "";
				if (status.kind === "error") return `${t("capabilitySaveFailed")}: ${status.text}`;
				if (status.text === "cleared") return t("capabilityCleared");
				if (status.text === "saved") return t("capabilitySaved");
				if (status.text.startsWith("detected:")) {
					const n = status.text.slice(9);
					return `${t("capabilityDetectDone")} · ${t("capabilityMerged")} ${n} ${t("capabilityMergedUnit")}`;
				}
				return status.text;
			})();
			const head = (0, react.createElement)("div", { className: "dsh-llmm-cap-head" }, (0, react.createElement)("span", { className: "dsh-llmm-cap-title" }, t("capabilityTitle")), matrix.file ? (0, react.createElement)("span", { className: "dsh-llmm-cap-meta" }, `${t("capabilityOverridesFile")}: ${matrix.file}`) : null, matrix.rules > 0 ? (0, react.createElement)("span", { className: "dsh-llmm-cap-meta" }, `${t("capabilityRules")} ${matrix.rules} ${t("capabilityRulesUnit")}`) : null, (0, react.createElement)("button", {
				type: "button",
				className: "dsh-llmm-cap-btn",
				disabled: matrix.loading,
				onClick: () => {
					matrix.load();
				}
			}, matrix.loading ? t("capabilityLoading") : t("capabilityRedetect")));
			const body = (() => {
				if (matrix.loading && matrix.providers.length === 0) return (0, react.createElement)("p", { className: "dsh-llmm-cap-status" }, t("capabilityLoading"));
				if (matrix.loadError) return (0, react.createElement)("p", {
					className: "dsh-llmm-cap-status",
					"data-status": "error"
				}, `${t("capabilityLoadFailed")}: ${matrix.loadError}`);
				if (matrix.providers.length === 0) return (0, react.createElement)("p", { className: "dsh-llmm-cap-status" }, t("capabilityEmpty"));
				return (0, react.createElement)("ul", { className: "dsh-llmm-cap-groups" }, ...matrix.providers.map((provider) => {
					const pid = provider.id;
					const models = Array.isArray(provider.models) ? provider.models : [];
					return (0, react.createElement)("li", {
						className: "dsh-llmm-cap-group",
						key: pid
					}, (0, react.createElement)("div", { className: "dsh-llmm-cap-group-head" }, (0, react.createElement)("span", { className: "dsh-llmm-cap-group-name" }, provider.displayName || provider.name || pid), (0, react.createElement)("span", {
						className: "dsh-llmm-cap-group-meta",
						title: provider.baseURL || ""
					}, `${pid} · ${models.length} · ${provider.baseURL || "—"}`), (0, react.createElement)("button", {
						type: "button",
						className: "dsh-llmm-cap-btn",
						disabled: !provider.baseURL || matrix.detecting === pid,
						title: provider.baseURL ? "" : t("sourceProviderHint"),
						onClick: () => {
							matrix.detect(pid);
						}
					}, matrix.detecting === pid ? t("capabilityDetecting") : t("capabilityRedetect"))), (0, react.createElement)("ul", { className: "dsh-llmm-cap-rows" }, ...models.map((row) => {
						const key = capabilityKeyOf(pid, row.id);
						const current = modalitiesOf(row);
						const isEditing = editing === key;
						const pinned = Boolean(matrix.overrides[key]);
						const shown = isEditing ? draft : current;
						const sources = Array.isArray(row.sources) ? row.sources : [];
						return (0, react.createElement)("li", {
							className: "dsh-llmm-cap-row",
							key
						}, (0, react.createElement)("div", { className: "dsh-llmm-cap-row-head" }, (0, react.createElement)("span", { className: "dsh-llmm-cap-id" }, row.id), row.name && row.name !== row.id ? (0, react.createElement)("span", { className: "dsh-llmm-cap-name" }, row.name) : null, pinned ? (0, react.createElement)("span", {
							className: "dsh-llmm-cap-source",
							"data-level": "override"
						}, t("sourceOverride")) : null, typeof row.confidence === "number" ? (0, react.createElement)("span", { className: "dsh-llmm-cap-conf" }, `${t("capabilityConfidence")} ${row.confidence.toFixed(2)}`) : null), (0, react.createElement)("div", { className: "dsh-llmm-cap-chips" }, ...MODALITY_ORDER.map((m) => {
							const on = shown.includes(m);
							const isPrimary = (row.primary || row.type) === m;
							const label = (0, react.createElement)("span", null, MODALITY_LABEL[m]);
							const className = [
								"dsh-llmm-cap-chip",
								isPrimary ? "dsh-llmm-cap-chip-primary" : "",
								isEditing ? "dsh-llmm-cap-chip-btn" : ""
							].filter(Boolean).join(" ");
							if (!isEditing && !on) return null;
							return (0, react.createElement)(isEditing ? "button" : "span", isEditing ? {
								type: "button",
								key: m,
								className,
								"data-on": on ? "true" : "false",
								"aria-pressed": on ? "true" : "false",
								disabled: matrix.busyKey === key,
								onClick: () => toggleDraft(m)
							} : {
								key: m,
								className,
								"data-on": on ? "true" : "false"
							}, label, isPrimary ? (0, react.createElement)("span", { className: "dsh-llmm-cap-chip-badge" }, t("capabilityPrimary")) : null);
						})), sources.length > 0 && !isEditing ? (0, react.createElement)("div", { className: "dsh-llmm-cap-sources" }, ...sources.map((source, i) => {
							const level = String(source?.level || "fallback");
							const labelKey = CAPABILITY_LEVEL_LABEL[level] || "sourceFallback";
							const hintKey = CAPABILITY_LEVEL_HINT[level] || "sourceFallbackHint";
							return (0, react.createElement)("span", {
								key: `${level}-${i}`,
								className: "dsh-llmm-cap-source",
								"data-level": level,
								title: t(hintKey)
							}, t(labelKey), source?.id ? (0, react.createElement)("span", { className: "dsh-llmm-cap-source-id" }, ` ${source.id}`) : null);
						})) : null, isEditing ? (0, react.createElement)("div", { className: "dsh-llmm-cap-actions" }, (0, react.createElement)("button", {
							type: "button",
							className: "dsh-llmm-cap-btn",
							disabled: matrix.busyKey === key || draft.length === 0,
							onClick: async () => {
								if (await matrix.pin(key, draft)) setEditing("");
							}
						}, matrix.busyKey === key ? t("capabilitySaving") : t("capabilitySave")), (0, react.createElement)("button", {
							type: "button",
							className: "dsh-llmm-cap-btn",
							onClick: () => setEditing("")
						}, t("capabilityCancel")), pinned ? (0, react.createElement)("button", {
							type: "button",
							className: "dsh-llmm-cap-btn",
							disabled: matrix.busyKey === key,
							onClick: async () => {
								if (await matrix.pin(key, [])) setEditing("");
							}
						}, t("capabilityClear")) : null) : (0, react.createElement)("div", { className: "dsh-llmm-cap-actions" }, (0, react.createElement)("button", {
							type: "button",
							className: "dsh-llmm-cap-btn",
							disabled: Boolean(matrix.busyKey),
							onClick: () => beginEdit(key, current)
						}, t("capabilityEdit")), pinned ? (0, react.createElement)("button", {
							type: "button",
							className: "dsh-llmm-cap-btn",
							disabled: matrix.busyKey === key,
							onClick: async () => {
								await matrix.pin(key, []);
							}
						}, t("capabilityClear")) : null));
					})));
				}));
			})();
			return (0, react.createElement)("div", { className: "dsh-llmm-cap" }, head, (0, react.createElement)("p", { className: "dsh-llmm-cap-hint" }, t("capabilityTitleHint")), statusText ? (0, react.createElement)("p", {
				className: "dsh-llmm-cap-status",
				"data-status": matrix.status.kind,
				role: "status"
			}, statusText) : null, body);
		}
		function SettingsCard(props) {
			const { t, setField, setWhole, reset } = props;
			const snap = props.useLlmMultimodal((s) => s);
			const isPage = props.view !== "summary";
			const [open, setOpen] = (0, react.useState)(isPage);
			const catalog = useModelCatalog(open);
			if (props.view === "summary") return (0, react.createElement)("span", { className: "dsh-llmm-summary" }, t("description"));
			return (0, react.createElement)("li", { className: open ? "dsh-llmm-card dsh-llmm-card-open" : "dsh-llmm-card" }, (0, react.createElement)("button", {
				type: "button",
				className: "dsh-llmm-header",
				"aria-expanded": open,
				"aria-label": `${t(open ? "collapse" : "expand")}: ${t("title")}`,
				onClick: () => setOpen(!open)
			}, (0, react.createElement)("span", { className: "dsh-llmm-head-text" }, (0, react.createElement)("span", { className: "dsh-llmm-name" }, t("title")), (0, react.createElement)("span", { className: "dsh-llmm-description" }, t("description"))), (0, react.createElement)("svg", {
				className: open ? "dsh-llmm-chevron dsh-llmm-chevron-open" : "dsh-llmm-chevron",
				viewBox: "0 0 14 14",
				width: 14,
				height: 14,
				"aria-hidden": "true"
			}, (0, react.createElement)("path", {
				d: "M3.5 5.5 7 9l3.5-3.5",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.5,
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}))), open ? (0, react.createElement)(react.Fragment, null, (0, react.createElement)(ModelPicker, {
				t,
				snap,
				models: catalog.models,
				loadingModels: catalog.loadingModels,
				loadError: catalog.loadError,
				write: snap.write,
				setField,
				setWhole,
				reset
			}), (0, react.createElement)(CapabilityMatrix, {
				t,
				enabled: open
			})) : null);
		}
		/**
		* The same pickers, mounted as a page inside the host's Plugins settings
		* section (`settings.plugins.tab`).
		*
		* The Plugins page card and this tab share one body, so the models can be
		* configured from either entry.
		*/
		function SettingsTab(props) {
			const { t, setField, setWhole, reset } = props;
			const snap = props.useLlmMultimodal((s) => s);
			const catalog = useModelCatalog(true);
			return (0, react.createElement)("div", { className: "dsh-llmm-card dsh-llmm-card-open" }, (0, react.createElement)(ModelPicker, {
				t,
				snap,
				models: catalog.models,
				loadingModels: catalog.loadingModels,
				loadError: catalog.loadError,
				write: snap.write,
				setField,
				setWhole,
				reset
			}), (0, react.createElement)(CapabilityMatrix, {
				t,
				enabled: true
			}));
		}
		function apply(ctx) {
			ensureStyles();
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-llm-multimodal: dictionaries");
			const form = ctx.configForms.get(SETTINGS_NAMESPACE);
			let writeState = IDLE_WRITE;
			const draft = {};
			const baseSnapshot = () => projectSnapshot(form);
			const project = () => {
				const base = baseSnapshot();
				const merged = {
					...base,
					write: writeState
				};
				for (const m of MODALITY_ORDER) {
					const local = draft[m];
					if (local) merged[m] = {
						...local,
						voice: local.voice ?? base[m].voice
					};
				}
				return merged;
			};
			/** Drop drafts the Host snapshot already agrees with. */
			const retireSettledDrafts = () => {
				const base = baseSnapshot();
				for (const m of MODALITY_ORDER) {
					const local = draft[m];
					if (local && modalityEquals(m, base[m], local)) delete draft[m];
				}
			};
			const store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(project());
			const publish = () => store.set(project());
			ctx.effect(() => {
				const off = form.subscribe(() => {
					retireSettledDrafts();
					publish();
				});
				return () => {
					off();
					form.dispose?.();
				};
			}, "dsh-llm-multimodal: form subscription");
			/**
			* Apply the ops through the plugin's HTTP settings route.
			*
			* Exists purely as a fallback for the card: the Host form refuses a write
			* when its namespace revision moved on, and a controller that keeps
			* resending a stale revision turns every selection into a no-op.
			*/
			const postSettingsOps = async (ops) => {
				try {
					const res = await fetch("/api/llm-multimodal/settings/mutate", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ ops })
					});
					if (!res.ok) return false;
					return (await res.json())?.ok === true;
				} catch {
					return false;
				}
			};
			const runWrite = async (ops, rollback) => {
				writeState = {
					status: "saving",
					message: ""
				};
				publish();
				let ok = false;
				try {
					ok = await form.mutate(ops);
				} catch {
					ok = false;
				}
				for (const delay of [120, 400]) {
					if (ok) break;
					await new Promise((resolve) => setTimeout(resolve, delay));
					try {
						ok = await form.mutate(ops);
					} catch {
						ok = false;
					}
				}
				if (!ok) ok = await postSettingsOps(ops);
				if (ok) {
					try {
						await form.reload?.();
					} catch {}
					retireSettledDrafts();
				} else rollback?.();
				writeState = ok ? {
					status: "saved",
					message: ""
				} : {
					status: "error",
					message: t("writeFailed")
				};
				publish();
				return ok;
			};
			const setField = (m, field, value) => {
				const previous = draft[m];
				draft[m] = {
					...draft[m] ?? projectSnapshot(form)[m],
					[field]: value
				};
				publish();
				runWrite([{
					op: "set",
					path: [m, field],
					value
				}], () => {
					if (previous) draft[m] = previous;
					else delete draft[m];
				});
			};
			const setWhole = (m, value) => {
				const previous = draft[m];
				draft[m] = { ...value };
				publish();
				const ops = MODALITY_FIELDS[m].map((field) => ({
					op: "set",
					path: [m, field],
					value: value[field] ?? ""
				}));
				runWrite(ops, () => {
					if (previous) draft[m] = previous;
					else delete draft[m];
				});
			};
			const resetModality = (m) => {
				const previous = draft[m];
				draft[m] = {
					...EMPTY_MODALITY,
					voice: projectSnapshot(form)[m].voice
				};
				publish();
				const ops = MODALITY_FIELDS[m].map((field) => ({
					op: "unset",
					path: [m, field]
				}));
				runWrite(ops, () => {
					if (previous) draft[m] = previous;
					else delete draft[m];
				});
			};
			ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NAMESPACE], () => ctx.slots.inject("plugins.item", () => ctx.slots.register({
				name: "plugins.item",
				id: SETTINGS_NAMESPACE,
				order: 40,
				label: () => t("title"),
				locale: NS,
				inject: () => ({
					hooks: { llmMultimodal: store },
					setField,
					setWhole,
					reset: resetModality
				})
			}, SettingsCard))), "dsh-llm-multimodal: page");
			ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NAMESPACE], () => ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: SETTINGS_NAMESPACE,
				order: 20,
				label: () => t("title"),
				locale: NS,
				inject: () => ({
					hooks: { llmMultimodal: store },
					setField,
					setWhole,
					reset: resetModality
				})
			}, SettingsTab))), "dsh-llm-multimodal: settings tab");
		}
		//#endregion
		exports.NS = NS;
		exports.SETTINGS_NAMESPACE = SETTINGS_NAMESPACE;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
