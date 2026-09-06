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
			noModelsHint: "「llm-pi-ai」中没有已配置的模型。直接选「自定义」即可接入。",
			resetToNone: "取消选择"
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
			noModelsHint: "No models configured under \"llm-pi-ai\". Pick \"Custom\" to define one.",
			resetToNone: "Clear selection"
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
`;
			document.head.append(style);
		}
		//#endregion
		//#region src/client.tsx
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
		const name = "dsh-llm-multimodal-client";
		const inject = [
			"slots",
			"locale",
			"settingsScope"
		];
		const NS = "llm-multimodal.card";
		const MODALITY_ORDER = [
			"text",
			"image",
			"video",
			"tts",
			"music"
		];
		const EMPTY_MODALITY = {
			provider: "",
			apiProtocol: "",
			baseURL: "",
			apiKey: "",
			defaultModel: "",
			voice: ""
		};
		const EMPTY_MODELS = {
			providers: [],
			byModality: {
				text: [],
				image: [],
				video: [],
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
		function projectSnapshot(scope) {
			const snap = scope.getSnapshot();
			const value = snap.value ?? {};
			return {
				available: snap.status === "ready",
				writable: snap.writable,
				text: coerceModality(value.text),
				image: coerceModality(value.image),
				video: coerceModality(value.video),
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
			}), (0, react.createElement)("span", { className: "dsh-llmm-hint" }, props.t("voiceHint"))), !props.hasAnyPreset && !props.state.provider && (0, react.createElement)("p", { className: "dsh-llmm-hint" }, props.t("noModelsHint"))));
		}
		function SettingsCard(props) {
			const { t, setField, setWhole, reset } = props;
			const snap = props.useLlmMultimodal((s) => s);
			const [open, setOpen] = (0, react.useState)(false);
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
				if (open && models.providers.length === 0 && !loadingModels) reloadModels();
			}, [
				open,
				models.providers.length,
				loadingModels,
				reloadModels
			]);
			if (typeof window !== "undefined") {
				const w = window;
				if (!w.__dsh_llmm_debug) w.__dsh_llmm_debug = { count: 0 };
				w.__dsh_llmm_debug.count++;
				w.__dsh_llmm_debug.last_snap = snap;
				w.__dsh_llmm_debug.last_props = {
					setField,
					setWhole,
					reset
				};
				w.__dsh_llmm_debug.last_snap_value = snap;
			}
			const writable = snap.writable;
			const disabled = !writable;
			const sectionLabel = {
				text: t("sectionText"),
				image: t("sectionImage"),
				video: t("sectionVideo"),
				tts: t("sectionTts"),
				music: t("sectionMusic")
			};
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
			}))), open ? (0, react.createElement)(react.Fragment, null, disabled ? (0, react.createElement)("p", {
				className: "dsh-llmm-read-only",
				role: "status"
			}, t("readOnly")) : null, loadingModels ? (0, react.createElement)("p", { className: "dsh-llmm-hint" }, t("loadingModels")) : null, loadError ? (0, react.createElement)("p", { className: "dsh-llmm-hint" }, `${t("loadModelsFailed")}: ${loadError}`) : null, (0, react.createElement)("ul", { className: "dsh-llmm-section-list" }, ...MODALITY_ORDER.map((m) => {
				const presets = models.byModality[m] ?? [];
				const presetOptions = presets.map((p) => ({
					value: `${p.provider}:${p.id}`,
					label: `${p.provider} / ${p.name || p.id}`
				}));
				return (0, react.createElement)(ModalitySection, {
					key: m,
					modality: m,
					label: sectionLabel[m],
					state: snap[m],
					presetOptions,
					hasAnyPreset: presets.length > 0,
					t,
					writable,
					onDropdownChange: (val) => {
						if (val === "") {
							reset(m);
							return;
						}
						if (val === "custom") {
							setWhole(m, {
								provider: "custom",
								apiProtocol: snap[m].apiProtocol,
								baseURL: snap[m].baseURL,
								apiKey: snap[m].apiKey,
								defaultModel: snap[m].defaultModel,
								voice: snap[m].voice
							});
							return;
						}
						const splitIdx = val.indexOf(":");
						const pid = splitIdx > 0 ? val.slice(0, splitIdx) : val;
						const modelId = splitIdx > 0 ? val.slice(splitIdx + 1) : "";
						setWhole(m, {
							provider: pid,
							apiProtocol: "",
							baseURL: "",
							apiKey: "",
							defaultModel: modelId,
							voice: snap[m].voice
						});
					},
					onFieldChange: (field, value) => setField(m, field, value),
					onReset: () => reset(m)
				});
			}))) : null);
		}
		function apply(ctx) {
			ensureStyles();
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-llm-multimodal: dictionaries");
			const scope = ctx.settingsScope.bind({ namespace: "llm-multimodal" });
			const project = () => projectSnapshot(scope);
			const store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(project());
			scope.subscribe(() => {
				store.set(project());
			});
			const setField = useCallbackForApply((m, field, value) => {
				const next = {
					...coerceModality((scope.getSnapshot().value ?? {})[m]),
					[field]: value
				};
				scope.set(m, next);
			}, [scope]);
			const setWhole = useCallbackForApply((m, value) => {
				scope.set(m, value);
			}, [scope]);
			const resetModality = useCallbackForApply((m) => {
				scope.unset(m);
			}, [scope]);
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: "llm-multimodal",
				locale: NS,
				inject: () => ({
					hooks: { llmMultimodal: store },
					setField,
					setWhole,
					reset: resetModality
				})
			}, SettingsCard));
		}
		/**
		* Apply runs once per plugin activation, NOT inside a React render. We
		* still want stable handler references so that the registered slot's
		* `inject()` factory doesn't churn when its subscribers fire. A simple
		* memoized closure tied to `scope` is enough — `scope` itself is stable
		* for the lifetime of the plugin.
		*/
		function useCallbackForApply(fn, _deps) {
			return useMemoStable(fn);
		}
		function useMemoStable(fn) {
			return fn;
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
