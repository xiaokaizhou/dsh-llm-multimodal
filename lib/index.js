/**
 * dsh-llm-multimodal — host half (Node).
 *
 * Registers SIX model-facing tools, all backed by the user's existing
 * `llm-pi-ai` settings namespace (no per-tool UI reconfiguration):
 *
 *   - generate_text   → LlmRuntime.prepareCall / stream (any text-capable
 *                       provider the harness is already configured for)
 *   - generate_image  → POST {baseURL}/images/generations
 *   - generate_video  → POST {baseURL}/videos/generations (preferred)
 *                         ↳ fallback: POST {baseURL}/videos   (Agnes style)
 *                         ↳ fallback: POST {baseURL}/chat/completions
 *   - generate_vision → POST {baseURL}/chat/completions with OpenAI
 *                       Vision content parts (text + image_url[]).
 *                       Auto-discovers vision-classified models (id
 *                       contains vision/qwen-vl/llava/internvl/claude-3/
 *                       gpt-4o-vision/…) so any OpenAI-compatible VL
 *                       endpoint (GPT-4o vision, Claude 3 vision, Qwen-VL,
 *                       LLaVA, InternVL, Pixtral, …) works out of the box.
 *   - generate_tts    → POST {baseURL}/audio/speech (OpenAI TTS spec);
 *                       uses TTS-classified models ONLY (id contains
 *                       tts/speech/voice/minimax); `voice` = preset id
 *                       (MiniMax / ElevenLabs) or a cloned voice_id;
 *                       `clone_audio` + `voice_name` clone a character's
 *                       own voice from reference audio
 *   - generate_music  → POST {baseURL}/audio/speech with music-style body;
 *                       uses music-classified models ONLY (id contains
 *                       music/song/lyric) — TTS models do NOT serve music;
 *                       same clone support as generate_tts
 *
 * All model-facing tools speak the OpenAI protocol: every provider row
 * carries `apiProtocol` (default "openai"); a non-openai value is rejected
 * at call time with an actionable error.
 *
 * Provider sources:
 *   1. Auto-discovery from the existing `llm-pi-ai` settings namespace — any
 *      configured model whose id matches image/video/vision/tts/music
 *      keywords becomes an available tool target WITHOUT any extra
 *      configuration.
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
import Schema from "@deepseek-ai/schemastery";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import {
  MODALITIES,
  resolveCapabilities,
  hasModality,
  pickModel as pickModelByCapability,
  describeCandidates,
  normalizeModelKey,
  capabilityStorePath,
  loadCapabilityStore,
  saveCapabilityStore,
  applyOverrideEntry,
  fetchProviderCatalog,
  setProviderMeta,
  getProviderMeta,
  defaultRules,
} from "./capabilities.js";

export const name = "dsh-llm-multimodal";
export const inject = ["tools", "credentials", "settings", "llm", "webServer"];

// ── Settings namespace ────────────────────────────────────────────────────
//
// Six modalities, each carrying `{ provider, baseURL, apiKey, defaultModel }`.
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
// DSH 0.2.x derives the editable settings form from the plugin's exported
// `Config` schema. A field marked `.volatile()` is USER-OWNED: the host
// keeps its value in a live reference, re-writes it when the profile patch
// changes, and never re-applies the plugin for it. Everything else stays
// ordinary profile configuration.
//
// `volatile` toggles between the two flavours of the same field set: the
// legacy plain schema (kept for hosts that still expose `settings.register`)
// and the volatile one DSH 0.2.x serves through the settings mirror.
const MODEL_FIELD_NAMES = ["provider", "apiProtocol", "baseURL", "apiKey", "defaultModel"];
const AUDIO_FIELD_NAMES = [...MODEL_FIELD_NAMES, "voice"];

/** Build one modality's field dictionary, optionally volatile. */
function modalityFields(names, volatile) {
  const out = {};
  for (const name of names) {
    const field = Schema.string().default("");
    out[name] = volatile ? field.volatile() : field;
  }
  return out;
}

/** Plain defaults for one modality section. */
function modalityDefaults(names) {
  const out = {};
  for (const name of names) out[name] = "";
  return out;
}

// Each modality is itself a Schemastery object schema, wrapped in
// `.default(...)` so a partially-populated user section (e.g. only
// `image` filled) still validates cleanly against the full schema.
const TextSchema = Schema.object(modalityFields(MODEL_FIELD_NAMES, false)).default(modalityDefaults(MODEL_FIELD_NAMES));
const ImageSchema = Schema.object(modalityFields(MODEL_FIELD_NAMES, false)).default(modalityDefaults(MODEL_FIELD_NAMES));
const VideoSchema = Schema.object(modalityFields(MODEL_FIELD_NAMES, false)).default(modalityDefaults(MODEL_FIELD_NAMES));
const VisionSchema = Schema.object(modalityFields(MODEL_FIELD_NAMES, false)).default(modalityDefaults(MODEL_FIELD_NAMES));
const TtsSchema = Schema.object(modalityFields(AUDIO_FIELD_NAMES, false)).default(modalityDefaults(AUDIO_FIELD_NAMES));
const MusicSchema = Schema.object(modalityFields(AUDIO_FIELD_NAMES, false)).default(modalityDefaults(AUDIO_FIELD_NAMES));

// The volatile twins of the six modality schemas — the ones DSH 0.2.x
// serves as the editable `llm-multimodal` form.
const VolatileTextSchema = Schema.object(modalityFields(MODEL_FIELD_NAMES, true)).default(modalityDefaults(MODEL_FIELD_NAMES));
const VolatileImageSchema = Schema.object(modalityFields(MODEL_FIELD_NAMES, true)).default(modalityDefaults(MODEL_FIELD_NAMES));
const VolatileVideoSchema = Schema.object(modalityFields(MODEL_FIELD_NAMES, true)).default(modalityDefaults(MODEL_FIELD_NAMES));
const VolatileVisionSchema = Schema.object(modalityFields(MODEL_FIELD_NAMES, true)).default(modalityDefaults(MODEL_FIELD_NAMES));
const VolatileTtsSchema = Schema.object(modalityFields(AUDIO_FIELD_NAMES, true)).default(modalityDefaults(AUDIO_FIELD_NAMES));
const VolatileMusicSchema = Schema.object(modalityFields(AUDIO_FIELD_NAMES, true)).default(modalityDefaults(AUDIO_FIELD_NAMES));

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
// modality-specific fields (`coverUrl` for video first-frame, `voice`,
// …) — as a fenced JSON
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
  vision: VisionSchema,
  tts: TtsSchema,
  music: MusicSchema,
  // Optional output directory for generated media. Empty → /tmp (legacy
  // default). Only consulted when `outputStrategy` is "outputDir", or as
  // the fallback target when strategy is "project" but the media-studio
  // service / active project is unavailable.
  outputDir: Schema.string().default(""),
  // Where generated media lands:
  //   "project"   (default) — write into the ACTIVE media-studio project's
  //                asset tree (<sourcePath>/assets/<kind>/) via the
  //                `mediaStudio` cross-plugin service; falls back to
  //                `outputDir` when the service is absent or no project is
  //                active. Result carries projectId + canvasUrl.
  //   "outputDir" (legacy)  — always write to `outputDir` (empty → /tmp).
  outputStrategy: Schema.string().default("project"),
});

// DSH 0.2.x configuration schema. The host reads `runtime.Config` off the
// plugin module, derives the editable form from its VOLATILE leaves and
// serves it under the `llm-multimodal` namespace (the profile entry id).
//
// Volatile leaves are live references: the host re-validates them when the
// profile patch changes and mutates the reference in place, so a running
// plugin observes new values on its next call — no restart, no re-apply.
export const Config = Schema.object({
  text: VolatileTextSchema,
  image: VolatileImageSchema,
  video: VolatileVideoSchema,
  vision: VolatileVisionSchema,
  tts: VolatileTtsSchema,
  music: VolatileMusicSchema,
  outputDir: Schema.string().default("").volatile(),
  outputStrategy: Schema.string().default("project").volatile(),
});

// In DSH 0.1.2-rc.1 the `settingsNamespace(...)` brand helper is no longer
// exported (its validation logic moved into SettingsProvider.register). Use a
// plain string literal here; SettingsProvider.register still accepts it via
// the `SettingsNamespaceInput` type predicate, and the runtime regex check
// inside the provider fires on registration.
export const NS = "llm-multimodal";

export const DEFAULT_LLM_MULTIMODAL = {
  text: { provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "" },
  image: { provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "" },
  video: { provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "" },
  vision: { provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "" },
  tts: { provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "", voice: "" },
  music: { provider: "", apiProtocol: "", baseURL: "", apiKey: "", defaultModel: "", voice: "" },
  outputDir: "",
  outputStrategy: "project",
};

// ── Settings loader (reads llm-pi-ai from disk) ────────────────────────────

function defaultSettingsPath() {
  return process.env.DSH_SETTINGS_PATH || join(homedir(), ".dsh", "settings.yaml");
}

/**
 * Location of the running profile's composition patch (DSH >= 0.2 stores
 * plugin configuration there instead of the legacy `settings.yaml`).
 *
 * `setProfilePatchPath()` is called from `apply()` with the path the host's
 * own `configEditor` service reports, which is the only reliable source
 * inside the desktop app (it does not export DSH_PROFILE_DIR).
 */
let profilePatchFile = "";

export function setProfilePatchPath(path) {
  profilePatchFile = typeof path === "string" ? path : "";
}

function profilePatchPath() {
  if (profilePatchFile) return profilePatchFile;
  const dir = process.env.DSH_PROFILE_DIR;
  if (dir) return join(dir, "cordis.patch.yml");
  const profile = process.env.DSH_PROFILE;
  if (!profile) {
    // Last resort: the desktop host gets the profile directory as a launch
    // argument (`.../dsh <profile-dir> <runtime> <pnpm> <bin>`).
    const fromArgv = process.argv.find(a => /[\\/]\.dsh[\\/]profiles[\\/][^\\/]+$/.test(a || ""));
    if (fromArgv) return join(fromArgv, "cordis.patch.yml");
    return "";
  }
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "profiles", profile, "cordis.patch.yml");
}

function providersFromDocument(doc) {
  if (!doc) return {};
  // Legacy shape: { "llm-pi-ai": { providers: {...} } }
  const direct = doc["llm-pi-ai"];
  if (direct && typeof direct === "object") return direct.providers || {};
  // Profile patch shape: a list of { id, name, config } rows, possibly
  // nested under `insert:` groups.
  if (!Array.isArray(doc)) return {};
  const rows = [];
  for (const row of doc) {
    if (!row || typeof row !== "object") continue;
    if (Array.isArray(row.insert)) rows.push(...row.insert);
    else rows.push(row);
  }
  const entry = rows.find(r => r && (r.id === "llm-pi-ai" || r.name === "@deepseek-ai/dsh-llm-pi-ai"));
  return entry?.config?.providers || {};
}

async function readProvidersFromFile(path) {
  if (!path) return {};
  try {
    const raw = await readFile(path, "utf8");
    return providersFromDocument(parseYaml(raw)) || {};
  } catch (_) {
    return {};
  }
}

/**
 * pi-ai provider rows, in the shape this plugin consumes:
 * `{ baseURL, apiKeyEnv, api, models: [{ id, name? }] }`.
 *
 * Sources, later wins:
 *   1. the legacy `~/.dsh/settings.yaml` document (DSH <= 0.1, and the
 *      explicit `DSH_SETTINGS_PATH` override used by the tests);
 *   2. the running profile's `cordis.patch.yml` (DSH >= 0.2).
 */
async function readPiAiProviders() {
  const explicit = process.env.DSH_SETTINGS_PATH;
  // An explicit settings path is authoritative — tests rely on this to stay
  // hermetic and ignore the developer's real profile.
  if (explicit) return await readProvidersFromFile(explicit);
  const merged = {};
  Object.assign(merged, await readProvidersFromFile(defaultSettingsPath()));
  Object.assign(merged, await readProvidersFromFile(profilePatchPath()));
  return merged;
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

async function fetchJson(url, opts, ms = 300_000) {
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
      generate: (params, ms) => {
        // User-provided mode takes priority; default to text for Flash, ti2vid otherwise
        const defaultMode = isAgnesFlash ? "text" : "ti2vid";
        const body = { mode: defaultMode, ...params };
        // Only set default size for Flash if user didn't provide size
        if (isAgnesFlash && !body.size) body.size = "720P";
        return fetchJson(base + "videos", {
          method: "POST", headers: jsonHeaders, body: JSON.stringify(body)
        }, ms);
      },
      retrieve: (taskId, ms) => {
        if (isAgnesFlash) {
          const url = base + "agnesapi?video_id=" + taskId +
                      "&model_name=" + encodeURIComponent(modelId || "");
          return fetchJson(url, { method: "GET", headers: jsonHeaders }, ms);
        }
        return fetchJson(base + "videos/" + taskId, {
          method: "GET", headers: jsonHeaders
        }, ms);
      },
    },
    videosOpenAI: {
      generate: (params, ms) =>
        fetchJson(base + "videos/generations", {
          method: "POST", headers: jsonHeaders, body: JSON.stringify(params)
        }, ms),
      retrieve: (taskId, ms) =>
        fetchJson(base + "videos/" + taskId, {
          method: "GET", headers: jsonHeaders
        }, ms),
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

const IMG_KEYWORDS = [
  // Core image generators (OpenAI / Flux / Google / Midjourney / SD family)
  "image", "flux", "dall", "imagen", "midjourney", "sdxl", "sd-", "kandinsky",
  // Local-model additions: RealESRGAN (image upscaler), Juggernaut /
  // juggernautXL (realistic image checkpoint), photoreal / photorealistic
  // checkpoints. We deliberately do NOT add a bare "uncensored" keyword
  // here — `local-qwen3.8-uncensored` would otherwise be mis-classified
  // as image, dropping the text-classified qwen base model out of
  // generate_text. Users with a bare "uncensored" image id should rename
  // it to e.g. `local-uncensored-image` so the "image" keyword matches.
  "realesrgan", "juggernaut", "photoreal",
];
const VID_KEYWORDS = [
  // Mainstream video generators
  "video", "sora", "seedance", "kling", "veo", "runway", "pika",
  "hunyuan-video", "cogvideo", "cogvideox",
  // Local-model additions: Wan (Wan2.x video generator), LTX-Video,
  // SeedVR2 (video upscaler), MuseTalk / lipsync (lip-sync video models).
  "wan", "ltx", "seedvr", "musetalk", "lipsync",
  // MiniMax Hailuo video model (本地 Apple Silicon 部署). ~/models 网关把
  // `local-h3` / `local-h3c` / `local-minimax-h3` 都路由到 h3c/models/MiniMax-H3；
  // id 里没有任何 video 关键字，但服务端只接受 video 请求，所以必须显式列出来。
  // 注意：`h3` 是个相对通用的子串（理论上可能撞上别的 id），但 video 检查在
  // TTS_KEYWORDS（含 "minimax"）之前执行，所以 `local-minimax-h3` 走 video
  // 路径也不会被 `minimax` 抢走归类到 tts。
  "hailuo", "h3c", "h3",
];
const VL_KEYWORDS = [
  // Mainstream vision-language models — explicit "vision" / "-vl" /
  // "-vision" suffix keywords that unambiguously mark a multimodal
  // vision model. We deliberately do NOT include bare family ids
  // ("gpt-4o", "claude-3", "gemini") here because those models are
  // auto-discovered as `text` by the existing TEXT_KEYWORDS list and
  // are usable from `generate_text`; users with the explicit
  // multimodal intent should rename the model id to include a VL
  // keyword (e.g. `gpt-4o-vision`, `claude-3-vision`) OR pick it from
  // the settings card's "视觉" dropdown.
  //
  // OpenAI family: gpt-4o-vision / gpt-4-vision / gpt-4.1-vision / …
  "vision",
  // Qwen-VL family (qwen-vl / qwen-vl-plus / qwen2-vl / qwen2.5-vl / …)
  "qwen-vl", "qwen2-vl", "qwen2.5-vl",
  // LLaVA / LLaVA-NeXT (also matches the alternative "llava-next" form)
  "llava", "llava-next",
  // InternVL family
  "internvl", "intern-vl",
  // Anthropic Claude vision models (id form: claude-3-vision / claude-3.5-vision / claude-3.7-sonnet-vision …)
  // The "claude-3" prefix is intentionally NOT included so that text-
  // classifiable bare "claude-3-opus" ids stay on the text side.
  "claude-3-vision", "claude-3.5-vision", "claude-3.7-vision", "claude-vision",
  // Google Gemini vision variants
  "gemini-vision", "gemini-1.5-vision", "gemini-2-vision",
  // Mistral Pixtral
  "pixtral",
  // Google PaliGemma (gemma vision-language)
  "paligemma",
  // Yi-VL / CogVLM / Molmo / Phi-3 vision / GLM-4V / MiniCPM-V / Mantis
  "yi-vl", "cogvlm", "molmo", "phi-3-vision", "phi3-vision", "glm-4v", "minicpm-v", "mantis",
];
const TTS_KEYWORDS = [
  // Mainstream speech / TTS engines
  "tts", "speech", "voice",
  // MiniMax speech endpoints come in both `minimax-speech-*` and bare
  // `minimax`-prefixed flavours. Only the speech-marked spellings are TTS:
  // a bare `minimax` keyword would swallow the MiniMax CHAT models
  // (MiniMax-M2.7 / M3 / M3.1-Flash-Preview) and hide them from
  // generate_text.
  "minimax-speech", "minimax-voice", "minimax-tts",
  // Local-model additions: VoxCPM / VoxCPM2 (the speech-synthesis model
  // family the user added under the `local` provider — its bare id
  // contains neither "tts" nor "speech" nor "voice", so without this
  // keyword the classifier would drop it back to `text`), and CosyVoice /
  // CosyVoice2 (alternative id form of the local TTS endpoints).
  "voxcpm", "cosyvoice",
];
const MUSIC_KEYWORDS = ["music", "song", "lyric"];
const TEXT_KEYWORDS = ["chat", "instruct", "gpt", "deepseek", "claude", "sonnet", "haiku", "qwen", "gemini", "llama"];

/**
 * Classify a model id into one of the six modalities. Order matters —
 * a model whose id mentions both `video` and `gpt` is unambiguously video
 * because the modality-keyword check runs first; `text` is the fallback.
 *
 * Vision (VL) check runs BEFORE the image check on purpose so that
 * `qwen-vl-image-feature` (a hypothetical id) classifies as vision and
 * not image. A vision model that ALSO generates images still needs the
 * `generate_vision` tool (chat/completions round-trip), not
 * `generate_image` (/images/generations).
 */
/**
 * Legacy single-label classifier, kept as a thin compatibility shim.
 *
 * 0.4 replaced the keyword table with `resolveCapabilities()` in
 * `lib/capabilities.js`, because one label could not describe a model that
 * both chats and sees images (see that module's header for the evidence
 * that motivated the rewrite). Callers that only need a representative
 * label — the legacy `type` field, tests, old settings — get the resolver's
 * `primary` here; everything that selects a model uses `modalities`.
 */
function classifyModelId(id) {
  return resolveCapabilities({ id }).primary;
}

/**
 * Normalize a pi-ai `api` field to this plugin's `apiProtocol` vocabulary.
 * The only value the multimodal tools accept is "openai" (or empty).
 */
function apiProtocolFromApi(api) {
  const raw = (api || "").trim().toLowerCase();
  if (!raw) return "openai";
  if (raw.startsWith("openai")) return "openai";
  if (raw.startsWith("anthropic") || raw.startsWith("claude")) return "anthropic";
  return raw;
}

/**
 * Read the user's capability store (pinned modalities + custom rules).
 *
 * Kept separate from discovery so the HTTP handlers can return the same
 * file the resolver used, and so a broken/hand-edited file degrades to "no
 * overrides" instead of failing every tool call.
 */
async function readCapabilityStore() {
  try {
    const path = capabilityStorePath(profilePatchPath());
    return { path, store: await loadCapabilityStore(path, readFile) };
  } catch (_) {
    return { path: capabilityStorePath(profilePatchPath()), store: { overrides: {}, rules: [] } };
  }
}

async function discoverModels(credentials) {
  const out = [];
  const providers = await readPiAiProviders();
  const { store } = await readCapabilityStore();
  for (const [pid, p] of Object.entries(providers)) {
    if (!p || !Array.isArray(p.models)) continue;
    const baseURL = p.baseURL || "";
    const apiKey = await resolveApiKey(credentials, p.apiKeyEnv);
    // All multimodal tools speak the OpenAI protocol (OpenAI-compatible
    // REST endpoints). Providers default to it; a non-openai protocol is
    // rejected at call time with an actionable error.
    //
    // DSH <= 0.1 settings carried `apiProtocol`; DSH >= 0.2 profiles carry
    // pi-ai's own `api` field (`openai-completions`, `anthropic-messages`,
    // `openai-responses`, ...). Map the newer spelling onto the protocol
    // names the guard below understands.
    const apiProtocol = (p.apiProtocol || apiProtocolFromApi(p.api));
    // Metadata from the last `POST /api/llm-multimodal/detect` (if any) —
    // never fetched here: discovery runs on every tool call and must not
    // block on a provider round-trip.
    const providerMeta = getProviderMeta(pid);
    for (const model of p.models) {
      const id = (model && model.id) || "";
      if (!id) continue;
      const name = (model && model.name) || id;
      // pi-ai already declares what a model takes and returns; that is the
      // strongest evidence available and used to be thrown away here.
      const meta = {
        input: model?.input,
        output: model?.output,
        contextWindow: model?.contextWindow,
        maxTokens: model?.maxTokens,
      };
      const resolved = resolveCapabilities({
        id,
        name,
        meta,
        override: store.overrides[normalizeModelKey(pid, id)],
        providerMeta: providerMeta ? providerMeta[id] : undefined,
        rules: store.rules,
      });
      // Raw-HTTP modalities (image / video / tts / music) need an explicit
      // baseURL; chat rows go through endpoints the provider config already
      // resolves, so a provider without baseURL (built-in `minimax-cn`) stays
      // usable for generate_text instead of disappearing entirely.
      if (!baseURL && !hasModality(resolved, "text")) continue;
      out.push({
        provider: pid,
        id,
        name,
        type: resolved.primary,
        modalities: resolved.modalities,
        primary: resolved.primary,
        confidence: resolved.confidence,
        sources: resolved.sources,
        contextWindow: meta.contextWindow,
        maxTokens: meta.maxTokens,
        input: meta.input,
        output: meta.output,
        baseURL,
        apiKey,
        apiKeyEnv: p.apiKeyEnv || "",
        apiProtocol,
      });
    }
  }
  return out;
}

/**
 * Resolve which model row to use for one tool call.
 *
 * Returns `{ model, requestedButMissing }`:
 *   - `model` is the discovered row to call (may be `null` when the
 *     modality has zero candidates, in which case the caller surfaces
 *     a hard "no model" error).
 *   - `requestedButMissing` is `true` when the caller passed a `model`
 *     arg that did NOT match any discovered row. The caller should then
 *     downgrade silently to the auto-discovered fallback AND prepend a
 *     human-readable warning to the result message, so the user can
 *     fix their config (or drop the `model` arg) without losing the
 *     call. When `requestedId` is empty/undefined the flag is `false`
 *     — that's the "no model arg, just auto-pick" path.
 *
 * Why a tuple instead of returning the fallback model with a hidden
 * flag: every existing test asserts truthiness on the returned row, so
 * the calling code can read `result.model` and keep working unchanged.
 */
/**
 * Resolve which model row to use for one tool call.
 *
 * Delegates to `pickModel()` in `lib/capabilities.js`, whose 0.4 semantics
 * are:
 *   - an explicit `requestedId` (bare id, name, `provider:id` or
 *     `provider/id`) is looked up in EVERY row and used when it exists,
 *     with `capabilityMismatch` set when the resolver did not label it with
 *     the requested modality — the caller warns instead of swapping models;
 *   - a miss returns `model: null` + `requestedButMissing: true`, so the
 *     tool can return an actionable "not found + here are the candidates"
 *     error. 0.3 silently called a different model here, which is how
 *     `generate_vision` ended up reporting a model the caller never asked
 *     for.
 */
/**
 * Auto-selection for the five HTTP-backed tools.
 *
 * `pickModel` returns the first row of the requested modality, and that row
 * may belong to a provider without a `baseURL` (a harness-routed provider
 * such as minimax-cn). Those rows are worth listing — the capability matrix
 * must show them — but they cannot be called over HTTP, so auto-selection
 * skips to the first row that actually has an endpoint. An explicitly named
 * model is never skipped: the caller gets the precise protocol error instead.
 */
function pickForTool(models, modality, requestedId) {
  const pick = pickModel(models, modality, requestedId);
  if (requestedId) return pick;
  const callable = models.filter((m) => m.baseURL);
  if (callable.length === 0) return pick;
  if (pick.model && pick.model.baseURL && !servedOnNativeRoute(pick.model)) return pick;
  // A mixed gateway (saygm, one baseURL for many families) usually serves
  // `claude-*` on POST /v1/messages and `gemini-*` / `gemma-*` on
  // POST /v1beta/models/*:generateContent, even though the provider is
  // configured as openai-completions: the OpenAI guard passes and the
  // gateway then rejects the call with "is served on POST …". Auto-selection
  // therefore defers those rows behind anything that really speaks
  // /chat/completions. An explicitly named model is never deferred — the
  // caller gets that gateway error verbatim.
  const preferred = callable.filter((m) => !servedOnNativeRoute(m));
  const pool = preferred.length > 0 ? preferred : callable;
  const better = pickModel(pool, modality);
  return better.model ? better : pick;
}

/**
 * A family a mixed gateway typically exposes on its own route rather than
 * through /chat/completions:
 *
 *   claude / anthropic → POST /v1/messages
 *   gemini / gemma     → POST /v1beta/models/<id>:generateContent
 *
 * Only used to order auto-selection, never to hide a row: a gateway that
 * *does* serve those models OpenAI-style merely loses its first-place slot,
 * and an explicitly named model is always honoured.
 */
function servedOnNativeRoute(row) {
  if (!row || !isOpenAIProtocol(row)) return false;
  const text = `${row.id || ''} ${row.name || ''}`;
  if (/(?:^|[-_/.\s])(?:claude|anthropic)/i.test(text)) return true;
  if (/(?:^|[-_/.\s])(?:gemini|gemma|bard|palm)/i.test(text)) return true;
  return false;
}

function pickModel(models, type, requestedId) {
  return pickModelByCapability(models, type, requestedId);
}

/**
 * resolveTextModel — text-tool variant of pickModel.
 *
 * generate_text takes the model arg in `<provider>/<model>` shape (e.g.
 * "deepseek/deepseek-chat"), unlike image/video/tts/music which take a
 * bare id. We split it here, then match against the discovered rows by
 * BOTH provider AND id so "typo-provider/deepseek-chat" is treated as a
 * missing model and triggers the same fallback warning as "flux" does
 * in the image tool.
 *
 * Returns `{ provider, model, requestedButMissing }`:
 *   - `provider` + `model` are the resolved pair (both strings; `model`
 *     is "" when no text candidate was found, in which case the caller
 *     surfaces a hard "no model" error).
 *   - `requestedButMissing` is `true` when the caller passed a non-empty
 *     `requestedId` that did NOT match any discovered row, AND we picked
 *     a fallback instead. The caller prepends the canonical warning.
 *
 * When `requestedId` is empty/undefined the flag is `false` — same as
 * pickModel — because the user opted into auto-pick.
 */
function resolveTextModel(models, requestedId) {
  const raw = (requestedId || "").trim();
  const textRows = models.filter((m) => hasModality(m, "text"));
  if (!raw) {
    const fallback = textRows[0];
    if (!fallback) return { provider: "", model: "", requestedButMissing: false };
    return { provider: fallback.provider, model: fallback.id, requestedButMissing: false };
  }
  // Accept both "<provider>/<model>" and a bare model id. A slash inside the
  // model id itself (e.g. "minimax/h3" on the saygm gateway) is handled by
  // trying the full string first, then splitting once.
  const exactFull = textRows.find((m) => `${m.provider}/${m.id}` === raw || m.id === raw || m.name === raw);
  if (exactFull) return { provider: exactFull.provider, model: exactFull.id, requestedButMissing: false };
  const slash = raw.indexOf("/");
  if (slash > 0) {
    const reqProvider = raw.slice(0, slash);
    const reqModel = raw.slice(slash + 1);
    const exact = textRows.find((m) => m.provider === reqProvider && m.id === reqModel);
    if (exact) return { provider: exact.provider, model: exact.id, requestedButMissing: false };
  }
  // 0.4: a miss is reported, never silently replaced with another model.
  return { provider: "", model: "", requestedButMissing: true };
}

/**
 * Build the user-facing warning that the tool should prepend to its
 * success message when the user-supplied `model` arg didn't match any
 * discovered row and we silently fell back to the auto-picked model.
 *
 * Kept as a single helper so the four tools (image / video / tts / music)
 * all speak the same language and the user sees one canonical phrasing
 * no matter which modality triggered the fallback.
 */
function buildFallbackMessage(modalityLabel, requestedId, fallbackModel) {
  const lines = [
    `⚠ 你指定的 ${modalityLabel} 模型 "${requestedId}" 未在 llm-pi-ai 中找到，已自动降级使用 "${fallbackModel.id}"（来自 provider ${fallbackModel.provider}）。`,
    `解决方式：(1) 在 llm-pi-ai providers 中加入 id/name 为 "${requestedId}" 的模型配置；或 (2) 在 dsh Settings → llm-multimodal → ${modalityLabel} 中预设 defaultModel；或 (3) 移除本次调用的 model 参数让插件自动选择。`,
  ];
  return lines.join("\n");
}

/**
 * "No model for this modality" error with the actual candidates attached.
 *
 * 0.3's messages listed the keyword table (`model id 需包含
 * image/dall/flux/...`), which sent people to rename models to satisfy a
 * substring. 0.4 lists what was really detected, with confidence and the
 * evidence that produced it, plus the way out (pin the modality in the
 * 模型能力 panel, or run 重新探测 for a provider that exposes /models).
 */
function missingModelMessage(modalityLabel, modality, requestedId, models) {
  const candidates = describeCandidates(models, modality);
  const head = requestedId
    ? `未找到 id/name 为 "${requestedId}" 的模型。`
    : `未识别到可用的${modalityLabel}模型。`;
  const hint = [
    "解决方式：(1) 在「设置 → 插件 → llm-multimodal → 模型能力」里为某个模型手动勾选该模态；",
    "(2) 为对应 provider 配置 baseURL 后点「重新探测」，读取其 /models 元数据；",
    "(3) 移除本次调用的 model 参数，让插件按能力自动选择。",
  ].join("");
  return candidates ? `${head}\n当前候选：\n${candidates}\n${hint}` : `${head}\n${hint}`;
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

/**
 * Adapt a single image input for I2I / I2V / keyframe payloads.
 *
 * Many users pass `file:///tmp/xxx.png` (the path shape that
 * dsh-llm-multimodal itself returns), but the upstream provider
 * (Agnes / OpenAI / etc.) rejects `file://` and demands either a public
 * https URL or a `data:image/...;base64,...` URI. We auto-convert the
 * former into the latter on the way out, so callers can chain
 * `generate_image` → `generate_video(image=...)` without caring about
 * the storage format.
 *
 * Hard cap: 8 MB decoded. Larger files are left as-is — the caller
 * almost certainly has a CDN URL we can't improve on.
 */
async function adaptImageInput(img) {
  if (!img || typeof img !== "string") return img;
  // Already a data URI or https URL → leave alone.
  if (img.startsWith("data:") || img.startsWith("http://") || img.startsWith("https://")) {
    return img;
  }
  // file:// path → load and re-encode as data URI.
  let localPath = null;
  if (img.startsWith("file://")) localPath = img.slice(7);
  else if (img.startsWith("/") && existsSync(img)) localPath = img;
  if (!localPath) return img;
  try {
    const st = statSync(localPath);
    if (st.size > 8 * 1024 * 1024) {
      // Too large to inline as base64 — pass through and let the provider error.
      return img;
    }
    const buf = await readFile(localPath);
    const ext = (localPath.split(".").pop() || "png").toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "webp"
        ? "image/webp"
        : `image/${ext}`;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return img;
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
    if (ct.includes("aac")) return "aac";
    if (ct.includes("flac")) return "flac";
    if (ct.includes("ogg")) return "ogg";
    if (ct.includes("opus")) return "opus";
    if (ct.includes("pcm")) return "pcm";
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

// ── Voice cloning (MiniMax-compatible /audio/speech providers) ────────────
//
// generate_tts / generate_music share one speech-synthesis wire shape
// (POST {baseURL}/audio/speech). On top of preset `voice` ids, both tools
// now accept a reference audio (`clone_audio`) so each character can get
// its OWN cloned voice instead of sharing presets. Flow:
//
//   1. `voice_name` lookup in a local store (keyed by name + baseURL +
//      model id) → reuse the previously cloned voice_id, zero network.
//   2. miss: read the reference audio → POST {base}/files/upload
//      (purpose=voice_clone) → POST {base}/voice_clone {voice_id, file_id}
//      → persist { name → voice_id } for later reuse.
//   3. speak with the resolved voice_id via /audio/speech.
//
// Only MiniMax-compatible base URLs expose files/upload + voice_clone;
// providers without them fail with an actionable error (the caller can
// still fall back to a preset `voice` or a provider-side cloned voice_id).

const VOICE_STORE_MAX_BYTES = 20 * 1024 * 1024; // MiniMax file cap

/** Store path — overridable via env so tests never touch the real home. */
function voiceStorePath() {
  return process.env.DSH_LLMM_VOICE_STORE || join(homedir(), ".dsh", "llm-multimodal-voices.json");
}

async function loadVoiceStore() {
  try {
    const raw = await readFile(voiceStorePath(), "utf8");
    const doc = JSON.parse(raw);
    if (doc && typeof doc === "object" && doc.voices && typeof doc.voices === "object") return doc;
  } catch (_) {}
  return { voices: {} };
}

async function saveVoiceStore(store) {
  try {
    const p = voiceStorePath();
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(store, null, 2), "utf8");
    return true;
  } catch (_) {
    return false; // non-fatal: the clone still works for this session
  }
}

/** Keep CJK + latin alnum + underscore so角色名 (沈渊) can be a store key. */
function sanitizeVoiceName(name) {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function audioExtFromName(name) {
  const m = /\.([a-z0-9]+)(\?|$)/i.exec(name || "");
  const ext = m ? m[1].toLowerCase() : "";
  if (["mp3", "wav", "m4a", "ogg", "flac", "aac", "pcm", "opus"].includes(ext)) return ext;
  return "mp3";
}

function extFromMime(mime) {
  const m = /^audio\/([a-z0-9.+-]+)/i.exec(mime || "");
  const sub = m ? m[1].toLowerCase() : "";
  if (sub.includes("mpeg") || sub === "mp3") return "mp3";
  if (sub.includes("wav") || sub === "wave") return "wav";
  if (sub === "mp4" || sub === "m4a") return "m4a";
  if (sub.includes("ogg")) return "ogg";
  if (sub.includes("flac")) return "flac";
  if (sub === "aac") return "aac";
  if (sub.includes("opus")) return "opus";
  if (sub.includes("pcm")) return "pcm";
  return "mp3";
}

function mimeFromExt(ext) {
  switch ((ext || "mp3").toLowerCase()) {
    case "wav": return "audio/wav";
    case "m4a": return "audio/mp4";
    case "ogg": return "audio/ogg";
    case "flac": return "audio/flac";
    case "aac": return "audio/aac";
    case "pcm": return "audio/pcm";
    case "opus": return "audio/opus";
    default: return "audio/mpeg";
  }
}

/** Resolve a reference audio into { buf, ext } — data URI / URL / local path. */
async function loadAudioBuffer(cloneAudio, signal) {
  const s = String(cloneAudio || "").trim();
  if (!s) throw new Error("clone_audio 为空");
  if (/^data:audio\//i.test(s)) {
    const m = s.match(/^data:[^;,]+;base64,(.*)$/s);
    if (!m || !m[1]) throw new Error("clone_audio data URI 缺少 base64 数据");
    const mime = /^data:([^;,]+)/.exec(s)?.[1] || "";
    return { buf: Buffer.from(m[1], "base64"), ext: extFromMime(mime) };
  }
  if (/^https?:\/\//i.test(s)) {
    const r = await fetch(s, { signal });
    if (!r.ok) throw new Error("下载参考音频失败: HTTP " + r.status);
    return { buf: Buffer.from(await r.arrayBuffer()), ext: audioExtFromName(s) };
  }
  const p = s.replace(/^file:\/\//, "");
  return { buf: await readFile(p), ext: audioExtFromName(p) };
}

async function uploadVoiceFile(target, buf, ext, signal) {
  const form = new FormData();
  form.append("purpose", "voice_clone");
  form.append("file", new Blob([buf], { type: mimeFromExt(ext) }), "voice_" + Date.now() + "." + ext);
  const res = await fetch(target.baseURL.replace(/\/+$/, "") + "/files/upload", {
    method: "POST",
    headers: { "Authorization": "Bearer " + target.apiKey },
    body: form,
    signal,
  });
  const text = await res.text().catch(() => "");
  let body = {};
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  if (!res.ok) {
    const detail = body?.base_resp?.status_msg || body?.message || body?.raw || "HTTP " + res.status;
    throw new Error("上传参考音频失败 (" + res.status + "): " + detail);
  }
  const fileId = body?.file?.file_id || body?.file_id || body?.data?.file_id;
  if (!fileId) throw new Error("上传参考音频成功但响应缺少 file_id: " + JSON.stringify(body).slice(0, 200));
  return fileId;
}

async function requestVoiceClone(target, voiceId, fileId, signal) {
  const base = target.baseURL.replace(/\/+$/, "");
  const res = await fetch(base + "/voice_clone", {
    method: "POST",
    headers: { "Authorization": "Bearer " + target.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ voice_id: voiceId, file_id: fileId }),
    signal,
  });
  const text = await res.text().catch(() => "");
  let body = {};
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  if (!res.ok) {
    const detail = body?.base_resp?.status_msg || body?.message || body?.raw || "HTTP " + res.status;
    throw new Error("音色克隆请求失败 (" + res.status + "): " + detail);
  }
  const status = body?.status || body?.state || body?.base_resp?.status || "";
  if (/processing|in_progress|queued|pending|creating|running/i.test(status)) {
    // Bounded poll for providers that clone asynchronously. A provider
    // without a status endpoint (404) stops polling immediately and the
    // subsequent TTS call judges readiness.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const pr = await fetch(base + "/voice_clone/" + encodeURIComponent(voiceId), {
          headers: { "Authorization": "Bearer " + target.apiKey },
          signal,
        });
        const pt = await pr.text().catch(() => "");
        let pb = {};
        try { pb = JSON.parse(pt); } catch { pb = {}; }
        const st = pb?.status || pb?.state || "";
        if (/completed|succeeded|success|ok/i.test(st)) { body = pb; break; }
        if (/failed|error/i.test(st)) throw new Error("音色克隆失败: " + (pb?.message || pt.slice(0, 200)));
      } catch (e) {
        if (e && typeof e === "object" && /失败/.test(e.message || "")) throw e;
        break; // status endpoint unavailable — proceed and let TTS judge
      }
    }
  }
  return { voiceId, body };
}

/**
 * Resolve a voice for one speech call:
 *   - voice_name + store hit (same baseURL + model) → reuse, zero network.
 *   - else clone from clone_audio and persist under voice_name.
 * Returns `{ ok, voiceId, cloned?, reused?, message? }`.
 */
async function ensureClonedVoice({ target, voiceName, cloneVoiceId, cloneAudio, exec }) {
  const name = sanitizeVoiceName(voiceName);
  if (name) {
    const store = await loadVoiceStore();
    const hit = store.voices[name];
    if (hit && hit.baseURL === target.baseURL && hit.modelId === target.id && hit.voiceId) {
      return { ok: true, voiceId: hit.voiceId, cloned: false, reused: true };
    }
  }
  let audio;
  try {
    audio = await loadAudioBuffer(cloneAudio, exec.signal);
  } catch (e) {
    return { ok: false, message: "音色克隆失败: " + (e?.message || String(e)) };
  }
  if (audio.buf.length > VOICE_STORE_MAX_BYTES) {
    return {
      ok: false,
      message: "音色克隆失败: 参考音频超过 20MB 上限（当前 " + Math.round(audio.buf.length / 1024 / 1024) + "MB），请压缩后重试。",
    };
  }
  const voiceId = (cloneVoiceId && cloneVoiceId.trim()) ||
    "voice_clone_" + (name || "char") + "_" + Date.now().toString(36);
  try {
    const fileId = await uploadVoiceFile(target, audio.buf, audio.ext, exec.signal);
    await requestVoiceClone(target, voiceId, fileId, exec.signal);
  } catch (e) {
    return {
      ok: false,
      message: "音色克隆失败: " + (e?.message || String(e)) + "（当前 TTS 提供商需支持 MiniMax 兼容的 files/upload + voice_clone 接口，否则请改用预设 voice 或提供商侧克隆好的 voice_id）",
    };
  }
  if (name) {
    const store = await loadVoiceStore();
    store.voices[name] = { voiceId, baseURL: target.baseURL, modelId: target.id, createdAt: new Date().toISOString() };
    await saveVoiceStore(store);
  }
  return { ok: true, voiceId, cloned: true, reused: false };
}

/**
 * Shared speech-synthesis core for generate_tts / generate_music. Both
 * tools target POST {baseURL}/audio/speech; the clone resolution, wire
 * shape, file writing and result envelope live here so the two tools
 * cannot drift apart.
 */
async function executeSpeech({ kind, label, args, target, fallbackWarning, defaultVoice, exec, destInfo }) {
  const t0 = Date.now();
  const warning = fallbackWarning ? [fallbackWarning] : [];
  let voice = (args.voice && args.voice.trim()) || defaultVoice || "alloy";
  let cloned = false;
  let reused = false;
  let voiceName = (args.voice_name || "").trim();
  if (args.clone_audio) {
    const c = await ensureClonedVoice({
      target,
      voiceName: args.voice_name,
      cloneVoiceId: args.clone_voice_id,
      cloneAudio: args.clone_audio,
      exec,
    });
    if (!c.ok) return { success: false, message: c.message };
    voice = c.voiceId;
    cloned = !!c.cloned;
    reused = !!c.reused;
    if (reused) warning.push(`已复用音色 "${voiceName}"（voice_id: ${voice}），未重新克隆。`);
  }
  const outputFormat = (args.output_format || "mp3").toLowerCase();
  const body = {
    model: target.id,
    input: args.text,
    voice,
    response_format: outputFormat,
    speed: args.speed ?? 1.0,
  };
  try {
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
      return { success: false, message: (warning.length ? warning.join("\n") + "\n" : "") + label + " HTTP " + res.status + ": " + t.slice(0, 200) };
    }
    const ct = res.headers.get("content-type") || "";
    if (!ct.startsWith("audio/")) {
      const t = await res.text().catch(() => "");
      return { success: false, message: (warning.length ? warning.join("\n") + "\n" : "") + label + " 响应 content-type=" + ct + ", body: " + t.slice(0, 200) };
    }
    const ext = guessExt("audio." + outputFormat, ct);
    const fileName = `llm-multimodal-${kind}-${Date.now()}.${ext}`;
    const dest = join((destInfo && destInfo.dir) || "/tmp", fileName);
    await mkdir(dirname(dest), { recursive: true });
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
    const successMsg = cloned
      ? "音色克隆完成，音频已用克隆音色生成"
      : reused
        ? "已复用克隆音色生成音频"
        : (kind === "tts" ? "音频已生成" : "音乐已生成");
    return {
      success: true,
      url: "file://" + dest,
      assetPath: dest,
      model: target.id,
      bytes: buf.length,
      voice,
      ...(cloned || reused ? { clonedVoiceId: voice, voiceName, cloned } : {}),
      latencyMs: Date.now() - t0,
      message: (warning.length ? warning.join("\n") + "\n" : "") + successMsg,
      ...projectScopedFields(destInfo, fileName),
    };
  } catch (e) {
    return { success: false, message: (warning.length ? warning.join("\n") + "\n" : "") + label + " 失败: " + (e?.message || String(e)) };
  }
}

// ── Settings scope helper ─────────────────────────────────────────────────

/**
 * The symbol the host uses to mark a live ("volatile") configuration
 * reference. DSH 0.2.x keeps every user-owned setting in such a
 * reference and mutates it in place when the profile patch changes, so the
 * running plugin observes the new value without being re-applied.
 */
const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");

/** Whether a validated config node is a live (volatile) reference. */
function isVolatileRef(value) {
  return !!value && typeof value === "object" && VOLATILE_WRITE in value;
}

/**
 * Unwrap live references into plain values.
 *
 * Volatile leaves arrive as reference objects (`{ get() }`) rather than the
 * value itself; ordinary leaves are plain. Reading through `get()` at call
 * time is what makes a settings edit take effect on the next tool call.
 */
function unwrapVolatile(value) {
  if (isVolatileRef(value)) return unwrapVolatile(value.get());
  if (Array.isArray(value)) return value.map(unwrapVolatile);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = unwrapVolatile(child);
    return out;
  }
  return value;
}

/**
 * Expose the plugin's validated config through the tiny `get()` surface the
 * settings helpers already consume. Reads are live: every call unwraps the
 * current reference values.
 */
function createConfigScope(config) {
  return {
    get() {
      if (!config) return { ...DEFAULT_LLM_MULTIMODAL };
      return { ...DEFAULT_LLM_MULTIMODAL, ...unwrapVolatile(config) };
    },
  };
}

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
 * Output directory for generated media. Empty → /tmp (legacy default);
 * otherwise `~` is expanded and the callers' mkdir creates it lazily.
 * Configure it (e.g. to the media-studio workspaceRoot/web-jobs or a
 * project folder under mediaRoots) so produced files live in a persistent,
 * proxy-servable location instead of a temp dir.
 */
function resolveOutputDir(scope) {
  if (!scope) return "/tmp";
  try {
    const v = scope.get();
    const raw = (v && v.outputDir) || "";
    const trimmed = String(raw).trim();
    if (!trimmed) return "/tmp";
    return trimmed.startsWith("~") ? join(homedir(), trimmed.slice(1)) : trimmed;
  } catch (_) {
    return "/tmp";
  }
}

// ── Cross-plugin output routing (media-studio active project) ────────────
//
// When the media-studio plugin is loaded in the same DSH process it
// publishes a `mediaStudio` service (ctx.reflect.provide). The default
// outputStrategy ("project") routes generated media straight into the
// ACTIVE project's asset tree (<sourcePath>/assets/<kind>/) so a canvas
// node's resultUrl can point at a proxy-servable project path without a
// second copy step. Everything below degrades to the legacy `outputDir`
// (empty → /tmp) when the service or the active project is missing.

/** media-studio asset category → directory name (mirrors its ASSET_CATEGORY_DIR). */
export const MEDIA_STUDIO_CATEGORY_DIR = {
  character: "characters",
  scene: "scenes",
  audio: "audio",
  clip: "clips",
};

/** Soft cross-plugin lookup — media-studio publishes `mediaStudio` via
 *  ctx.reflect.provide; the reference is absent when that plugin isn't
 *  loaded (headless profiles, unit tests) or its fiber is inactive.
 *  Never throws: a lookup failure just means "fall back to outputDir". */
export function getMediaStudioService(ctx) {
  try {
    if (ctx && typeof ctx.get === "function") {
      const svc = ctx.get("mediaStudio");
      if (svc && typeof svc.resolveAssetDir === "function" && typeof svc.getActiveProjectId === "function") return svc;
    }
    if (ctx && ctx.reflect && typeof ctx.reflect.get === "function") {
      const svc = ctx.reflect.get("mediaStudio");
      if (svc && typeof svc.resolveAssetDir === "function" && typeof svc.getActiveProjectId === "function") return svc;
    }
  } catch (_) { /* fall through */ }
  return null;
}

/** Effective output strategy: "project" (default) or "outputDir" (legacy). */
export function resolveOutputStrategy(scope) {
  try {
    const v = scope ? scope.get() : null;
    const raw = String((v && v.outputStrategy) || "").trim().toLowerCase();
    if (raw === "outputdir" || raw === "output-dir" || raw === "web-jobs" || raw === "legacy") return "outputDir";
  } catch (_) { /* keep the default */ }
  return "project";
}

/**
 * Resolve where the next generated media file lands.
 *
 * kind: "image" | "video" | "audio" → media-studio asset category:
 * image → character (matching media-studio's own image-node default,
 * overridable via the generate_image `asset_kind` parameter),
 * video → clip, audio → audio.
 *
 * Returns `{ dir, projectId, category, projectScoped }`:
 *   projectScoped=true  → dir is the active project's
 *                         <sourcePath>/assets/<catDir>; callers build
 *                         canvasUrl via projectScopedFields().
 *   projectScoped=false → dir is the configured outputDir (or /tmp).
 */
export function resolveMediaDestination(ctx, scope, kind, categoryOverride) {
  const category =
    categoryOverride ||
    (kind === "video" ? "clip" : kind === "audio" ? "audio" : "character");
  if (resolveOutputStrategy(scope) === "project") {
    const studio = getMediaStudioService(ctx);
    if (studio) {
      const dir = studio.resolveAssetDir(undefined, category);
      const projectId = studio.getActiveProjectId();
      if (dir && projectId) {
        return { dir, projectId, category, projectScoped: true };
      }
      // No active project / unknown category → fall through to outputDir.
    }
  }
  return { dir: resolveOutputDir(scope), projectId: null, category: null, projectScoped: false };
}

/** Project-scoped response fields for a file written into a media-studio
 *  project's asset tree (empty object otherwise). `canvasUrl` is the
 *  project-relative path a canvas node's data.resultUrl should carry so
 *  the media proxy serves it directly — no copy step, no expiring CDN
 *  URL, nothing parked under ~/.media-studio. */
export function projectScopedFields(destInfo, fileName) {
  if (!destInfo || !destInfo.projectScoped || !fileName) return {};
  const catDir = MEDIA_STUDIO_CATEGORY_DIR[destInfo.category] || "misc";
  return {
    projectId: destInfo.projectId,
    assetKind: destInfo.category,
    canvasUrl: `projects/${destInfo.projectId}/assets/${catDir}/${fileName}`,
  };
}

/**
 * Merge a modality override on top of an auto-discovered model row. The
 * override's `baseURL` / `apiKey` / `apiKeyEnv` replace the discovered ones
 * when non-empty. `defaultModel` is applied ONLY when the override also
 * pins a different `provider` (i.e. the user is explicitly routing through
 * a different provider's preset). When the caller picked a discovered
 * model directly via `args.model`, the picked `id` is preserved — the
 * override is allowed to swap auth / protocol / baseURL but NOT silently
 * rewrite a model the user already chose.
 */
function applyOverride(model, override, opts = {}) {
  if (!model) return null;
  if (!override || Object.keys(override).length === 0) return model;
  // Only the settings card, when the user explicitly edits
  // `defaultModel`, is allowed to rewrite `id`. Auto-pick (`!args.model`)
  // passes overrideId=true so the saved preset is honoured; per-call
  // `args.model` passes overrideId=false so a user-chosen model survives
  // the merge. We deliberately do NOT infer "provider switch" from a
  // provider-string mismatch — that would silently rewrite a user-selected
  // `local-flux` to the preset `agnes-image-2.5-flash` even though the
  // user never asked to switch providers.
  const overrideId = opts.overrideId === true;
  const baseURL = override.baseURL?.trim() || model.baseURL;
  const apiKey = override.apiKey?.trim() || model.apiKey;
  const defaultModel = overrideId ? (override.defaultModel?.trim() || model.id) : model.id;
  const apiKeyEnv = override.provider ? "" : model.apiKeyEnv;
  const provider = override.provider?.trim() || model.provider;
  const apiProtocol = override.apiProtocol?.trim() || model.apiProtocol;
  return { ...model, baseURL, apiKey, apiKeyEnv, id: defaultModel, provider, apiProtocol };
}

/**
 * Build a usable model row out of the settings card alone.
 *
 * `applyOverride()` returns `null` for an empty pool, so a preset saved in
 * 设置 → 插件 → llm-multimodal was silently useless whenever discovery found
 * no model with that modality (0.3 shipped with `vision: {}` and empty
 * tts/music pools for exactly this reason). Rebuilding the row from the
 * user's own provider/baseURL/apiKey/defaultModel keeps that escape hatch
 * working while the resolver's evidence is incomplete.
 */
function modelFromOverride(override, modality) {
  if (!override) return null;
  const id = (override.defaultModel || "").trim();
  if (!id) return null;
  return {
    provider: (override.provider || "").trim() || "custom",
    id,
    name: id,
    type: modality,
    modalities: [modality],
    primary: modality,
    confidence: 1,
    sources: [{ level: "override", detail: "settings.defaultModel" }],
    baseURL: (override.baseURL || "").trim(),
    apiKey: (override.apiKey || "").trim(),
    apiKeyEnv: "",
    apiProtocol: (override.apiProtocol || "").trim() || "openai",
  };
}

/**
 * The multimodal tools only speak the OpenAI protocol
 * (OpenAI-compatible REST endpoints: /images/generations, /videos,
 * /audio/speech, ...). `apiProtocol` empty or "openai" is accepted;
 * anything else (claude, gemini, ...) is rejected before any call.
 */
function isOpenAIProtocol(target) {
  const p = ((target && target.apiProtocol) || "").trim().toLowerCase();
  return !p || p === "openai";
}

/**
 * "claude-fable-5 is served on POST /v1/messages" — a mixed gateway that
 * exposes a whole family on its native route instead of /chat/completions.
 * The capability verdict was right; the transport is the problem, so the
 * message says what can actually be done about it.
 */
function nativeRouteHint(target, rawMsg) {
  const text = String(rawMsg || "");
  if (!/is served on\s+(?:post|put|get)\s+\//i.test(text)) return null;
  return [
    `${target.id} 在该网关走的是原生端点，没有通过 OpenAI 兼容的 /chat/completions 暴露（原文: ${text}）。`,
    `能力判定没问题，问题出在传输协议。可选:`,
    `  • 换同 provider 下、走 /chat/completions 的同模态模型`,
    `  • 或为该模型单独建一个 provider，baseURL 指向其原生兼容入口、apiProtocol 设为 openai`,
  ].join("\n");
}

function protocolGuardError(target, label, fallbackWarning) {
  return `${fallbackWarning ? fallbackWarning + "\n" : ""}${label}模型 ${target.id} 的 apiProtocol="${target.apiProtocol || ""}" 不是 OpenAI 协议：本插件只调用 OpenAI 兼容端点（/images/generations、/videos、/audio/speech 等）。请在 llm-pi-ai 的 provider 配置中去掉 apiProtocol 或设为 openai。`;
}

// ── Polling helper ───────────────────────────────────────────────────────

async function pollForVideo(taskId, retrieve) {
  const POLL_INTERVAL_MS = 5_000;
  const MAX_POLLS = 120;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const { ok, body } = await retrieve(taskId, 90_000);
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
  throw new Error("视频生成超时 (10 分钟内未完成)");
}

/**
 * Download a provider-returned video URL into the configured outputDir and
 * return a local `file://` URL — the same persistence image/TTS already do.
 *
 * Upstream video endpoints (Agnes / Sora / …) hand back a CDN URL that is
 * typically only valid for ~7 days, so a canvas node fed that raw URL would
 * point at an expiring remote file. Mirroring generate_image's behaviour,
 * we fetch the bytes into `{outputDir}/llm-multimodal-<ts>-<rand>.mp4` and
 * surface `url = file://…`. The original CDN link stays available as
 * `sourceUrl` for follow-up I2I/I2V chaining.
 *
 * Download failure is non-fatal: we fall back to the remote URL and attach
 * a `downloadWarning` so callers still get the video (degraded, expiring).
 */
async function localizeVideoUrl(ctx, url, scope, signal) {
  if (!url) return { url, downloadWarning: undefined };
  // data: / file: URLs are already local or inline — nothing to fetch.
  if (!/^https?:\/\//i.test(url)) return { url, downloadWarning: undefined };
  const destInfo = resolveMediaDestination(ctx, scope, "video");
  const fileName = `llm-multimodal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${guessExt(url, "video/mp4")}`;
  try {
    const dest = join(destInfo.dir, fileName);
    const bytes = await downloadTo(url, dest, signal);
    // When we wrote into the project's source tree, surface the
    // project-relative `projects/<pid>/assets/clips/<file>` URL as the
    // canonical `url` so the canvas card is wired to the media-file proxy
    // (the proxy rewrites it back to <sourcePath>/assets/clips/<file> on
    // read). The `file://` form is also kept in `assetPath` for callers
    // that need a direct on-disk path. Without this, callers downstream
    // (notably `media-studio`'s `prepareVideoForCanvas`) get a `file://`
    // URL that they have to copy and rename to land a stable v-<id>.mp4 —
    // if their local-download helper forgets to strip `file://`, the
    // canvas card ends up pointing at the raw CDN-flavoured filename
    // with no cover, and the user sees a "streaming video" card.
    const publicUrl = destInfo && destInfo.projectScoped && destInfo.projectId
      ? `projects/${destInfo.projectId}/assets/${MEDIA_STUDIO_CATEGORY_DIR[destInfo.category] || "clips"}/${fileName}`
      : `file://${dest}`;
    return { url: publicUrl, assetPath: dest, bytes, downloadWarning: undefined, destInfo, fileName };
  } catch (e) {
    return {
      url,
      downloadWarning: "视频已生成，但本地落盘失败（" + (e?.message || String(e))
        + "）。已退回远程 CDN 链接，该链接会过期，请尽快转存。",
    };
  }
}

// ── Plugin apply ──────────────────────────────────────────────────────────

export async function apply(ctx, config) {
  const tools = ctx.tools;
  const credentials = ctx.credentials;
  const settings = ctx.settings;

  // Locate the profile patch that carries the `llm-pi-ai` provider rows.
  // The desktop app exposes no DSH_PROFILE_DIR, but its own config editor
  // service knows the exact file it edits.
  try {
    const lookup = (name) => (typeof ctx.get === "function" ? ctx.get(name) : ctx[name]);
    const editor = lookup("configEditor");
    const profile = lookup("profileContext");
    const patch = editor?.documentPath || (profile?.dir ? join(profile.dir, "cordis.patch.yml") : "");
    if (patch) setProfilePatchPath(patch);
  } catch (_) {}

  // Settings values live in the plugin's own `Config` schema (DSH 0.2.x).
  // The host validates the profile entry's config against it and hands the
  // result to `apply(ctx, config)`; the volatile leaves are live references,
  // so `createConfigScope` reads the user's CURRENT choice on every call.
  let scope = createConfigScope(config);
  // Hosts older than 0.2.x exposed `settings.register(ns, schema)` instead;
  // keep that path working when it is there.
  if (settings && typeof settings.register === "function") {
    try {
      scope = settings.register(NS, LlmMultimodalSettings) || scope;
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
    try { attachHttpRoutes(ctx, getScope) } catch (_) {}
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
        // additionalProperties: true so error paths can include
        // `{success:false, message, warning}` without crashing the host's
        // schema validator (which previously surfaced a meta-error
        // "value.success is not a declared property" instead of the real
        // model-discovery / prepareCall / stream failure).
        additionalProperties: true,
        properties: {
          success: { type: "boolean" },
          text: { type: "string" },
          model: { type: "string" },
          message: { type: "string" },
          warning: { type: "string" },
          usage: {
            type: "object",
            additionalProperties: true,
            properties: {
              inputTokens: { type: "number" },
              outputTokens: { type: "number" },
            },
          },
          latencyMs: { type: "number" },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: value?.success === false
          ? (value?.message || JSON.stringify(value))
          : ((value?.text) || "(empty response)"),
      }],
    },
    async execute(args, exec) {
      const llm = ctx.llm;
      const hasStream = !!llm && typeof llm.stream === "function";
      if (!llm || (!hasStream && typeof llm.prepareCall !== "function")) {
        return { success: false, message: "dsh-llm-multimodal: ctx.llm is not bound — the harness is running without an LLM adapter." };
      }

      const models = await discoverModels(credentials);
      const textMods = models.filter((m) => hasModality(m, "text"));
      const pick = resolveTextModel(textMods, args.model);
      if (!pick.model) {
        // 0.4 never substitutes a different model: an unknown id is an error
        // that names the candidates, so a typo cannot quietly become
        // "some other provider's chat model" mid-conversation.
        return {
          success: false,
          message: missingModelMessage("文本", "text", pick.requestedButMissing ? args.model : "", models),
        };
      }
      const provider = pick.provider;
      const model = pick.model;
      const fallbackWarning = "";

      // Text requests go through the harness `llm` service, which resolves
      // each provider's credentials itself. Only fail early when the
      // provider EXPLICITLY declares an `apiKeyEnv` that resolves to
      // nothing — the adapter would then fail anyway, with a poorer hint.
      const pickedRow = textMods.find(m => m.provider === provider && m.id === model);
      if (pickedRow && pickedRow.apiKeyEnv && !pickedRow.apiKey) {
        return {
          success: false,
          message: `${fallbackWarning ? fallbackWarning + "\n" : ""}文本模型 ${model} 已自动发现，但 ${pickedRow.apiKeyEnv} 环境变量未设置。`,
        };
      }

      const t0 = Date.now();
      const MessageId = (id) => id;
      const messages = [{
        id: MessageId("llm-multimodal:" + Date.now().toString(36) + ":" + Math.random().toString(36).slice(2, 8)),
        role: "user",
        content: [{ type: "text", text: args.system ? args.system + "\n\n" + args.prompt : args.prompt }],
        source: { kind: "user" },
      }];
      let text = "";
      let usage = { inputTokens: 0, outputTokens: 0 };
      const consume = async (stream) => {
        for await (const chunk of stream) {
          if (chunk?.type === "text-delta") text += chunk.text || "";
          else if (chunk?.type === "usage") usage = { inputTokens: chunk.usage?.inputTokens || 0, outputTokens: chunk.usage?.outputTokens || 0 };
        }
      };
      try {
        if (hasStream) {
          // DSH >= 0.2: the llm service takes the whole request
          // (`{ provider, model, messages, maxTokens, signal }`) and the
          // adapter resolves credentials + call config itself.
          await consume(llm.stream({ provider, model, maxTokens: 4096, messages, signal: exec.signal }));
        } else {
          // DSH <= 0.1 contract: prepareCall(config, signal) returns the
          // resolved config, and prep.stream(options) must be passed that
          // config field-equal (see callConfigEquals in dsh-llm — it
          // compares provider / model / reasoningEffort / temperature /
          // maxTokens / stop).
          const prep = await llm.prepareCall({ provider, model, maxTokens: 4096 }, exec.signal);
          await consume(prep.stream({ ...prep.config, messages, signal: exec.signal }));
        }
      } catch (e) {
        return { success: false, message: (fallbackWarning ? fallbackWarning + "\n" : "") + "text stream 失败: " + (e?.message || String(e)) };
      }
      return {
        success: true,
        text,
        model: `${provider}/${model}`,
        usage,
        latencyMs: Date.now() - t0,
        ...(fallbackWarning ? { warning: fallbackWarning } : {}),
      };
    },
  }));

  // ── generate_image ─────────────────────────────────────────────────────

  tools.register(defineTool({
    name: "generate_image",
    description:
      "Generate an image. Supports text-to-image (T2I) and image-to-image (I2I): pass `image` (URL or base64 data URI) for I2I, or an array for multi-image composition. Provider dispatch: Agnes-style backends expect `image`/`response_format` under `extra_body` (returns 'team not allowed' otherwise); strict OpenAI provider rejects I2I on /images/generations with an actionable error. Models are auto-discovered from `llm-pi-ai` (model id containing image / dall / flux / imagen / sdxl / midjourney). Use `model` to override; blank → first discovered image model. Output routing: with the media-studio plugin active (default outputStrategy=project) the file is written straight into the ACTIVE project's asset tree and the result carries projectId + canvasUrl (use canvasUrl as a canvas node's data.resultUrl); otherwise it lands in the configured outputDir (default /tmp).",
    parameters: {
      prompt: { type: "string", required: true, description: "Image prompt or edit instruction for I2I." },
      model: { type: "string", description: "Optional model id override (e.g. agnes-image-2.1-flash)." },
      size: { type: "string", description: "Image size, e.g. 1024x1024 / 1792x1024 / 1024x1792.", default: "1024x1024" },
      n: { type: "integer", description: "Number of images to generate.", default: 1 },
      image: { type: "array", description: "Input image(s) for image-to-image (I2I) or multi-image composition. Supports public image URLs, Data URI Base64, `file://` paths, or absolute paths on disk (the plugin auto-converts local files to data URIs before sending to the provider). Pass one image for standard I2I, multiple for composition." },
      asset_kind: { type: "string", enum: ["character", "scene", "audio", "clip"], description: "media-studio asset category for the output file when writing into the active project (default outputStrategy=project). Defaults to character (the same default media-studio uses for image nodes); use scene for backgrounds/environments. Ignored when the file falls back to outputDir." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          success: { type: "boolean" },
          url: { type: "string" },
          assetPath: { type: "string", description: "Absolute local path where the generated file was written." },
          model: { type: "string" },
          bytes: { type: "number" },
          latencyMs: { type: "number" },
          message: { type: "string" },
          sourceUrl: { type: "string", description: "Upstream CDN URL (when provider returns one); valid ~7 days, suitable for I2I/I2V chaining." },
          b64: { type: "string", description: "Raw base64 PNG when provider returns b64_json; no file copy needed for follow-up calls." },
          projectId: { type: "string", description: "media-studio project id when the file landed in the active project's asset tree (outputStrategy=project)." },
          assetKind: { type: "string", description: "Asset category the file was written into: character | scene | audio | clip." },
          canvasUrl: { type: "string", description: "Project-relative path (projects/<id>/assets/<cat>/<file>) to use as a canvas node's data.resultUrl — the media proxy serves it directly." },
        },
      },
      render: (_args, value) => renderJsonSummary(value),
    },
    async execute(args, exec) {
      const models = await discoverModels(credentials);
      const override = readModalityOverride(getScope(), "image");
      const pick = pickForTool(models, "image", args.model);
      // When the user explicitly named a model and we matched it exactly,
      // do NOT let the modality override silently swap to its
      // `defaultModel` — that was the root cause of "I passed agnes-image-2.1-flash
      // and the request still hit agnes-image-2.5-flash". Auto-pick
      // (no args.model) respects the override's defaultModel.
      let target =
        applyOverride(pick.model, override, { overrideId: !args.model }) ||
        // Empty pool: fall back to the preset the user saved in settings.
        (args.model ? null : modelFromOverride(override, "image"));
      if (!target) {
        return {
          success: false,
          message: missingModelMessage("图像", "image", pick.requestedButMissing ? args.model : "", models),
        };
      }
      const fallbackWarning = pick.requestedButMissing ? buildFallbackMessage("图像", args.model, target) : "";
      if (!target.apiKey) {
        return {
          success: false,
          message: `${fallbackWarning ? fallbackWarning + "\n" : ""}模型 ${target.id} 未配置 apiKey（${target.apiKeyEnv || "API_KEY"} 环境变量）。`,
        };
      }
      if (!isOpenAIProtocol(target)) {
        return { success: false, message: protocolGuardError(target, "图像", fallbackWarning) };
      }
      try {
        const client = createClient(target.baseURL, target.apiKey, target.id);
        const t0 = Date.now();

        // Build request body
        const imgBody = {
          model: target.id,
          prompt: args.prompt,
          n: args.n || 1,
          size: args.size || "1024x1024",
        };

        // Image-to-image + multi-image composition.
        //
        // Provider dispatch (decided by detected baseURL / apiProtocol):
        //
        //   • OpenAI official (/v1/images/generations): does NOT accept
        //     `image`; I2I must go to /images/edits or /images/variations.
        //     For T2I we leave body untouched and `response_format`
        //     stays on the top level — that's the canonical OpenAI shape.
        //
        //   • Agnes-style / 3rd-party compatible: accepts I2I via
        //     `extra_body.image` (array of URL or Data URI) and
        //     `extra_body.response_format`. Putting `image` on the top
        //     level makes Agnes return
        //     "team not allowed to access model" — see the Agnes image
        //     docs: 图生图需要在 extra_body.image 中提供输入图像。
        const isAgnesStyle = /agnes-?ai\.com|apihub\.agnes/i.test(target.baseURL || "")
          || (target.apiProtocol || "").toLowerCase() === "agnes";
        const i2iImages = []
          .concat(
            Array.isArray(args.image) ? args.image : [],
            (typeof args.image === 'string' && args.image.trim()) ? [args.image] : [],
          )
          .filter(Boolean);

        if (i2iImages.length > 0) {
          if (isAgnesStyle) {
            // Auto-convert file:// / absolute-path inputs to data URIs so
            // the upstream provider (which rejects `file://`) accepts them.
            // No-op for already-public URLs and data URIs.
            const adapted = await Promise.all(i2iImages.map(adaptImageInput));
            // Agnes: image + response_format both go under extra_body.
            imgBody.extra_body = {
              ...(imgBody.extra_body || {}),
              image: adapted,
              response_format: "url",
            };
          } else {
            // Strict OpenAI: refuse I2I via /generations — caller must
            // use the dedicated edits/variations endpoints. We surface
            // an actionable error rather than silently dropping the
            // images, which is what the previous implementation did.
            return {
              success: false,
              message: "当前 provider (" + target.provider + ") 是 OpenAI 官方协议，" +
                "/v1/images/generations 不支持 image-to-image。" +
                "请改用支持 I2I 的 provider（如 Agnes），或先调用 /images/edits 走编辑流程。",
            };
          }
        }

        const { ok, body } = await client.images.generate(imgBody);
        if (!ok) {
          const rawMsg = body?.error?.message || JSON.stringify(body).slice(0, 200);
          const m = (rawMsg || "").toLowerCase();
          let friendly = nativeRouteHint(target, rawMsg);
          if (!friendly && /team not allowed|cannot access model/.test(m) && i2iImages.length > 0) {
            // The classic Agnes quirk: top-level `image` field bypasses the
            // model's allow-list. Make sure the fix actually engaged.
            friendly = [
              `图像生成失败: 当前 model=${target.id} 不支持 I2I（"team not allowed to access model"）。`,
              `常见原因:`,
              `  • model id 写错（注意大小写）`,
              `  • provider 把 image 字段放到了顶层而非 extra_body（已自动检测并修正，请确认 baseURL 命中 Agnes）`,
              `  • 该模型只支持 T2I；改用纯 prompt 不带 image 重试`,
            ].join("\n");
          } else if (!friendly && /extra_body|image field|invalid request/.test(m) && i2iImages.length > 0 && isAgnesStyle) {
            friendly = [
              `图像生成失败: Agnes 拒绝了 I2I 请求体。`,
              `工具已把 image 放到 extra_body.image — 如果仍然失败，请确认:`,
              `  • input image 是 HTTPS 公网 URL 或 data:image/...;base64,... 形式（不是 file://）`,
              `  • size 参数为 OpenAI 风格 "1024x1024" 或 Agnes 风格 "1K"/"2K"/"1024x768" 均可`,
            ].join("\n");
          }
          return {
            success: false,
            message: (fallbackWarning ? fallbackWarning + "\n" : "")
              + (friendly || ("图像生成失败: " + rawMsg)),
          };
        }
        const media = extractFirstMedia(body);
        if (!media) return { success: false, message: "图像生成失败: 响应无 url/base64。" };
        // Output routing: default strategy writes into the ACTIVE media-studio
        // project's asset tree (<sourcePath>/assets/<kind>/); args.asset_kind
        // picks the category (default "character", matching media-studio's
        // image-node default). Falls back to outputDir when the service or
        // active project is unavailable.
        const destInfo = resolveMediaDestination(ctx, getScope(), "image", args.asset_kind);
        if (media.b64) {
          // b64 fallback path — write to a file and return file URL
          const fileName = `llm-multimodal-${Date.now()}.png`;
          const dest = join(destInfo.dir, fileName);
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, Buffer.from(media.b64, "base64"));
          return {
            success: true,
            url: "file://" + dest,
            assetPath: dest,
            // Also surface the raw bytes so the caller can re-feed this
            // image into a follow-up generate_image(I2I) / generate_video
            // call without first having to round-trip through a file URL.
            b64: media.b64,
            model: target.id,
            latencyMs: Date.now() - t0,
            message: fallbackWarning ? fallbackWarning + "\n图像已生成" : "图像已生成",
            ...projectScopedFields(destInfo, fileName),
          };
        }
        const ext = guessExt(media.url);
        const fileName = `llm-multimodal-${Date.now()}.${ext}`;
        const dest = join(destInfo.dir, fileName);
        const bytes = await downloadTo(media.url, dest, exec.signal);
        return {
          success: true,
          url: "file://" + dest,
          assetPath: dest,
          // Keep the upstream CDN URL around so callers can feed it
          // straight into I2I / I2V follow-ups (the CDN link is typically
          // valid for ~7 days before the provider rotates it).
          sourceUrl: media.url,
          model: target.id,
          bytes,
          latencyMs: Date.now() - t0,
          message: fallbackWarning ? fallbackWarning + "\n图像已生成" : "图像已生成",
          ...projectScopedFields(destInfo, fileName),
        };
      } catch (e) {
        return { success: false, message: (fallbackWarning ? fallbackWarning + "\n" : "") + "图像生成失败: " + (e?.message || String(e)) };
      }
    },
  }));

  // ── generate_video ─────────────────────────────────────────────────────

  tools.register(defineTool({
    name: "generate_video",
    description:
      "Generate a short video. Submit+poll, may block 30–90s. Supports text-to-video, image-to-video (pass `image`), and keyframe animation (pass `keyframes` array — first/last become first_frame/last_frame on the provider). Provider-native dispatch: Agnes maps `image`→first_frame + mode=keyframe; OpenAI Sora maps `image`→input_reference. Mode values accepted and translated: `ti2vid`/`text`→text, `keyframes`/`keyframe`→keyframe, `reference`→reference. `num_frames` / `frame_rate` are no longer accepted — provider picks the frame count. Output routing: with the media-studio plugin active (default outputStrategy=project) the clip is written into the ACTIVE project's assets/clips/ and the result carries projectId + canvasUrl; otherwise it lands in the configured outputDir (default /tmp).",
    parameters: {
      prompt: { type: "string", required: true, description: "Video scene description." },
      model: { type: "string", description: "Optional model id override (e.g. agnes-video-2.5-flash, agnes-video-v2.0)." },
      duration: { type: "integer", description: "Duration (seconds). Default 5. Provider-accepted range: 4–12 for Agnes 2.5 Flash.", default: 5 },
      size: { type: "string", description: "Video size. OpenAI: pixel format `1280x720`. Agnes 2.5 Flash: tier `720P`. Pixel sizes are auto-normalised to provider default for non-OpenAI providers.", default: "720P" },
      image: { type: "string", description: "Image URL for image-to-video (I2V). Supports public image URLs, Data URI Base64, `file://` paths, or absolute paths on disk (the plugin auto-converts local files to data URIs before sending to the provider)." },
      mode: { type: "string", description: "Generation mode: 'ti2vid' or 'text' (text-to-video), 'keyframe' or 'keyframes' (image-to-video / first-frame / first+last-frame), or 'reference' (image-array reference). Translated to provider-native values internally." },
      negative_prompt: { type: "string", description: "Negative prompt describing content to avoid." },
      keyframes: { type: "array", description: "Array of image URLs for keyframe animation mode. First URL → first_frame, last URL → last_frame (Agnes keyframe mode). With mode='reference', the whole array is passed as `images[]`. Supports public URLs, Data URI Base64, `file://` paths, or absolute paths on disk." },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => renderJsonSummary(value),
    },
    async execute(args, exec) {
      const models = await discoverModels(credentials);
      const override = readModalityOverride(getScope(), "video");
      const pick = pickForTool(models, "video", args.model);
      let target =
        applyOverride(pick.model, override, { overrideId: !args.model }) ||
        (args.model ? null : modelFromOverride(override, "video"));
      if (!target) {
        return {
          success: false,
          message: missingModelMessage("视频", "video", pick.requestedButMissing ? args.model : "", models),
        };
      }
      const fallbackWarning = pick.requestedButMissing ? buildFallbackMessage("视频", args.model, target) : "";
      if (!target.apiKey) {
        return {
          success: false,
          message: `${fallbackWarning ? fallbackWarning + "\n" : ""}模型 ${target.id} 未配置 apiKey（${target.apiKeyEnv || "API_KEY"} 环境变量）。`,
        };
      }
      if (!isOpenAIProtocol(target)) {
        return { success: false, message: protocolGuardError(target, "视频", fallbackWarning) };
      }

      const client = createClient(target.baseURL, target.apiKey, target.id);

      // Provider dispatch for video body shape.
      //
      //  • OpenAI Sora (deprecated 2026-09-24): body uses
      //      `prompt, model, seconds, size, input_reference` — no `mode`,
      //      no `first_frame`, no `keyframes`.
      //  • Agnes: body uses `prompt, model, seconds, size, mode, first_frame,
      //      last_frame, images[], audios[], aspect_ratio, negative_prompt`.
      //      `mode` must be one of `text` / `keyframe` / `reference`.
      //      The old tool description claimed `'ti2vid' | 'keyframes'` —
      //      `ti2vid` is the OpenAI Sora 2 alpha name and Agnes rejects
      //      it with `invalid mode`; `keyframes` (plural) is not an Agnes
      //      mode — the correct value is the singular `keyframe`.
      //
      // We translate the tool's args into the provider-native shape here.
      const isAgnesStyle = /agnes-?ai\.com|apihub\.agnes/i.test(target.baseURL || "")
        || (target.apiProtocol || "").toLowerCase() === "agnes";
      const isAgnesFlash = /agnes-video-2\.5-flash/i.test(target.id || "");

      // Translate user-facing mode (legacy / OpenAI-shaped) to the provider's
      // native value. Acceptable user inputs now: undefined (auto),
      // "ti2vid", "text", "keyframe", "keyframes", "reference".
      function translateVideoMode(raw, map = { TXT_MODE: "text", KF_MODE: "keyframe", REF_MODE: "reference" }) {
        const m = (raw || "").toString().trim().toLowerCase();
        if (!m) return undefined; // auto-pick below
        if (m === "ti2vid" || m === "text") return map.TXT_MODE;
        if (m === "keyframe" || m === "keyframes") return map.KF_MODE;
        if (m === "reference" || m === "i2v") return map.REF_MODE;
        return m; // pass through (provider will validate)
      }

      const wantI2V = !!args.image;
      const keyframesArr = Array.isArray(args.keyframes) ? args.keyframes.filter(Boolean) : [];
      const wantKeyframes = keyframesArr.length > 0;

      // Agnes has two mode vocabularies:
      //   agnes-video-2.5-flash (newer): "text" / "keyframe" / "reference"
      //   agnes-video-v2.0 / v2.x (legacy): "ti2vid" / "keyframes" / "multi_reference"
      // Auto-detect from target.id so users do not have to know which
      // vocabulary the provider speaks on a given call.
      const isAgnesLegacy = isAgnesStyle && !isAgnesFlash
        && /^agnes-video-v?2(\.0)?$/i.test(target.id || "");
      const KF_MODE = isAgnesLegacy ? "keyframes" : "keyframe";
      const TXT_MODE = isAgnesLegacy ? "ti2vid" : "text";
      const REF_MODE = isAgnesLegacy ? "multi_reference" : "reference";

      // Determine provider-native mode:
      //   keyframes > I2V > text (default)
      let providerMode;
      if (wantKeyframes) providerMode = KF_MODE;
      else if (wantI2V) providerMode = KF_MODE; // I2V in Agnes = keyframe + first_frame
      else providerMode = translateVideoMode(args.mode, { TXT_MODE, KF_MODE, REF_MODE }) || TXT_MODE;

      // Aggressive size-format cleanup: Agnes wants `720P` for 2.5-flash,
      // OpenAI wants pixel dimensions like `1280x720`. The createClient
      // already maps the default size for agnes-video-2.5-flash; users
      // who pass pixel sizes on Agnes see "forbidden field" errors —
      // strip those for Agnes style.
      function agnesVideoSize(providerDefault, raw) {
        if (!isAgnesStyle) return raw;
        if (!raw) return providerDefault || "720P";
        // pixel-size strings like "1280x720" / "1024x768" → map to a tier
        if (/^\d{3,4}x\d{3,4}$/.test(raw)) return providerDefault || "720P";
        // tier tokens like 720P / 1080P pass through
        if (/^\d{3,4}P$/i.test(raw)) return raw.toUpperCase();
        return providerDefault || "720P";
      }

      const agnesBody = {
        model: target.id,
        prompt: args.prompt,
        seconds: String(args.duration || 5),
        size: agnesVideoSize("720P", args.size || "720P"),
      };

      if (providerMode) agnesBody.mode = providerMode;

      // I2V (single image argument) — Agnes's keyframes mode rejects
      // `first_frame` as a standalone field; it requires `image` to be a
      // list of at least 2 images. Duplicate the single image as both
      // first and last so the provider's schema check passes; the model
      // still uses it as a starting frame for motion.
      if (wantI2V) {
        const single = await adaptImageInput(args.image);
        agnesBody.image = [single, single];
      }

      // Multi-keyframe: keyframes[0] → first_frame, keyframes[N-1] → last_frame.
      // Agnes's keyframes mode rejects `first_frame` + `last_frame` as
      // separate fields; it expects `image` to be a list of at least 2
      // images (first + last). Collapse the array to its two endpoints
      // and send them under the `image` key.
      if (wantKeyframes) {
        const firstImg = await adaptImageInput(keyframesArr[0]);
        const lastImg = keyframesArr.length >= 2
          ? await adaptImageInput(keyframesArr[keyframesArr.length - 1])
          : firstImg;
        agnesBody.image = [firstImg, lastImg];
        // explicit reference-mode support: caller asked for `mode=reference`
        if ((args.mode || "").toLowerCase() === "reference") {
          agnesBody.mode = REF_MODE;
          agnesBody.images = keyframesArr;
        }
      }

      // Negative prompt (Agnes accepts it; harmless if provider ignores)
      if (args.negative_prompt) agnesBody.negative_prompt = args.negative_prompt;

      const openAIBody = { model: target.id, prompt: args.prompt, duration: args.duration || 5, size: args.size || "1280x720" };
      if (args.image) openAIBody.input_reference = args.image;
      const okMsg = (msg) => fallbackWarning ? fallbackWarning + "\n" + msg : msg;

      // Translate provider-native error messages into actionable hints
      // for the most common user mistakes. The previous code silently
      // fell through to strategy 2/3 on "invalid mode", which made
      // mode typos look like "all strategies failed".
      function friendlyVideoError(rawMsg, agnesBodySent) {
        const m = (rawMsg || "").toLowerCase();
        if (/invalid mode/.test(m)) {
          return [
            `视频生成失败: provider 拒绝了 mode="${agnesBodySent.mode}"。`,
            `当前 provider (${target.provider}/${target.id}) 的合法 mode 值为:`,
            isAgnesStyle
              ? `  • "text"        — 纯文生视频\n  • "keyframe"    — 首帧 / 尾帧 / 首尾帧控制\n  • "reference"   — 多图参考生成`
              : `  • OpenAI Sora 仅支持 prompt + input_reference，无 mode 字段`,
            `你传入了 mode="${(args.mode || "").toString() || "(空)"}"，已被内部翻译为 "${agnesBodySent.mode}"。`,
            `可直接省略 mode：传 image 即自动转 I2V，传 keyframes 即自动转 keyframe 动画。`,
          ].join("\n");
        }
        if (/mode is required/.test(m)) {
          return [
            `视频生成失败: provider 要求显式 mode 字段。`,
            `当前 provider (${target.provider}/${target.id}) 自动检测失败 — 通常因为 image / keyframes 字段缺失。`,
            `请确认：image 是公开可访问的 URL；keyframes 是图片 URL 数组。`,
          ].join("\n");
        }
        if (/requires first_frame|requires last_frame|keyframe mode requires/.test(m)) {
          return [
            `视频生成失败: keyframe 模式需要至少一张参考图（first_frame 或 last_frame）。`,
            `当前调用:`,
            `  • 是否有 image / keyframes 参数? ${(args.image || (args.keyframes && args.keyframes.length) || 0) ? "是（" + (args.image ? "image=" + args.image.slice(0, 60) : "keyframes=" + args.keyframes.length + " 项") + "）" : "否"}`,
            `  • 工具是否自动切到了 keyframe 模式? ${agnesBodySent.mode === "keyframe" ? "是" : "否（当前 mode=" + agnesBodySent.mode + "）"}`,
            `解决方案:`,
            isAgnesStyle
              ? `  • I2V: 传 image=<公开 HTTPS URL>\n  • 首尾帧: 传 keyframes=[<first_url>, <last_url>]\n  • 多图参考: 传 keyframes=[<url1>, <url2>, ...] + mode="reference"`
              : `  • 传 image=<公开 HTTPS URL> 即可（OpenAI 走 input_reference）`,
          ].join("\n");
        }
        if (/cannot include media fields/.test(m) && (m.includes("first_frame") || m.includes("last_frame"))) {
          return `视频生成失败: 工具设置了 mode 但同时携带了媒体字段（first_frame/last_frame）。这通常是上游 provider 协议层 bug，请把 baseURL / provider 信息反馈给 dsh-llm-multimodal 维护者。`;
        }
        if (/forbidden field/.test(m)) {
          return [
            `视频生成失败: provider 拒绝了一个请求体字段 (${rawMsg})。`,
            `当前 provider (${target.provider}) 不接受以下字段:`,
            isAgnesStyle
              ? `  • num_frames / frame_rate / width / height — Agnes 自己决定帧数和分辨率\n  • 像素尺寸 size (1280x720) — 改用 tier (720P)`
              : `  • mode / first_frame / last_frame / keyframes — OpenAI 仅接受 input_reference`,
          ].join("\n");
        }
        if (/invalid url|not found/.test(m)) {
          // Strategy 1 said "no such endpoint" — let it fall through to Sora/chat.
          return null;
        }
        return null;
      }

      // Collect raw errors from each strategy so the final fallback error
      // can show users ALL three attempts — much better than the old
      // "endpoint ${baseURL} 未返回可用视频数据" which hid root cause.
      const strategyErrors = [];

      // Local persistence helper: video endpoints hand back an expiring CDN
      // URL; fetch it into outputDir and return file:// (image/TTS parity).
      // `cover` is the upstream cover image when the provider returned one.
      async function videoResult(url, extra = {}) {
        if (!url) return { success: false, message: "视频生成失败: 响应无视频 URL。" };
        const local = await localizeVideoUrl(ctx, url, getScope(), exec.signal);
        // `?? undefined` would turn a provider null into undefined, and
        // undefined values break lossless-JSON roundtrip of the tool result
        // ("value is not lossless JSON"). Keep extractFirstCoverUrl's raw
        // null/string and only spread keys we actually have.
        const cover = extractFirstCoverUrl(extra.body);
        const res = {
          success: true,
          url: local.url,
          sourceUrl: url,
          model: target.id,
          message: okMsg("视频已生成"),
          ...(cover ? { coverUrl: cover } : {}),
          ...(local.downloadWarning ? { warning: local.downloadWarning } : {}),
          ...(typeof local.bytes === "number" ? { bytes: local.bytes } : {}),
          ...(typeof local.assetPath === "string" ? { assetPath: local.assetPath } : {}),
          ...projectScopedFields(local.destInfo, local.fileName),
        };
        return res;
      }

      // Strategy 1: Agnes-style
      try {
        const { ok, body } = await client.videos.generate(agnesBody);
        if (ok) {
          const url = body?.url || body?.video?.url || extractFirstVideoUrl(JSON.stringify(body));
          if (url) return await videoResult(url, { body });
          // Bug fix (2026-09-13): agnes-video-v2.0 returns BOTH a long base64
          // `video_id` AND a short `task_id` (or `id` == task_id) in the
          // submit response. video_id is an internal encoding the /videos/{id}
          // retrieve endpoint does NOT understand (returns 400 task_not_exist),
          // while the short id/task_id is the real retrieve key. The old
          // priority `video_id || id || task_id` always picked video_id and
          // degenerated into a 10-minute poll timeout. Reorder to prefer the
          // short id / task_id; fall back to video_id only as a last resort.
          const taskId = body?.id || body?.task_id || body?.video_id || body?.job_id;
          if (taskId) {
            try {
              const polled = await pollForVideo(taskId, client.videos.retrieve);
              return await videoResult(polled.url, { body: polled.response || body });
            } catch (e) {
              return { success: false, message: (fallbackWarning ? fallbackWarning + "\n" : "") + e.message };
            }
          }
          // Bug 3 fix: ok=true but neither url nor taskId → previously
          // fell through to Strategy 2 silently, leaving no trace in
          // strategyErrors. Record it so the final "all strategies
          // failed" summary tells the user Strategy 1 returned an
          // empty 200 (a real failure mode for misconfigured proxies
          // and provider rollouts that ack without enqueuing).
          strategyErrors.push({
            strategy: "agnes /videos",
            rawMsg: "200 OK 但响应体中既无 url 也无 task_id (video_id/id/task_id/job_id)",
          });
        } else {
          const rawMsg = body?.error?.message || JSON.stringify(body).slice(0, 200);
          strategyErrors.push({ strategy: "agnes /videos", rawMsg });
          const friendly = nativeRouteHint(target, rawMsg) || friendlyVideoError(rawMsg, agnesBody);
          if (friendly) {
            return { success: false, message: (fallbackWarning ? fallbackWarning + "\n" : "") + friendly };
          }
          // Surface real errors (rate-limit, forbidden field) immediately;
          // fall through only on "endpoint not found" type errors.
          const m = (rawMsg || "").toLowerCase();
          if (!/invalid url|not found|invalid request|is a video model|use \/v1\/videos/.test(m)) {
            return { success: false, message: (fallbackWarning ? fallbackWarning + "\n" : "") + "视频生成失败: " + rawMsg };
          }
        }
      } catch (e) { strategyErrors.push({ strategy: "agnes /videos", rawMsg: e?.message || String(e) }); }
      // Strategy 2: OpenAI Sora-style
      try {
        const { ok, body } = await client.videosOpenAI.generate(openAIBody);
        if (ok) {
          const url = body?.url || body?.video?.url || extractFirstVideoUrl(JSON.stringify(body));
          if (url) return await videoResult(url, { body });
          // Bug fix (2026-09-13): mirror the Strategy-1 fix above — prefer
          // the short id / task_id over the long base64 video_id, since the
          // OpenAI /videos/generations retrieve endpoint also rejects a base64
          // video_id with task_not_exist on certain provider rollouts.
          const taskId = body?.id || body?.task_id || body?.video_id || body?.job_id;
          if (taskId) {
            try {
              const polled = await pollForVideo(taskId, client.videosOpenAI.retrieve);
              return await videoResult(polled.url, { body: polled.response || body });
            } catch (e) {
              return { success: false, message: (fallbackWarning ? fallbackWarning + "\n" : "") + e.message };
            }
          }
          // Bug 3 fix (Strategy 2 mirror): see Strategy 1.
          strategyErrors.push({
            strategy: "openai /videos/generations",
            rawMsg: "200 OK 但响应体中既无 url 也无 task_id (video_id/id/task_id/job_id)",
          });
        } else {
          const rawMsg = body?.error?.message || JSON.stringify(body).slice(0, 200);
          strategyErrors.push({ strategy: "openai /videos/generations", rawMsg });
          const friendly = friendlyVideoError(rawMsg, agnesBody);
          if (friendly) {
            return { success: false, message: (fallbackWarning ? fallbackWarning + "\n" : "") + friendly };
          }
          const m = (rawMsg || "").toLowerCase();
          if (!/invalid url|not found|invalid request|is a video model|use \/v1\/videos/.test(m)) {
            return { success: false, message: (fallbackWarning ? fallbackWarning + "\n" : "") + "视频生成失败: " + rawMsg };
          }
        }
      } catch (e) { strategyErrors.push({ strategy: "openai /videos/generations", rawMsg: e?.message || String(e) }); }
      // Strategy 3: chat completions (last-resort for providers that expose
      // video generation as a chat-completion extension, e.g. Sora 2 alpha
      // when routed through /chat/completions instead of /videos/generations).
      //
      // NOTE on body shape: chat.completions.create → fetchJson → JSON.stringify
      // passes the whole params object verbatim to the wire, so any nested
      // wrapper object shows up as a literal top-level field. The previous
      // implementation used `extraBody: {...}`, which produced a wire body
      // like `{ model, messages, extraBody: { mode, duration, size } }` —
      // `extraBody` is NOT a standard OpenAI field and strict providers
      // rejected it with `400 unknown field "extraBody"`. Flatten the
      // video knobs into the top-level body so they reach the provider as
      // real fields. Default `size` stays pixel-format (`1280x720`) — this
      // strategy is only used when /videos AND /videos/generations both
      // returned 404, so the provider is unlikely to be Agnes and Agnes's
      // `720P` tier token is therefore irrelevant here.
      try {
        const { ok, body } = await client.chat.completions.create({
          model: target.id,
          messages: [{ role: "user", content: args.prompt }],
          mode: "video_generation",
          duration: args.duration || 5,
          size: args.size || "1280x720",
        });
        if (ok) {
          const content = body?.choices?.[0]?.message?.content ?? null;
          const url = extractFirstVideoUrl(content || "") || extractFirstVideoUrl(JSON.stringify(body));
          if (url) return await videoResult(url, { body });
          if (content) return { success: false, message: (fallbackWarning ? fallbackWarning + "\n" : "") + "视频生成返回了文本但无视频 URL: " + content.slice(0, 200) };
        } else {
          // Bug 2 fix: Strategy 3 used to silently swallow !ok responses,
          // so the final "all strategies failed" summary was missing the
          // chat-completions attempt entirely. Record it here so users see
          // the real root cause instead of guessing which strategy broke.
          const rawMsg = body?.error?.message || JSON.stringify(body).slice(0, 200);
          strategyErrors.push({ strategy: "chat /chat/completions", rawMsg });
        }
      } catch (e) {
        strategyErrors.push({ strategy: "chat /chat/completions", rawMsg: e?.message || String(e) });
      }

      // All three strategies failed — show the user ALL the errors so
      // root cause isn't buried.
      const summary = strategyErrors.length
        ? strategyErrors.map((s, i) => `  ${i + 1}. ${s.strategy}: ${s.rawMsg}`).join("\n")
        : "（无详细错误）";
      return {
        success: false,
        message: (fallbackWarning ? fallbackWarning + "\n" : "")
          + `视频生成失败: ${target.baseURL} 未返回可用视频数据。已尝试的端点:\n${summary}`,
      };
    },
  }));

  // ── generate_vision ────────────────────────────────────────────────────
  //
  // OpenAI Vision (Chat Completions multimodal) protocol:
  //
  //   POST {baseURL}/chat/completions
  //   {
  //     "model": "gpt-4o-vision",
  //     "messages": [
  //       { "role": "user", "content": [
  //           { "type": "text", "text": "What's in this image?" },
  //           { "type": "image_url", "image_url": { "url": "https://...", "detail": "auto" } },
  //           { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
  //         ]
  //       }
  //     ],
  //     "max_tokens": 1024,
  //     "temperature": 0.2,
  //     "stream": false
  //   }
  //
  // Response (non-streaming):
  //   { "id": "...", "choices": [ { "message": { "role": "assistant", "content": "..." } } ], "usage": {...} }
  //
  // This same endpoint is also used by every other OpenAI-compatible VL
  // provider (Anthropic-compatible proxies, Qwen-VL OpenAI-mode endpoints,
  // LLaVA-OpenAI shims, etc.), so a single `chat.completions.create`
  // call serves them all without a per-provider strategy ladder.
  //
  // `detail` is the OpenAI Vision token-cost hint:
  //   - "low"  → 85 tokens, fixed. Best for high-volume scans.
  //   - "high" → variable (per 512×512 tile). Best for OCR / fine detail.
  //   - "auto" → model picks. (Default; matches OpenAI's docs.)

  tools.register(defineTool({
    name: "generate_vision",
    description:
      "Run an OpenAI-compatible vision-language model (GPT-4o vision, Claude 3 vision, Qwen-VL, LLaVA, InternVL, Pixtral, GLM-4V, …) against one or more images. Speaks the canonical OpenAI Chat Completions multimodal protocol: messages carry an array of text + image_url content parts; `detail` follows OpenAI's 'low' / 'high' / 'auto' spec. Models are auto-discovered from `llm-pi-ai` (model id containing vision / qwen-vl / llava / internvl / claude-3-vision / gemini-vision / pixtral / paligemma / molmo / phi-3-vision / glm-4v / minicpm-v / yi-vl / cogvlm / mantis). Use `model` to override; blank → first discovered vision model.",
    parameters: {
      prompt: { type: "string", required: true, description: "Text instruction / question about the image(s)." },
      model: { type: "string", description: "Optional model id override (e.g. gpt-4o-vision, qwen-vl-plus, claude-3-vision)." },
      // Array of input images — accepts HTTP(S) URLs, `data:image/...;base64,...`,
      // `file://` paths, and absolute paths on disk (auto-converted to data URIs
      // like generate_image / generate_video do). Pass one image for standard
      // visual-QA; multiple for multi-image reasoning / comparison / doc-vqa.
      images: { type: "array", description: "Input image(s). Public image URLs, Data URI Base64, `file://` paths, or absolute disk paths (auto-converted to data URIs ≤8MB). Multiple images are passed as separate content parts in a single user message." },
      system: { type: "string", description: "Optional system prompt prepended to the conversation." },
      max_tokens: { type: "integer", description: "Max output tokens. Default 1024. Provider-accepted ranges vary (Claude/OpenAI: up to 4096+; smaller VL models may cap at 512).", default: 1024 },
      temperature: { type: "number", description: "Sampling temperature 0.0–2.0. Default 0.2 (factual visual-QA)." },
      detail: { type: "string", enum: ["auto", "low", "high"], description: "OpenAI Vision token-cost hint: 'low' = 85 tokens fixed, 'high' = per-tile cost (OCR / fine detail), 'auto' = model decides. Default 'auto'.", default: "auto" },
      top_p: { type: "number", description: "Nucleus sampling cutoff 0.0–1.0. Optional, pass-through to the provider." },
      // Conversation history (multi-turn). The caller passes an array of
      // prior turns (`{role, content}` where content is either a string
      // or the same OpenAI multimodal array shape). All turns except
      // the LAST one are sent verbatim; the last turn is augmented with
      // the current `prompt` + `images[]` so the caller does not have to
      // duplicate the question text.
      history: { type: "array", description: "Optional prior conversation turns for multi-turn visual chat. Each turn is `{ role: 'user'|'assistant', content: string | OpenAI multimodal content array }`. The current `prompt` + `images[]` are appended as the final user turn." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          success: { type: "boolean" },
          text: { type: "string", description: "Model's natural-language answer (the `choices[0].message.content` string)." },
          model: { type: "string", description: "Resolved model id (echoes the row picked by auto-discovery)." },
          provider: { type: "string", description: "Provider id from llm-pi-ai (e.g. 'openai', 'agnes')." },
          latencyMs: { type: "number" },
          message: { type: "string" },
          usage: {
            type: "object",
            additionalProperties: true,
            properties: {
              inputTokens: { type: "number" },
              outputTokens: { type: "number" },
              totalTokens: { type: "number" },
            },
          },
          finishReason: { type: "string", description: "Provider-reported stop reason (stop / length / content_filter / tool_calls / …)." },
        },
      },
      render: (_args, value) => renderJsonSummary(value),
    },
    async execute(args, exec) {
      if (!args.prompt || !String(args.prompt).trim()) {
        return { success: false, message: "generate_vision 需要非空 prompt" };
      }
      // ── Model discovery (mirrors generate_image / generate_video) ──────
      const models = await discoverModels(credentials);
      const override = readModalityOverride(getScope(), "vision");
      // 0.4: the candidate pool is simply "rows whose resolved capabilities
      // include vision" — `pickModel` reads `modalities`, so a chat model
      // that also sees images (Claude / GPT-5 / Gemini / `qwen-vl` /
      // pi-ai's `input: [text, image]`) is found without a second
      // id-substring special case. The old `type === "text" &&
      // /vision/i.test(id)` escape hatch is gone with it.
      const pick = pickForTool(models, "vision", args.model);
      let target =
        applyOverride(pick.model, override, { overrideId: !args.model }) ||
        (args.model ? null : modelFromOverride(override, "vision"));
      if (!target) {
        return {
          success: false,
          message: missingModelMessage("视觉", "vision", pick.requestedButMissing ? args.model : "", models),
        };
      }
      const fallbackWarning = pick.requestedButMissing ? buildFallbackMessage("视觉", args.model, target) : "";
      if (!target.apiKey) {
        return {
          success: false,
          message: `${fallbackWarning ? fallbackWarning + "\n" : ""}视觉模型 ${target.id} 未配置 apiKey（${target.apiKeyEnv || "API_KEY"} 环境变量）。`,
        };
      }
      if (!isOpenAIProtocol(target)) {
        return { success: false, message: protocolGuardError(target, "视觉", fallbackWarning) };
      }

      // ── Build the multimodal user content ───────────────────────────────
      // OpenAI Vision content array: [{type:'text',text}, {type:'image_url',image_url:{url,detail?}}].
      const detail = (args.detail || "auto").toString().toLowerCase();
      const validDetail = ["auto", "low", "high"].includes(detail) ? detail : "auto";
      // Collect & normalize image inputs (file:// → data URI, etc.).
      const rawImages = []
        .concat(Array.isArray(args.images) ? args.images : [])
        .filter((s) => typeof s === "string" && s.trim());
      const adaptedImages = rawImages.length > 0
        ? await Promise.all(rawImages.map(adaptImageInput))
        : [];
      const userContentParts = [];
      const textPrompt = String(args.prompt).trim();
      userContentParts.push({ type: "text", text: textPrompt });
      for (const url of adaptedImages) {
        // detail is per-image so the caller can mix tile sizes (e.g. one
        // overview-low + one OCR-high) in the same turn. Default all to
        // `args.detail` / "auto".
        userContentParts.push({ type: "image_url", image_url: { url, detail: validDetail } });
      }
      // If the caller passed a single string in `images` (not array),
      // `Array.isArray(args.images)` missed it; surface that explicitly
      // rather than silently dropping.
      if (!Array.isArray(args.images) && typeof args.images === "string" && args.images.trim()) {
        return { success: false, message: "视觉模型需要 images 为字符串数组；单个字符串请用 [url] 包装。" };
      }

      // ── Compose messages ────────────────────────────────────────────────
      const messages = [];
      if (args.system && String(args.system).trim()) {
        messages.push({ role: "system", content: String(args.system) });
      }
      // Multi-turn history (prior turns only — the final user turn is the
      // freshly-built multimodal content above). Validate each entry has
      // role+content to avoid provider-side schema errors.
      const rawHistory = Array.isArray(args.history) ? args.history : [];
      for (let i = 0; i < rawHistory.length; i++) {
        const turn = rawHistory[i];
        if (!turn || typeof turn !== "object") continue;
        const role = (turn.role || "").toString();
        if (role !== "user" && role !== "assistant" && role !== "system") continue;
        messages.push({ role, content: turn.content });
      }
      messages.push({ role: "user", content: userContentParts });

      // ── Compose request body ────────────────────────────────────────────
      const reqBody = { model: target.id, messages };
      if (Number.isFinite(args.max_tokens) && args.max_tokens > 0) reqBody.max_tokens = Math.floor(args.max_tokens);
      if (Number.isFinite(args.temperature)) reqBody.temperature = args.temperature;
      if (Number.isFinite(args.top_p)) reqBody.top_p = args.top_p;

      // ── Friendly error mapping (OpenAI Vision common failure modes) ────
      function friendlyVisionError(rawMsg, sentBody) {
        const native = nativeRouteHint(target, rawMsg);
        if (native) return `视觉调用失败: ${native}`;
        const m = (rawMsg || "").toLowerCase();
        if (/invalid image|url could not be|invalid_image_url|could not process image|invalid value: image/.test(m)) {
          return [
            `视觉调用失败: provider 拒绝了图片输入。`,
            `可能原因:`,
            `  • 输入图片 URL 不是公网可访问的 https:// 链接，且没有 base64 data URI 兜底`,
            `  • data URI 格式不合法（应为 data:image/<mime>;base64,<...>）`,
            `  • 图片 MIME 类型不被支持（OpenAI 接受 png/jpeg/webp/gif）`,
            `当前请求携带了 ${adaptedImages.length} 张图片（detail=${validDetail}）。`,
          ].join("\n");
        }
        if (/content must be a string|content must be.*list|invalid type for content/.test(m)) {
          return [
            `视觉调用失败: messages[*].content 字段格式错误。`,
            `本工具按 OpenAI 多模态格式输出 content 数组；若你使用的 provider 不是 OpenAI 兼容的 vision 实现，请确认 baseURL/apiProtocol 设置正确。`,
            `当前 provider=${target.provider}/${target.id}，baseURL=${target.baseURL}`,
          ].join("\n");
        }
        if (/max_tokens.*exceed|maximum.*tokens|context length|too many tokens/.test(m)) {
          return [
            `视觉调用失败: 超过 provider 的 token 上下文上限。`,
            `可尝试:`,
            `  • 减少 images 数量（多张图按 512×512 tile 计费）`,
            `  • 把 detail 从 'high' 改为 'low' 或 'auto'（low 固定 85 tokens/张）`,
            `  • 缩小 max_tokens`,
          ].join("\n");
        }
        if (/rate limit|quota|insufficient_quota|429/.test(m)) {
          return `视觉调用失败: provider 限流或余额不足 (${rawMsg})。请稍后重试或检查 ${target.apiKeyEnv || "API_KEY"}。`;
        }
        if (/model.*not.*found|unknown model|model_not_found|404/.test(m)) {
          return [
            `视觉调用失败: provider 不识别 model="${target.id}"。`,
            `该 provider (${target.provider}) 的视觉模型清单可能不含此 id。请在 dsh Settings → llm-multimodal → 视觉 中切换 defaultModel，或检查 llm-pi-ai providers.${target.provider}.models 中是否包含 "${target.id}"。`,
          ].join("\n");
        }
        return null;
      }

      // ── Fire the request ────────────────────────────────────────────────
      const t0 = Date.now();
      try {
        const client = createClient(target.baseURL, target.apiKey, target.id);
        const { ok, body, status } = await client.chat.completions.create(reqBody);
        if (!ok) {
          const rawMsg = body?.error?.message || JSON.stringify(body).slice(0, 200);
          const friendly = friendlyVisionError(rawMsg, reqBody);
          return {
            success: false,
            message: (fallbackWarning ? fallbackWarning + "\n" : "")
              + (friendly || `视觉调用失败 (HTTP ${status}): ${rawMsg}`),
          };
        }
        // OpenAI Chat Completions response shape (also adopted by every
        // OpenAI-compatible VL provider):
        //   { choices: [ { message: { role: "assistant", content: "..." }, finish_reason: "..." } ],
        //     usage: { prompt_tokens, completion_tokens, total_tokens } }
        const choice = body?.choices?.[0] ?? null;
        const message = choice?.message ?? choice?.delta ?? null;
        // `content` may be missing if the provider streams only tool_calls
        // or reasoning. Coerce to "" so downstream `value.text` is never
        // undefined (which would break the `render` projection's
        // `value?.success === false` test).
        const text = typeof message?.content === "string" ? message.content
          : (Array.isArray(message?.content)
              // Some providers return content as an array of parts
              // (e.g. [{type:'text', text:'...'}, {type:'image_url', ...}])
              // — concatenate the text parts and surface the rest in
              // `extraParts` for transparency.
              ? (() => {
                  const parts = message.content;
                  const text = parts.filter((p) => p?.type === "text").map((p) => p.text || "").join("");
                  const extras = parts.filter((p) => p?.type !== "text");
                  if (extras.length) return JSON.stringify({ text, extraParts: extras });
                  return text;
                })()
              : "");
        const finishReason = choice?.finish_reason || choice?.stop_reason || body?.finish_reason || "";
        const usage = body?.usage ? {
          inputTokens: body.usage.prompt_tokens || 0,
          outputTokens: body.usage.completion_tokens || 0,
          totalTokens: body.usage.total_tokens || 0,
        } : undefined;
        const successMsg = text
          ? "视觉理解完成"
          : (finishReason
            ? `视觉调用完成，但模型未返回文本（finish_reason=${finishReason}）。`
            : "视觉调用完成，但响应无文本内容。");
        return {
          success: true,
          text,
          model: target.id,
          provider: target.provider,
          ...(finishReason ? { finishReason } : {}),
          ...(usage ? { usage } : {}),
          latencyMs: Date.now() - t0,
          message: fallbackWarning ? fallbackWarning + "\n" + successMsg : successMsg,
        };
      } catch (e) {
        return {
          success: false,
          message: (fallbackWarning ? fallbackWarning + "\n" : "") + "视觉调用失败: " + (e?.message || String(e)),
        };
      }
    },
  }));

  // ── generate_tts ───────────────────────────────────────────────────────

  tools.register(defineTool({
    name: "generate_tts",
    description:
      "Synthesize speech via OpenAI-compatible /audio/speech. Auto-discovers a TTS provider from `llm-pi-ai` (model id containing tts/speech/voice/minimax). `voice` picks a preset (e.g. female-shaonv, male-qn-jingying) or a previously cloned voice_id; `clone_audio` + `voice_name` clone a character's own voice from a reference audio (upload → voice_clone → speak) and reuse it by name on later calls. Output routing: with the media-studio plugin active (default outputStrategy=project) the audio lands in the ACTIVE project's assets/audio/ and the result carries projectId + canvasUrl; otherwise it lands in the configured outputDir (default /tmp).",
    parameters: {
      text: { type: "string", required: true, description: "Literal text to speak. Not a song lyric." },
      voice: { type: "string", description: "Voice id: MiniMax preset (e.g. female-shaonv, male-qn-jingying) OR an existing cloned voice_id. Falls back to llm-multimodal.tts.voice." },
      clone_audio: { type: "string", description: "角色音色种子（参考音频，5-60 秒干声为宜）: 本地路径 / file:// / http(s) URL / data:audio base64。提供后自动音色克隆（上传 → 注册 voice_id → 用克隆音色朗读）；同一 voice_name 后续调用直接复用，不再重复克隆。" },
      voice_name: { type: "string", description: "克隆音色的稳定名字（建议用角色名，如 沈渊），用于跨调用复用；不填则每次重新克隆。" },
      clone_voice_id: { type: "string", description: "克隆时使用的自定义 voice_id（MiniMax 要求，如 voice_clone_shenyuan）；不填自动生成。" },
      model: { type: "string", description: "Optional model id override." },
      speed: { type: "number", description: "Speech speed 0.5–2.0. Default 1.0." },
      output_format: { type: "string", enum: ["mp3", "wav", "pcm", "aac", "flac", "opus"], description: "Output audio format. Default mp3." },
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
      const pick = pickForTool(models, "tts", args.model);
      let target =
        applyOverride(pick.model, override, { overrideId: !args.model }) ||
        (args.model ? null : modelFromOverride(override, "tts"));
      if (!target) {
        return {
          success: false,
          message: missingModelMessage("TTS", "tts", pick.requestedButMissing ? args.model : "", models),
        };
      }
      const fallbackWarning = pick.requestedButMissing ? buildFallbackMessage("TTS", args.model, target) : "";
      if (!target.apiKey) {
        return {
          success: false,
          message: `${fallbackWarning ? fallbackWarning + "\n" : ""}TTS 模型 ${target.id} 未配置 apiKey（${target.apiKeyEnv || "API_KEY"} 环境变量）。`,
        };
      }
      if (!isOpenAIProtocol(target)) {
        return { success: false, message: protocolGuardError(target, "TTS", fallbackWarning) };
      }
      return executeSpeech({ kind: "tts", label: "TTS", args, target, fallbackWarning, defaultVoice: override.voice, exec, destInfo: resolveMediaDestination(ctx, getScope(), "audio") });
    },
  }));

  // ── generate_music ─────────────────────────────────────────────────────
  //
  // Music uses ONLY `music`-classified models (model id contains
  // music/song/lyric). TTS-classified models are served by generate_tts
  // and deliberately excluded here — a TTS model must NOT serve music.
  // Both share the /audio/speech wire shape when the provider is
  // OpenAI-compatible; future music-native backends (Suno / HeartMuLa)
  // can register an actual music-style adapter without touching TTS.

  tools.register(defineTool({
    name: "generate_music",
    description:
      "Synthesize music / background music / sound effects via an OpenAI-compatible /audio/speech endpoint. Uses ONLY music-classified models (model id contains music/song/lyric); TTS models are served by generate_tts and do NOT serve music. `clone_audio` + `voice_name` clone a character's own voice from a reference audio and reuse it by name on later calls (same flow as generate_tts). Output routing: with the media-studio plugin active (default outputStrategy=project) the audio lands in the ACTIVE project's assets/audio/ and the result carries projectId + canvasUrl; otherwise it lands in the configured outputDir (default /tmp).",
    parameters: {
      text: { type: "string", required: true, description: "Lyric / text hint. Some providers ignore this for music." },
      voice: { type: "string", description: "Voice id: MiniMax preset OR an existing cloned voice_id. Falls back to llm-multimodal.music.voice." },
      clone_audio: { type: "string", description: "角色音色种子（参考音频）: 本地路径 / file:// / http(s) URL / data:audio base64。提供后自动音色克隆；同一 voice_name 后续调用直接复用。" },
      voice_name: { type: "string", description: "克隆音色的稳定名字（建议用角色名），用于跨调用复用；不填则每次重新克隆。" },
      clone_voice_id: { type: "string", description: "克隆时使用的自定义 voice_id（MiniMax 要求）；不填自动生成。" },
      model: { type: "string", description: "Optional model id override (must be a music-classified model)." },
      speed: { type: "number", description: "Playback speed 0.5–2.0.", default: 1.0 },
      output_format: { type: "string", enum: ["mp3", "wav", "pcm", "aac", "flac", "opus"], description: "Output audio format. Default mp3." },
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
      // Music-only candidate pool: `music`-classified rows, plus
      // `text`-classified rows whose id mentions music (same convention as
      // the tts pool). TTS rows are excluded on purpose.
      const pick = pickForTool(models, "music", args.model);
      let target =
        applyOverride(pick.model, override, { overrideId: !args.model }) ||
        (args.model ? null : modelFromOverride(override, "music"));
      if (!target) {
        return {
          success: false,
          message: missingModelMessage("music", "music", pick.requestedButMissing ? args.model : "", models),
        };
      }
      const fallbackWarning = pick.requestedButMissing ? buildFallbackMessage("music", args.model, target) : "";
      if (!target.apiKey) {
        return {
          success: false,
          message: `${fallbackWarning ? fallbackWarning + "\n" : ""}music 模型 ${target.id} 未配置 apiKey（${target.apiKeyEnv || "API_KEY"} 环境变量）。`,
        };
      }
      if (!isOpenAIProtocol(target)) {
        return { success: false, message: protocolGuardError(target, "music", fallbackWarning) };
      }
      return executeSpeech({ kind: "music", label: "music", args, target, fallbackWarning, defaultVoice: override.voice, exec, destInfo: resolveMediaDestination(ctx, getScope(), "audio") });
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
  try {
    return wserver.register({ kind: 'exact', path, handler })
  } catch (error) {
    // A route left behind by a disposed instance (HMR reload, disable→enable)
    // still occupies the path. These paths are namespaced to this plugin, so
    // reclaim the seat instead of failing apply() on `duplicate exact route`.
    const table = wserver.exact
    if (table && typeof table.delete === 'function' && table.has(path)) {
      table.delete(path)
      return wserver.register({ kind: 'exact', path, handler })
    }
    throw error
  }
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
/**
 * Classify a provider's "extension surface" — i.e. which non-OpenAI
 * standard fields the tool layer will use when talking to it. The
 * settings card surfaces this so users understand WHY a field like
 * `first_frame` / `extra_body.image` / `voice_clone` works against
 * Agnes but might not against other OpenAI-compatible providers.
 *
 * Returns an array of { key, label, docs } objects. Each entry maps to
 * a real, exercised branch in the tool's request body. Keep this list
 * small and grounded — every entry must correspond to code in
 * generate_image / generate_video / generate_tts / generate_music.
 */
function providerExtensions({ baseURL = "", apiProtocol = "", displayName = "" }) {
  const exts = [];
  const isAgnesLike = /agnes-?ai\.com|apihub\.agnes/i.test(baseURL)
    || /agnes/i.test(displayName)
    || apiProtocol.toLowerCase() === "agnes";

  if (isAgnesLike) {
    // generate_video: mode + first_frame / last_frame are Agnes-only.
    exts.push({
      key: "video-mode-keyframe",
      label: "视频 mode + first_frame/last_frame",
      docs: "https://www.agnes-ai.com/zh-Hans/docs/agnes-video-25-flash",
      note: "Agnes 私有扩展（OpenAI Sora 仅用 input_reference）",
    });
    // generate_image: I2I 走 extra_body.image + extra_body.response_format
    exts.push({
      key: "image-extra-body",
      label: "图像 I2I 走 extra_body",
      docs: "https://www.agnes-ai.com/zh-Hans/docs/agnes-image-25-flash",
      note: "Agnes 私有扩展（OpenAI /generations 不接受 image 字段）",
    });
  }

  // voice_clone: MiniMax 兼容扩展，部分 provider 实现（Agnes、MiniMax 自己、本地 voxcpm 都实现了）。
  // We can't know from baseURL alone whether /files/upload + /voice_clone exist;
  // flag it for any non-strict-OpenAI provider and let runtime surface the error.
  if (!/api\.openai\.com/.test(baseURL)) {
    exts.push({
      key: "tts-voice-clone",
      label: "音色克隆 (files/upload + voice_clone)",
      docs: "https://www.agnes-ai.com/zh-Hans/docs",
      note: "MiniMax 兼容扩展 — 不是 OpenAI 标准，调用失败时切换到预设 voice",
    });
  }

  return exts;
}

async function buildModelsSnapshot(credentials) {
  const providers = await readPiAiProviders()
  const { store } = await readCapabilityStore()
  const providerRows = []
  const allModels = []
  for (const [pid, p] of Object.entries(providers)) {
    if (!p || !Array.isArray(p.models)) continue
    const baseURL = p.baseURL || ""
    const apiKeyEnv = p.apiKeyEnv || ""
    const displayName = (p.displayName || pid)
    const apiProtocol = (p.apiProtocol || apiProtocolFromApi(p.api))
    const providerMeta = getProviderMeta(pid)
    const models = []
    for (const m of p.models) {
      const id = (m && m.id) || ""
      if (!id) continue
      const name = (m && m.name) || id
      const meta = {
        input: m?.input,
        output: m?.output,
        contextWindow: m?.contextWindow,
        maxTokens: m?.maxTokens,
      }
      const resolved = resolveCapabilities({
        id,
        name,
        meta,
        override: store.overrides[normalizeModelKey(pid, id)],
        providerMeta: providerMeta ? providerMeta[id] : undefined,
        rules: store.rules,
      })
      const row = {
        provider: pid,
        id,
        name,
        type: resolved.primary,
        modalities: resolved.modalities,
        primary: resolved.primary,
        confidence: resolved.confidence,
        sources: resolved.sources,
        contextWindow: meta.contextWindow,
        maxTokens: meta.maxTokens,
        input: meta.input,
        output: meta.output,
        apiProtocol,
      }
      models.push(row)
      allModels.push({ ...row, baseURL })
    }
    if (models.length === 0) continue
    const exts = providerExtensions({ baseURL, apiProtocol, displayName })
    providerRows.push({ id: pid, displayName, baseURL, apiKeyEnv, apiProtocol, models, extensions: exts })
  }
  // A row may serve several modalities (chat models that also see images),
  // so `byModality` is built from `modalities`, not from the single `type`.
  const byModality = {}
  for (const modality of MODALITIES) byModality[modality] = []
  for (const m of allModels) {
    const providerRow = providerRows.find((r) => r.id === m.provider)
    for (const modality of m.modalities) {
      if (!byModality[modality]) byModality[modality] = []
      // Carry per-model `extensions` so the UI can show the same banner
      // when a model is auto-selected (no need to look up its provider).
      byModality[modality].push({ ...m, extensions: providerRow?.extensions ?? [] })
    }
  }
  return { providers: providerRows, byModality }
}

/**
 * Read a JSON request body from a raw Node request.
 *
 * The host's webServer hands routes the untouched `http.IncomingMessage`, so
 * a plugin route reads its own body. Returns {} for an empty body.
 *
 * @param {import('node:http').IncomingMessage} req - the raw request
 * @returns {Promise<any>} the parsed body
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      if (!raw) { resolve({}); return }
      try { resolve(JSON.parse(raw)) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

/**
 * Plug HTTP endpoints. Called once per plugin apply via ctx.effect.
 *
 * Why the language matters here: webServer.register is the canonical DSH
 * plugin surface — the same one media-studio uses for its canvas SSE.
 * Hosting our own routes keeps the multimodal plugin self-contained and
 * avoids depending on media-studio's /api/media-studio/* paths.
 */
function attachHttpRoutes(ctx, getScope) {
  const lookup = (name) => (typeof ctx.get === 'function' ? ctx.get(name) : ctx[name])
  const wserver = lookup('webServer')
  const settings = lookup('settings')

  // Resolve the services ONCE, while the plugin's fiber is active. Reading
  // `ctx.credentials` inside the request handler would throw
  // `cannot get required service "credentials" in inactive context` once the
  // plugin is reloaded (HMR / disable→enable): the old route survives on the
  // webserver table while the ctx that owned it is disposed.
  const credentials = lookup('credentials')
  const route = (method, path, handler) => {
    const dispose = registerRoute(wserver, method, path, handler)
    // Tie the route's lifetime to this plugin instance so a reload can
    // re-register it instead of colliding on `webserver: duplicate exact route`.
    if (typeof dispose === 'function' && typeof ctx.effect === 'function') ctx.effect(() => dispose)
  }

  // GET /api/llm-multimodal/models — settings card polls this on mount.
  route('GET', '/api/llm-multimodal/models', async (_req, res) => {
    try {
      const snap = await buildModelsSnapshot(credentials)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, ...snap }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }))
    }
  })

  // GET /api/llm-multimodal/providers — convenience alias used by the
  // settings card's "已发现 N 个 provider" header. Returns the same rows.
  route('GET', '/api/llm-multimodal/providers', async (_req, res) => {
    try {
      const snap = await buildModelsSnapshot(credentials)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, providers: snap.providers }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }))
    }
  })

  // GET /api/llm-multimodal/capabilities — the store that drives resolution:
  // pinned modalities per model, custom rules, and the file they live in.
  route('GET', '/api/llm-multimodal/capabilities', async (_req, res) => {
    const payload = { ok: false }
    try {
      const { path, store } = await readCapabilityStore()
      payload.ok = true
      payload.file = path
      payload.overrides = store.overrides
      payload.rules = store.rules.length > 0 ? store.rules : defaultRules()
      payload.storeRules = store.rules
    } catch (e) {
      payload.error = e?.message || String(e)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  })

  // POST /api/llm-multimodal/capabilities/override — pin (or clear) the
  // modalities of one model, keyed "<provider>:<modelId>". Body:
  // { key, modalities: ["text","vision"] } — an empty list clears the pin.
  // Answers with the same snapshot the models route returns, so the card can
  // repaint from one round-trip.
  route('POST', '/api/llm-multimodal/capabilities/override', async (req, res) => {
    const payload = { ok: false }
    try {
      const body = await readJsonBody(req)
      const key = typeof body?.key === 'string' ? body.key.trim() : ''
      if (!key) throw new Error('缺少 key（应为 "<provider>:<modelId>"）')
      const { path, store } = await readCapabilityStore()
      const next = applyOverrideEntry(store, key, body?.modalities)
      await saveCapabilityStore(path, next, writeFile, mkdir)
      const snap = await buildModelsSnapshot(credentials)
      payload.ok = true
      payload.file = path
      payload.overrides = next.overrides
      payload.providers = snap.providers
      payload.byModality = snap.byModality
    } catch (e) {
      payload.error = e?.message || String(e)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  })

  // POST /api/llm-multimodal/detect — probe providers' GET {baseURL}/models
  // and keep the rows (architecture / capabilities / input_modalities) as
  // evidence for the resolver. Body: { provider? } — omitted means every
  // provider that has a baseURL. Never fails the request: unreachable
  // providers are reported per provider and resolution falls back to the
  // pi-ai config.
  route('POST', '/api/llm-multimodal/detect', async (req, res) => {
    const payload = { ok: false, results: [] }
    try {
      const body = await readJsonBody(req)
      const wanted = typeof body?.provider === 'string' ? body.provider.trim() : ''
      const providers = await readPiAiProviders()
      for (const [pid, p] of Object.entries(providers)) {
        if (wanted && pid !== wanted) continue
        if (!p || !p.baseURL) {
          payload.results.push({ provider: pid, ok: false, error: 'provider has no baseURL' })
          continue
        }
        const apiKey = await resolveApiKey(credentials, p.apiKeyEnv)
        const found = await fetchProviderCatalog(p.baseURL, apiKey)
        if (found.ok) {
          setProviderMeta(pid, found.byId)
          payload.results.push({ provider: pid, ok: true, models: found.models })
        } else {
          payload.results.push({ provider: pid, ok: false, error: found.error || 'probe failed' })
        }
      }
      payload.ok = payload.results.some((r) => r.ok)
      payload.provider = wanted || null
      // How many model entries the probe actually contributed, so the UI can
      // say "merged 30 entries" instead of "done".
      payload.merged = payload.results.reduce(
        (sum, r) => sum + (typeof r.models === 'number' ? r.models : 0),
        0,
      )
      const snap = await buildModelsSnapshot(credentials)
      payload.providers = snap.providers
      payload.byModality = snap.byModality
    } catch (e) {
      payload.error = e?.message || String(e)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  })

  // POST /api/llm-multimodal/settings/mutate — apply the same ops the client
  // card sends, straight at the Host. Used to tell "the Host refused the
  // write" apart from "the card never re-rendered" without a browser.
  route('POST', '/api/llm-multimodal/settings/mutate', async (req, res) => {
    const payload = { ok: false }
    try {
      const body = await readJsonBody(req)
      const ops = Array.isArray(body?.ops) ? body.ops : []
      const revision = typeof body?.revision === 'number' ? body.revision : undefined
      if (!settings || typeof settings.mutate !== 'function') {
        throw new Error('host settings.mutate is unavailable')
      }
      await settings.mutate(NS, ops, revision)
      payload.ok = true
      payload.ops = ops
      payload.revision = revision
      // The namespace view a real client write answers with (the host's
      // `namespaceView()` projection), so a headless harness can replay the
      // exact wire shape the browser would receive.
      if (settings && typeof settings.describe === 'function') {
        const described = await settings.describe()
        const list = Array.isArray(described) ? described : (described?.namespaces ?? described?.entries ?? [])
        const own = list.find((entry) => entry?.ns === NS)
        if (own) {
          payload.view = {
            ns: NS,
            autoGenerate: own.autoGenerate !== false,
            schema: own.schema,
            value: own.value,
            base: own.base,
            user: own.user,
            applies: 'live',
            secrets: [],
            revision: own.revision,
          }
        }
      }
    } catch (e) {
      payload.error = e?.message || String(e)
      payload.errorName = e?.name || ''
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  })

  // GET /api/llm-multimodal/settings — what the host currently serves for
  // this plugin's settings namespace, plus the effective per-modality values.
  //
  // The card needs two things to render a usable form:
  //   1. the effective values (provider / model / endpoint per modality), and
  //   2. proof that the host actually serves a settings page for the
  //      `llm-multimodal` namespace — without it the Plugins page shows no
  //      entry to click into.
  // The host only serves a namespace whose plugin Config declares volatile
  // leaves, so this route is also the place to see WHY an entry is missing.
  route('GET', '/api/llm-multimodal/settings', async (_req, res) => {
    const payload = {
      ok: true,
      namespace: NS,
      effective: {},
      served: false,
      namespaces: [],
      settingsApi: settings
        ? (typeof settings.register === 'function' ? 'register' : (typeof settings.describe === 'function' ? 'describe' : 'unknown'))
        : 'missing',
    }
    try {
      const scope = typeof getScope === 'function' ? getScope() : null
      const values = scope && typeof scope.get === 'function' ? scope.get() : {}
      payload.effective = {
        text: values?.text ?? {},
        image: values?.image ?? {},
        video: values?.video ?? {},
        vision: values?.vision ?? {},
        tts: values?.tts ?? {},
        music: values?.music ?? {},
        outputDir: values?.outputDir ?? '',
        outputStrategy: values?.outputStrategy ?? '',
      }
    } catch (e) {
      payload.effectiveError = e?.message || String(e)
    }
    try {
      if (settings && typeof settings.describe === 'function') {
        const described = await settings.describe()
        const list = Array.isArray(described) ? described : (described?.namespaces ?? described?.entries ?? [])
        payload.namespaces = list.map((entry) => ({
          ns: entry?.ns ?? '',
          autoGenerate: entry?.autoGenerate !== false,
          revision: entry?.revision,
          writable: entry?.writable !== false,
        }))
        payload.served = payload.namespaces.some((entry) => entry.ns === NS)
        // The raw descriptor for our namespace: its served schema (volatile
        // flags), the effective/user values and the write fence (revision).
        const own = list.find((entry) => entry?.ns === NS)
        if (own) {
          payload.entry = {
            autoGenerate: own.autoGenerate,
            revision: own.revision,
            writable: own.writable,
            value: own.value,
            base: own.base,
            user: own.user,
            schema: own.schema,
          }
        }
      }
    } catch (e) {
      payload.describeError = e?.message || String(e)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
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
  pickForTool,
  nativeRouteHint,
  resolveTextModel,
  applyOverride,
  modelFromOverride,
  missingModelMessage,
  readCapabilityStore,
  discoverModels,
  readModalityOverride,
  extractFirstMedia,
  extractFirstVideoUrl,
  extractFirstCoverUrl,
  isOpenAIProtocol,
  sanitizeVoiceName,
  audioExtFromName,
  extFromMime,
  loadAudioBuffer,
  voiceStorePath,
  loadVoiceStore,
  saveVoiceStore,
  IMG_KEYWORDS,
  VID_KEYWORDS,
  VL_KEYWORDS,
  TTS_KEYWORDS,
  MUSIC_KEYWORDS,
  TEXT_KEYWORDS,
};

// Override the default export to add the above for tests — Node's
// "default export" semantics swallow the named exports in CJS, but we
// ship ESM so name exports ride through untouched.
