/**
 * dsh-llm-multimodal — host half (Node).
 *
 * Registers FIVE model-facing tools, all backed by the user's existing
 * `llm-pi-ai` settings namespace (no per-tool UI reconfiguration):
 *
 *   - generate_text   → LlmRuntime.prepareCall / stream (any text-capable
 *                       provider the harness is already configured for)
 *   - generate_image  → POST {baseURL}/images/generations
 *   - generate_video  → POST {baseURL}/videos/generations (preferred)
 *                         ↳ fallback: POST {baseURL}/videos   (Agnes style)
 *                         ↳ fallback: POST {baseURL}/chat/completions
 *   - generate_tts    → POST {baseURL}/audio/speech (OpenAI TTS spec);
 *                       also a `voice` parameter for MiniMax TTS / ElevenLabs
 *   - generate_music  → POST {baseURL}/audio/speech with music-style body;
 *                       treats `text` as a lyric hint (provider-dependent)
 *
 * Provider sources:
 *   1. Auto-discovery from the existing `llm-pi-ai` settings namespace — any
 *      configured model whose id matches image/video/tts/music keywords
 *      becomes an available tool target WITHOUT any extra configuration.
 *   2. The credentials service resolves `apiKeyEnv` to the actual key.
 *   3. Registered `llm-multimodal` settings namespace lets the user pin a
 *      default model + voice per modality when auto-discovery picks the
 *      wrong row.
 *
 * This is the consolidated successor to the per-modality configurations
 * that used to live in `dsh-media-studio`'s own `mediaStudio` namespace.
 * The DSH web settings UI shows one card under the `llm-multimodal`
 * namespace; the canvas tools and harness users do not need to know.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import Schema from "@deepseek-ai/schemastery";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

export const name = "dsh-llm-multimodal";
export const inject = ["tools", "credentials", "settings", "llm", "webServer"];

// ── Settings namespace ────────────────────────────────────────────────────
//
// Five modalities, each carrying `{ provider, baseURL, apiKey, defaultModel }`.
// `tts` and `music` additionally carry `voice` (MiniMax TTS exposes dozens of
// preset voices; we let the user pin one).
//
// Defaults are intentionally EMPTY: auto-discovery fills in from
// `llm-pi-ai`. The fields here exist to let the user override the picked
// row (e.g. force a specific provider for image even when three are
// configured), and to be the canonical place the settings UI writes to.

// Each modality carries a selection (`provider` + `defaultModel`) that the
// client-side settings card binds to a `<select>` dropdown:
//
//   provider === ""              → "未选择" placeholder (no model chosen)
//   provider === "custom"        → user-entered custom config below
//                                  (apiProtocol + baseURL + apiKey +
//                                   defaultModel all editable)
//   provider === "<pi provider>" → preset; baseURL / apiKey are inherited
//                                  from llm-pi-ai via applyOverride() at
//                                  call time. Only `defaultModel` is
//                                  editable from the card.
//
// apiProtocol is captured only on the custom path so future per-provider
// dispatch (openai / claude / anthropic / etc.) has a stable switch.
const ModelProviderFields = {
  provider: Schema.string().default(""),
  apiProtocol: Schema.string().default(""),
  baseURL: Schema.string().default(""),
  apiKey: Schema.string().default(""),  // TEMP: removed .role("secret")
  defaultModel: Schema.string().default(""),
};

const AudioModalityFields = {
  ...ModelProviderFields,
  voice: Schema.string().default(""),
};

// Each modality is itself a Schemastery object schema, wrapped in
// `.default(...)` so a partially-populated user section (e.g. only
// `image` filled) still validates cleanly against the full schema.
const TextSchema = Schema.object(ModelProviderFields).default({ provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "" });
const ImageSchema = Schema.object(ModelProviderFields).default({ provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "" });
const VideoSchema = Schema.object(ModelProviderFields).default({ provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "" });
const TtsSchema = Schema.object(AudioModalityFields).default({ provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "", voice: "" });
const MusicSchema = Schema.object(AudioModalityFields).default({ provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "", voice: "" });

// ── Tool result renderer ──────────────────────────────────────────────────
//
// `output.execute` must already return a JSON object that matches
// `output.schema` (the canonical tool contract — dsh-plugin-guide, "Tool
// authoring" rule). The host runs `render(args, value)` separately to
// produce a human-readable projection for the UI card and the model
// transcript. Per the same rule, `render` is a pure function: no I/O,
// no clock, no randomness. Everything it needs must come from the
// already-snapshotted `value`.
//
// `renderJsonSummary` is the shared projection for the four generation
// tools (image / video / tts / music). It surfaces the full schema-shaped
// payload — `{ success, url, model, bytes, latencyMs, message }` plus any
// modality-specific fields (`videoUrl`, `voice`, …) — as a fenced JSON
// block so downstream agents, the session transcript, and any log
// inspector all see the canonical structured result rather than a
// hand-written free-text summary.

/**
 * Render the canonical JSON payload of one multimodal tool call as a
 * markdown-fenced text block.
 *
 * Always emits `value` verbatim (modulo `JSON.stringify` field ordering).
 * Falls back to a minimal `{ message }` envelope when `value` is null,
 * undefined, or a non-object — so a malformed execute never crashes the
 * projector (which would surface as `INVALID_TOOL_OUTPUT` and lose the
 * underlying error message).
 */
function renderJsonSummary(value) {
  const payload = (value !== null && typeof value === "object")
    ? value
    : { message: "工具未返回规范 JSON" };
  return [{
    type: "text",
    text: "```json\n" + JSON.stringify(payload, null, 2) + "\n```",
  }];
}

export const LlmMultimodalSettings = Schema.object({
  text: TextSchema,
  image: ImageSchema,
  video: VideoSchema,
  tts: TtsSchema,
  music: MusicSchema,
});

export const NS = settingsNamespace("llm-multimodal");

export const DEFAULT_LLM_MULTIMODAL = {
  text: { provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "" },
  image: { provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "" },
  video: { provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "" },
  tts: { provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "", voice: "" },
  music: { provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "", voice: "" },
};

// ── Settings loader (reads llm-pi-ai from disk) ────────────────────────────

function defaultSettingsPath() {
  return process.env.DSH_SETTINGS_PATH || join(homedir(), ".dsh", "settings.yaml");
}

async function readPiAiProviders() {
  try {
    const raw = await readFile(defaultSettingsPath(), "utf8");
    const doc = parseYaml(raw);
    const piAi = doc?.["llm-pi-ai"];
    if (!piAi || typeof piAi !== "object") return {};
    return piAi.providers || {};
  } catch (_) {
    return {};
  }
}

// ── API key resolution ───────────────────────────────────────────────────

async function resolveApiKey(credentials, apiKeyEnv) {
  if (!apiKeyEnv) return "";
  try {
    if (credentials && typeof credentials.resolve === "function") {
      const resolved = await credentials.resolve(apiKeyEnv);
      if (resolved && resolved.value) return resolved.value;
    }
  } catch (_) {}
  return process.env[apiKeyEnv] || "";
}

// ── LLM client factory ────────────────────────────────────────────────────

function withSlash(u) {
  return u.endsWith("/") ? u : u + "/";
}

async function fetchJson(url, opts, ms = 120_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error("timeout after " + ms + "ms")), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: r.status, ok: r.ok, body: json };
  } finally {
    clearTimeout(t);
  }
}

function createClient(baseURL, apiKey, modelId) {
  const base = withSlash(baseURL);
  const authHeader = apiKey ? { "Authorization": "Bearer " + apiKey } : {};
  const jsonHeaders = { ...authHeader, "Content-Type": "application/json" };
  const isAgnesFlash = /agnes-video-2\.5-flash/i.test(modelId || "");
  return {
    images: {
      generate: (params) =>
        fetchJson(base + "images/generations", {
          method: "POST", headers: jsonHeaders, body: JSON.stringify(params)
        }),
    },
    videos: {
      generate: (params) => {
        const body = { mode: isAgnesFlash ? "text" : "ti2vid", ...params };
        if (isAgnesFlash) body.size = "720P";
        return fetchJson(base + "videos", {
          method: "POST", headers: jsonHeaders, body: JSON.stringify(body)
        });
      },
      retrieve: (taskId) => {
        if (isAgnesFlash) {
          const url = base + "agnesapi?video_id=" + taskId +
                      "&model_name=" + encodeURIComponent(modelId || "");
          return fetchJson(url, { method: "GET", headers: jsonHeaders });
        }
        return fetchJson(base + "videos/" + taskId, {
          method: "GET", headers: jsonHeaders
        });
      },
    },
    videosOpenAI: {
      generate: (params) =>
        fetchJson(base + "videos/generations", {
          method: "POST", headers: jsonHeaders, body: JSON.stringify(params)
        }),
      retrieve: (taskId) =>
        fetchJson(base + "videos/" + taskId, {
          method: "GET", headers: jsonHeaders
        }),
    },
    chat: {
      completions: {
        create: (params) =>
          fetchJson(base + "chat/completions", {
            method: "POST", headers: jsonHeaders, body: JSON.stringify(params)
          }),
      },
    },
    audio: {
      speech: (params) =>
        fetchJson(base + "audio/speech", {
          method: "POST", headers: jsonHeaders, body: JSON.stringify(params)
        }),
    },
  };
}

// ── Auto-discovery ────────────────────────────────────────────────────────

const IMG_KEYWORDS = ["image", "flux", "dall", "imagen", "midjourney", "sdxl", "sd-", "kandinsky"];
const VID_KEYWORDS = ["video", "sora", "seedance", "kling", "veo", "runway", "pika", "hunyuan-video", "cogvideo"];
const TTS_KEYWORDS = ["tts", "speech", "voice", "minimax"];
const MUSIC_KEYWORDS = ["music", "song", "lyric"];
const TEXT_KEYWORDS = ["chat", "instruct", "gpt", "deepseek", "claude", "sonnet", "haiku", "qwen", "gemini", "llama"];

/**
 * Classify a model id into one of the five modalities. Order matters —
 * a model whose id mentions both `video` and `gpt` is unambiguously video
 * because the modality-keyword check runs first; `text` is the fallback.
 */
function classifyModelId(id) {
  const m = (id || "").toLowerCase();
  if (VID_KEYWORDS.some(k => m.includes(k))) return "video";
  if (IMG_KEYWORDS.some(k => m.includes(k))) return "image";
  if (TTS_KEYWORDS.some(k => m.includes(k))) return "tts";
  if (MUSIC_KEYWORDS.some(k => m.includes(k))) return "music";
  if (TEXT_KEYWORDS.some(k => m.includes(k))) return "text";
  return "text"; // safe default
}

async function discoverModels(credentials) {
  const out = [];
  const providers = await readPiAiProviders();
  for (const [pid, p] of Object.entries(providers)) {
    if (!p || !Array.isArray(p.models)) continue;
    const baseURL = p.baseURL || "";
    if (!baseURL) continue;
    const apiKey = await resolveApiKey(credentials, p.apiKeyEnv);
    for (const model of p.models) {
      const id = (model && model.id) || "";
      if (!id) continue;
      const type = classifyModelId(id);
      out.push({
        provider: pid,
        id,
        name: (model && model.name) || id,
        type,
        baseURL,
        apiKey,
        apiKeyEnv: p.apiKeyEnv || ""
      });
    }
  }
  return out;
}

function pickModel(models, type, requestedId) {
  if (requestedId) {
    return models.find(m => m.id === requestedId || m.name === requestedId) || null;
  }
  // First match for the requested modality.
  return models.find(m => m.type === type) || null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function extractFirstVideoUrl(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(/https?:\/\/[^\s"']+\.(mp4|mov|webm|m3u8)(\?[^\s"']*)?/i);
  return m ? m[0] : null;
}

/**
 * Pull a cover / thumbnail URL out of a video-generation response body.
 * Most providers (Sora / Veo / Kling / Seedance / Agnes) return a sibling
 * image alongside the video URL — used by `media-studio` to embed the
 * first frame into the MP4 metadata so project directories stay clean.
 *
 * Strategy:
 *   1. Walk common field names on the body itself, then on a `video`
 *      sub-object (OpenAI/Agnes shape). We accept both camelCase and
 *      snake_case since providers disagree.
 *   2. Fallback: scrape the first .jpg/.jpeg/.png/.webp URL from a JSON
 *      stringification of the body — covers providers that dump the cover
 *      under less obvious names (e.g. `data[0].preview`, `output.preview_image`).
 *
 * Returns `null` when nothing looks like a cover — the consumer should
 * treat that as "no cover provided", not as an error.
 */
function extractFirstCoverUrl(body) {
  if (!body || typeof body !== "object") return null;
  const FIELDS = [
    "coverUrl", "cover_url",
    "thumbnailUrl", "thumbnail_url",
    "posterUrl", "poster_url",
    "coverImage", "cover_image",
    "thumbnail", "cover",
    "previewImage", "preview_image",
  ];
  const tryObj = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    for (const k of FIELDS) {
      const v = obj[k];
      if (typeof v === "string" && v) return v;
    }
    return null;
  };
  const direct = tryObj(body) ?? tryObj(body.video) ?? tryObj(body.data?.[0]) ?? tryObj(body.output);
  if (direct) return direct;
  // Text fallback — scan stringified body for an image URL.
  try {
    const m = JSON.stringify(body).match(/https?:\/\/[^\s"']+\.(jpg|jpeg|png|webp)(\?[^\s"']*)?/i);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

/** Pick the first URL or b64_json from a generic generations response. */
function extractFirstMedia(json) {
  if (!json || typeof json !== "object") return null;
  const data = json.data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] || {};
    if (typeof first.url === "string") return { url: first.url };
    if (typeof first.b64_json === "string") return { b64: first.b64_json };
    return null;
  }
  if (typeof json.url === "string") return { url: json.url };
  if (typeof json.b64_json === "string") return { b64: json.b64_json };
  return null;
}

function guessExt(url, contentType) {
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (ct.includes("png")) return "png";
    if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
    if (ct.includes("webp")) return "webp";
    if (ct.includes("mp4")) return "mp4";
    if (ct.includes("mpeg") || ct.includes("mp3")) return "mp3";
    if (ct.includes("wav")) return "wav";
  }
  const fromUrl = extname(new URL(url, "http://x").pathname).slice(1).toLowerCase();
  return fromUrl || "bin";
}

async function downloadTo(url, dest, signal) {
  await mkdir(dirname(dest), { recursive: true });
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error("download HTTP " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}

// ── Settings scope helper ─────────────────────────────────────────────────

/**
 * Read the user-pinned overrides for one modality. Falls back to defaults
 * when the scope is not yet registered or the user has not configured
 * anything for that modality.
 */
function readModalityOverride(scope, key) {
  if (!scope) return DEFAULT_LLM_MULTIMODAL[key];
  try {
    const v = scope.get();
    const out = v && v[key];
    if (!out) return DEFAULT_LLM_MULTIMODAL[key];
    return {
      ...DEFAULT_LLM_MULTIMODAL[key],
      ...out,
    };
  } catch (_) {
    return DEFAULT_LLM_MULTIMODAL[key];
  }
}

/**
 * Merge a modality override on top of an auto-discovered model row. The
 * override's `baseURL` / `apiKey` / `apiKeyEnv` / `defaultModel` replace
 * the discovered ones if non-empty; `provider` is taken from the
 * discovered model when the override is empty (so the auto-picked row is
 * still recognised).
 */
function applyOverride(model, override) {
  if (!model) return null;
  if (!override || Object.keys(override).length === 0) return model;
  const baseURL = override.baseURL?.trim() || model.baseURL;
  const apiKey = override.apiKey?.trim() || model.apiKey;
  const defaultModel = override.defaultModel?.trim() || model.id;
  const apiKeyEnv = override.provider ? "" : model.apiKeyEnv;
  const provider = override.provider?.trim() || model.provider;
  return { ...model, baseURL, apiKey, apiKeyEnv, id: defaultModel, provider };
}

// ── Polling helper ───────────────────────────────────────────────────────

async function pollForVideo(taskId, retrieve) {
  const POLL_INTERVAL_MS = 5_000;
  const MAX_POLLS = 60;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const { ok, body } = await retrieve(taskId);
    if (!ok) continue;
    const status = body?.status || body?.state || "";
    const progress = body?.progress ?? null;
    if (progress !== null) process.stderr.write(`\r  视频生成进度: ${progress}%`);
    if (/succeeded|completed|finished|success/i.test(status) || body?.url || body?.video?.url) {
      const url = body?.url || body?.video?.url || extractFirstVideoUrl(JSON.stringify(body));
      if (url) return { url, response: body };
    }
    if (/failed|error|canceled|cancelled/i.test(status)) {
      throw new Error("视频生成失败: " + (body?.error?.message || JSON.stringify(body).slice(0, 200)));
    }
  }
  throw new Error("视频生成超时 (5 分钟内未完成)");
}

// ── Plugin apply ──────────────────────────────────────────────────────────

export async function apply(ctx) {
  const tools = ctx.tools;
  const credentials = ctx.credentials;
  const settings = ctx.settings;

  // Register the `llm-multimodal` settings namespace so the Settings UI
  // card (browser) can write to it. We register under the `settings`
  // service the same way `@deepseek-ai/dsh-media-studio` used to; the
  // client half mirrors it on `ctx.settingsScope.bind({namespace: NS})`.
  let scope = null;
  if (settings && typeof settings.register === "function") {
    try {
      scope = settings.register(NS, LlmMultimodalSettings);
    } catch (e) {
      // Settings subsystem missing in non-standard deployments — fall
      // back to defaults. Tools still work via auto-discovery.
    }
  }
  const getScope = () => scope;

  // Expose `/api/llm-multimodal/{models,providers}` for the settings card
  // to pull its dropdown contents from. Skipped silently when the host
  // profile doesn't expose a webServer service (e.g. headless).
  if (ctx.webServer) {
    try { attachHttpRoutes(ctx) } catch (_) {}
  }

  // ── generate_text ──────────────────────────────────────────────────────
  //
  // Wraps the harness's LlmRuntime. The user picks the model id via the
  // `model` argument; we parse `<provider>/<model>` and dispatch through
  // `llm.prepareCall`.

  tools.register(defineTool({
    name: "generate_text",
    description:
      "Generate text via the harness-configured LLM. Uses whatever provider the user picked in DSH settings (DeepSeek / OpenAI / Anthropic / Agnes / etc.). Model id is the DSH-style \"<provider>/<model>\" pair, e.g. \"deepseek/deepseek-chat\". If `model` is blank, the plugin auto-picks a text-capable model from the configured providers.",
    parameters: {
      prompt: { type: "string", required: true, description: "User prompt. Plain text only — multimodal blocks are not accepted here." },
      model: { type: "string", description: "Optional \"<provider>/<model>\" override. Blank → auto-pick text-capable model." },
      system: { type: "string", description: "Optional system prompt." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          model: { type: "string" },
          usage: {
            type: "object",
            additionalProperties: false,
            properties: {
              inputTokens: { type: "number" },
              outputTokens: { type: "number" },
            },
          },
          latencyMs: { type: "number" },
        },
      },
      render: (_args, value) => [{ type: "text", text: (value?.text) || "(empty response)" }],
    },
    async execute(args, exec) {
      const llm = ctx.llm;
      if (!llm || typeof llm.prepareCall !== "function") {
        return { success: false, message: "dsh-llm-multimodal: ctx.llm is not bound — the harness is running without an LLM adapter." };
      }

      const configured = (args.model || "").trim();
      let provider = "";
      let model = configured;
      const slash = configured.indexOf("/");
      if (slash > 0) {
        provider = configured.slice(0, slash);
        model = configured.slice(slash + 1);
      }

      // Auto-pick path: enumerate registered providers.
      if (!provider || !model) {
        const models = await discoverModels(credentials);
        const textMods = models.filter(m => m.type === "text");
        if (textMods.length === 0) {
          return {
            success: false,
            message: "未发现可用的文本模型。请到「设置 > 模型」配置一个大模型（model id 含 chat/instruct/gpt/deepseek/claude/qwen 等关键字即可）。",
          };
        }
        const picked = textMods[0];
        provider = picked.provider;
        model = picked.id;
        if (!picked.apiKey) {
          return {
            success: false,
            message: `文本模型 ${picked.id} 已自动发现，但 ${picked.apiKeyEnv || "API_KEY"} 环境变量未设置。`,
          };
        }
      }

      const t0 = Date.now();
      let prep;
      try {
        prep = await llm.prepareCall({ provider, model, maxTokens: 4096 }, exec.signal);
      } catch (e) {
        return { success: false, message: "prepareCall 失败: " + (e?.message || String(e)) };
      }

      const MessageId = (id) => id;
      let text = "";
      let usage = { inputTokens: 0, outputTokens: 0 };
      try {
        for await (const chunk of prep.stream({
          provider,
          model,
          messages: [{
            id: MessageId("llm-multimodal:" + Date.now().toString(36) + ":" + Math.random().toString(36).slice(2, 8)),
            role: "user",
            content: [{ type: "text", text: args.system ? args.system + "\n\n" + args.prompt : args.prompt }],
            source: { kind: "user" },
          }],
          signal: exec.signal,
        })) {
          if (chunk?.type === "text-delta") text += chunk.text || "";
          else if (chunk?.type === "usage") usage = { inputTokens: chunk.usage?.inputTokens || 0, outputTokens: chunk.usage?.outputTokens || 0 };
        }
      } catch (e) {
        return { success: false, message: "text stream 失败: " + (e?.message || String(e)) };
      }
      return {
        success: true,
        text,
        model: `${provider}/${model}`,
        usage,
        latencyMs: Date.now() - t0,
      };
    },
  }));

  // ── generate_image ─────────────────────────────────────────────────────

  tools.register(defineTool({
    name: "generate_image",
    description:
      "Generate an image via OpenAI-compatible /images/generations. Models are auto-discovered from `llm-pi-ai` (model id containing image / dall / flux / imagen / sdxl / midjourney). Use `model` to override; blank → first discovered image model.",
    parameters: {
      prompt: { type: "string", required: true, description: "Image prompt." },
      model: { type: "string", description: "Optional model id override." },
      size: { type: "string", description: "Image size, e.g. 1024x1024 / 1792x1024 / 1024x1792.", default: "1024x1024" },
      n: { type: "integer", description: "Number of images to generate.", default: 1 },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          success: { type: "boolean" },
          url: { type: "string" },
          model: { type: "string" },
          bytes: { type: "number" },
          latencyMs: { type: "number" },
          message: { type: "string" },
        },
      },
      render: (_args, value) => renderJsonSummary(value),
    },
    async execute(args, exec) {
      const models = await discoverModels(credentials);
      const override = readModalityOverride(getScope(), "image");
      const candidates = models.filter(m => m.type === "image");
      let target = pickModel(candidates, "image", args.model);
      target = applyOverride(target, override);
      if (!target) {
        return { success: false, message: "未发现可用的图像模型（model id 需包含 image/dall/flux/imagen/sdxl 等关键字）。" };
      }
      if (!target.apiKey) {
        return { success: false, message: `模型 ${target.id} 未配置 apiKey（${target.apiKeyEnv || "API_KEY"} 环境变量）。` };
      }
      try {
        const client = createClient(target.baseURL, target.apiKey, target.id);
        const t0 = Date.now();
        const { ok, body } = await client.images.generate({
          model: target.id,
          prompt: args.prompt,
          n: args.n || 1,
          size: args.size || "1024x1024",
        });
        if (!ok) {
          return { success: false, message: "图像生成失败: HTTP " + (body?.error?.message || JSON.stringify(body).slice(0, 200)) };
        }
        const media = extractFirstMedia(body);
        if (!media) return { success: false, message: "图像生成失败: 响应无 url/base64。" };
        if (media.b64) {
          // b64 fallback path — write to a tmp file and return file URL
          const dest = `/tmp/llm-multimodal-${Date.now()}.png`;
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, Buffer.from(media.b64, "base64"));
          return { success: true, url: "file://" + dest, model: target.id, latencyMs: Date.now() - t0 };
        }
        const dest = `/tmp/llm-multimodal-${Date.now()}.${guessExt(media.url)}`;
        const bytes = await downloadTo(media.url, dest, exec.signal);
        return { success: true, url: "file://" + dest, model: target.id, bytes, latencyMs: Date.now() - t0, message: "图像已生成" };
      } catch (e) {
        return { success: false, message: "图像生成失败: " + (e?.message || String(e)) };
      }
    },
  }));

  // ── generate_video ─────────────────────────────────────────────────────

  tools.register(defineTool({
    name: "generate_video",
    description:
      "Generate a short video via OpenAI-compatible /videos/generations (Sora-style), fallback to /videos (Agnes-style) and /chat/completions. Submit+poll, may block 30–90s.",
    parameters: {
      prompt: { type: "string", required: true, description: "Video scene description." },
      model: { type: "string", description: "Optional model id override." },
      duration: { type: "integer", description: "Duration (seconds).", default: 5 },
      size: { type: "string", description: "Video size, e.g. 1280x720.", default: "1280x720" },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => renderJsonSummary(value),
    },
    async execute(args, exec) {
      const models = await discoverModels(credentials);
      const override = readModalityOverride(getScope(), "video");
      const candidates = models.filter(m => m.type === "video");
      let target = pickModel(candidates, "video", args.model);
      target = applyOverride(target, override);
      if (!target) {
        return { success: false, message: "未发现可用的视频模型（model id 需包含 video/sora/seedance/kling/veo/pika 等关键字）。" };
      }
      if (!target.apiKey) {
        return { success: false, message: `模型 ${target.id} 未配置 apiKey（${target.apiKeyEnv || "API_KEY"} 环境变量）。` };
      }

      const client = createClient(target.baseURL, target.apiKey, target.id);
      const agnesBody = { model: target.id, prompt: args.prompt, seconds: String(args.duration || 5) };
      const openAIBody = { model: target.id, prompt: args.prompt, duration: args.duration || 5, size: args.size || "1280x720" };

      // Strategy 1: Agnes-style
      try {
        const { ok, body } = await client.videos.generate(agnesBody);
        if (ok) {
          const url = body?.url || body?.video?.url || extractFirstVideoUrl(JSON.stringify(body));
          if (url) return { success: true, videoUrl: url, model: target.id, coverUrl: extractFirstCoverUrl(body), message: "视频已生成" };
          const taskId = body?.video_id || body?.id || body?.task_id || body?.job_id;
          if (taskId) {
            try {
              const polled = await pollForVideo(taskId, client.videos.retrieve);
              return { success: true, videoUrl: polled.url, model: target.id, coverUrl: extractFirstCoverUrl(polled.response || body), message: "视频已生成" };
            } catch (e) {
              return { success: false, message: e.message };
            }
          }
        } else {
          const msg = (body?.error?.message || "").toLowerCase();
          if (!/invalid url|not found|invalid request|invalid mode|is a video model|use \/v1\/videos/.test(msg)) {
            return { success: false, message: "视频生成失败: " + (body?.error?.message || JSON.stringify(body).slice(0, 200)) };
          }
        }
      } catch (_) {}
      // Strategy 2: OpenAI Sora-style
      try {
        const { ok, body } = await client.videosOpenAI.generate(openAIBody);
        if (ok) {
          const url = body?.url || body?.video?.url || extractFirstVideoUrl(JSON.stringify(body));
          if (url) return { success: true, videoUrl: url, model: target.id, coverUrl: extractFirstCoverUrl(body), message: "视频已生成" };
          const taskId = body?.video_id || body?.id || body?.task_id || body?.job_id;
          if (taskId) {
            try {
              const polled = await pollForVideo(taskId, client.videosOpenAI.retrieve);
              return { success: true, videoUrl: polled.url, model: target.id, coverUrl: extractFirstCoverUrl(polled.response || body), message: "视频已生成" };
            } catch (e) {
              return { success: false, message: e.message };
            }
          }
        } else {
          const msg = (body?.error?.message || "").toLowerCase();
          if (!/invalid url|not found|invalid request|is a video model|use \/v1\/videos/.test(msg)) {
            return { success: false, message: "视频生成失败: " + (body?.error?.message || JSON.stringify(body).slice(0, 200)) };
          }
        }
      } catch (_) {}
      // Strategy 3: chat completions
      try {
        const { ok, body } = await client.chat.completions.create({
          model: target.id,
          messages: [{ role: "user", content: args.prompt }],
          extraBody: { mode: "video_generation", duration: args.duration || 5, size: args.size || "1280x720" },
        });
        if (ok) {
          const content = body?.choices?.[0]?.message?.content ?? null;
          const url = extractFirstVideoUrl(content || "") || extractFirstVideoUrl(JSON.stringify(body));
          if (url) return { success: true, videoUrl: url, model: target.id, coverUrl: extractFirstCoverUrl(body), message: "视频已生成" };
          if (content) return { success: false, message: "视频生成返回了文本但无视频 URL: " + content.slice(0, 200) };
        }
        return { success: false, message: "视频生成失败: 端点 " + target.baseURL + " 未返回可用视频数据。" };
      } catch (e) {
        return { success: false, message: "视频生成失败: " + (e?.message || String(e)) };
      }
    },
  }));

  // ── generate_tts ───────────────────────────────────────────────────────

  tools.register(defineTool({
    name: "generate_tts",
    description:
      "Synthesize speech via OpenAI-compatible /audio/speech. Auto-discovers a TTS provider from `llm-pi-ai` (model id containing tts/speech/voice/minimax). Use `voice` to pick a MiniMax voice preset (e.g. female-shaonv, male-qn-jingying).",
    parameters: {
      text: { type: "string", required: true, description: "Literal text to speak. Not a song lyric." },
      voice: { type: "string", description: "Voice preset id (e.g. female-shaonv, male-qn-jingying). Falls back to llm-multimodal.tts.voice." },
      model: { type: "string", description: "Optional model id override." },
      speed: { type: "number", description: "Speech speed 0.5–2.0. Default 1.0." },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => renderJsonSummary(value),
    },
    async execute(args, exec) {
      if (!args.text || !args.text.trim()) {
        return { success: false, message: "TTS 需要非空 text" };
      }
      const models = await discoverModels(credentials);
      const override = readModalityOverride(getScope(), "tts");
      const candidates = models.filter(m => m.type === "tts" || m.type === "text" && /speech|tts|minimax|voice/i.test(m.id));
      let target = pickModel(candidates, "tts", args.model);
      target = applyOverride(target, override);
      if (!target) {
        return { success: false, message: "未发现可用的 TTS 模型（model id 需包含 tts/speech/voice/minimax 等关键字）。" };
      }
      if (!target.apiKey) {
        return { success: false, message: `TTS 模型 ${target.id} 未配置 apiKey（${target.apiKeyEnv || "API_KEY"} 环境变量）。` };
      }
      try {
        const client = createClient(target.baseURL, target.apiKey, target.id);
        const t0 = Date.now();
        const body = {
          model: target.id,
          input: args.text,
          voice: args.voice?.trim() || override.voice || "alloy",
          response_format: "mp3",
          speed: args.speed ?? 1.0,
        };
        const res = await fetch(target.baseURL.replace(/\/+$/, "") + "/audio/speech", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + target.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: exec.signal,
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          return { success: false, message: "TTS HTTP " + res.status + ": " + t.slice(0, 200) };
        }
        const ct = res.headers.get("content-type") || "";
        if (!ct.startsWith("audio/")) {
          const t = await res.text().catch(() => "");
          return { success: false, message: "TTS 响应 content-type=" + ct + ", body: " + t.slice(0, 200) };
        }
        const dest = `/tmp/llm-multimodal-tts-${Date.now()}.${(guessExt(args.voice || "audio.mp3", ct))}`;
        await mkdir(dirname(dest), { recursive: true });
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(dest, buf);
        return { success: true, url: "file://" + dest, model: target.id, bytes: buf.length, voice: body.voice, latencyMs: Date.now() - t0, message: "音频已生成" };
      } catch (e) {
        return { success: false, message: "TTS 失败: " + (e?.message || String(e)) };
      }
    },
  }));

  // ── generate_music ─────────────────────────────────────────────────────
  //
  // Music is structurally identical to TTS in this build — both call
  // /audio/speech with the same wire shape. The split exists so the
  // settings UI can carry a separate `voice` and so future backends
  // (Suno / HeartMuLa) can register an actual music-style adapter
  // without touching the TTS path.

  tools.register(defineTool({
    name: "generate_music",
    description:
      "Synthesize music / voice-via-music-clip via OpenAI-compatible /audio/speech. Behaviourally same as generate_tts; the split lets the settings UI carry a separate `voice`. Most providers currently serve both via the same endpoint.",
    parameters: {
      text: { type: "string", required: true, description: "Lyric / text hint. Some providers ignore this for music." },
      voice: { type: "string", description: "Voice preset id. Falls back to llm-multimodal.music.voice." },
      model: { type: "string", description: "Optional model id override." },
      speed: { type: "number", description: "Playback speed 0.5–2.0.", default: 1.0 },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => renderJsonSummary(value),
    },
    async execute(args, exec) {
      if (!args.text || !args.text.trim()) {
        return { success: false, message: "music 需要非空 text" };
      }
      const models = await discoverModels(credentials);
      const override = readModalityOverride(getScope(), "music");
      const candidates = models.filter(m => m.type === "music" || m.type === "tts" || /music|song|lyric|minimax/i.test(m.id));
      let target = pickModel(candidates, "music", args.model);
      target = applyOverride(target, override);
      if (!target) {
        return { success: false, message: "未发现可用的 music 模型（model id 需包含 music/song/lyric 等关键字）。" };
      }
      if (!target.apiKey) {
        return { success: false, message: `music 模型 ${target.id} 未配置 apiKey（${target.apiKeyEnv || "API_KEY"} 环境变量）。` };
      }
      try {
        const t0 = Date.now();
        const body = {
          model: target.id,
          input: args.text,
          voice: args.voice?.trim() || override.voice || "alloy",
          response_format: "mp3",
          speed: args.speed ?? 1.0,
        };
        const res = await fetch(target.baseURL.replace(/\/+$/, "") + "/audio/speech", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + target.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: exec.signal,
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          return { success: false, message: "music HTTP " + res.status + ": " + t.slice(0, 200) };
        }
        const ct = res.headers.get("content-type") || "";
        const dest = `/tmp/llm-multimodal-music-${Date.now()}.mp3`;
        await mkdir(dirname(dest), { recursive: true });
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(dest, buf);
        return { success: true, url: "file://" + dest, model: target.id, bytes: buf.length, voice: body.voice, latencyMs: Date.now() - t0, message: "音乐已生成" };
      } catch (e) {
        return { success: false, message: "music 失败: " + (e?.message || String(e)) };
      }
    },
  }));
}

// ── HTTP routes for the settings card ──────────────────────────────────────
//
// The settings card (client.js) needs to know every discovered provider
// AND every model that auto-discovery would pick for each modality so its
// `<select>` dropdowns can render `<optgroup>` rows. We expose one JSON
// endpoint: `GET /api/llm-multimodal/models`. The card polls this on
// mount and after every save (so newly-configured providers show up).
//
// Why group by provider?
//   The user typically wires 1-3 image providers (Agnes / OpenAI / Replicate
//   …) and needs to pick a row from each `<optgroup>`. Listing them flat
//   duplicates the model id in three columns and makes it easy to grab the
//   wrong one.

/**
 * One HTTP route registration paired with its handler. Mirrors the shape
 * media-studio uses through `ctx.webServer.register({ kind, path, handler })`.
 */
function registerRoute(wserver, method, path, handler) {
  if (!wserver || typeof wserver.register !== "function") return
  wserver.register({ kind: 'exact', path, handler })
}

/**
 * Scan every configured llm-pi-ai provider once and return an object shape
 * the settings card can consume directly:
 *
 *   {
 *     providers: [
 *       { id: "agnes", displayName: "Agnes", baseURL: "https://...",
 *         apiKeyEnv: "AGNES_API_KEY", models: [...] }
 *     ],
 *     byModality: {
 *       text:   [ { provider, modelId, displayName, baseURL }, ... ],
 *       image:  [ ... ],
 *       video:  [ ... ],
 *       tts:    [ ... ],
 *       music:  [ ... ]
 *     }
 *   }
 *
 * Group ordering per modality is preserved (provider order from
 * settings.yaml → model order within each provider). Empty providers are
 * omitted; empty modalities return [].
 */
async function buildModelsSnapshot(credentials) {
  const providers = await readPiAiProviders()
  const providerRows = []
  const allModels = []
  for (const [pid, p] of Object.entries(providers)) {
    if (!p || !Array.isArray(p.models)) continue
    const baseURL = p.baseURL || ""
    const apiKeyEnv = p.apiKeyEnv || ""
    const displayName = (p.displayName || pid)
    const models = []
    for (const m of p.models) {
      const id = (m && m.id) || ""
      if (!id) continue
      const name = (m && m.name) || id
      models.push({ provider: pid, id, name, type: classifyModelId(id) })
      allModels.push({ provider: pid, id, name, type: classifyModelId(id), baseURL })
    }
    if (models.length === 0) continue
    providerRows.push({ id: pid, displayName, baseURL, apiKeyEnv, models })
  }
  const byModality = { text: [], image: [], video: [], tts: [], music: [] }
  for (const m of allModels) {
    if (byModality[m.type]) byModality[m.type].push(m)
  }
  return { providers: providerRows, byModality }
}

/**
 * Plug HTTP endpoints. Called once per plugin apply via ctx.effect.
 *
 * Why the language matters here: webServer.register is the canonical DSH
 * plugin surface — the same one media-studio uses for its canvas SSE.
 * Hosting our own routes keeps the multimodal plugin self-contained and
 * avoids depending on media-studio's /api/media-studio/* paths.
 */
function attachHttpRoutes(ctx) {
  const wserver = ctx.webServer

  // GET /api/llm-multimodal/models — settings card polls this on mount.
  registerRoute(wserver, 'GET', '/api/llm-multimodal/models', async (_req, res) => {
    try {
      const snap = await buildModelsSnapshot(ctx.credentials)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, ...snap }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }))
    }
  })

  // GET /api/llm-multimodal/providers — convenience alias used by the
  // settings card's "已发现 N 个 provider" header. Returns the same rows.
  registerRoute(wserver, 'GET', '/api/llm-multimodal/providers', async (_req, res) => {
    try {
      const snap = await buildModelsSnapshot(ctx.credentials)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, providers: snap.providers }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }))
    }
  })
}

// Test-only exports for the new helpers. (Same convention as the rest of
// this module — kept out of the production path but reachable by vitest.)
export {
  buildModelsSnapshot,
  attachHttpRoutes,
};

// ── Test-only exports ─────────────────────────────────────────────────────
//
// These are not part of the plugin's cordis contract — they exist only so
// `vitest` can exercise the pure helpers (model classification, override
// merging, provider discovery) without spinning up a full DSH harness.
// Production bundlers and the host process never reach for them.
export {
  classifyModelId,
  pickModel,
  applyOverride,
  readModalityOverride,
  extractFirstMedia,
  extractFirstVideoUrl,
  extractFirstCoverUrl,
  IMG_KEYWORDS,
  VID_KEYWORDS,
  TTS_KEYWORDS,
  MUSIC_KEYWORDS,
  TEXT_KEYWORDS,
};

// Override the default export to add the above for tests — Node's
// "default export" semantics swallow the named exports in CJS, but we
// ship ESM so name exports ride through untouched.
