/**
 * Capability resolution for dsh-llm-multimodal.
 *
 * HISTORICAL PROBLEM
 * ------------------
 * v0.3 classified a model with ONE hand-maintained keyword table and a
 * naive `id.includes(keyword)` test (see `classifyModelId`), producing a
 * single `type` label. That had three structural failures on real catalogs:
 *
 *   1. signal loss — pi-ai already declares `input: [text, image]` per
 *      model (MiniMax-M3 does), and the plugin never read it;
 *   2. single label — a chat model that also sees images could only live
 *      in ONE bucket, so the vision pool stayed empty and `generate_vision`
 *      was unusable even with capable models configured;
 *   3. substring false positives — a bare "h3" keyword made
 *      `minimax/h3` (a chat model) look like a video model, and the
 *      `nano-banana` image family matched no keyword at all.
 *
 * THIS MODULE
 * -----------
 * Resolves a model to a SET of modalities from layered evidence, ordered by
 * confidence and reported per model so the settings card can explain (and
 * the user can override) every decision:
 *
 *   override  (1.00)  the user pinned it in llm-multimodal-capabilities.json
 *   declared  (0.90)  pi-ai's own model.input / model.output
 *   provider  (0.80)  the service's GET {baseURL}/models metadata
 *   rule      (0.85)  a specific id pattern (nano-banana, veo-3, -image, …)
 *   family    (0.60)  a model family known to be multimodal (claude, gemini…)
 *   fallback  (0.30)  no evidence — text, the safe default
 *
 * Pure ESM, no dependencies, no host services: everything here is testable
 * in isolation (`tests/capabilities.test.ts`).
 */

export const MODALITIES = ["text", "image", "video", "vision", "tts", "music"];

/** Modalities that address a generation endpoint (not a chat round-trip). */
const GENERATION_MODALITIES = ["image", "video", "tts", "music"];

const MODALITY_SET = new Set(MODALITIES);

const LEVEL_CONFIDENCE = {
  override: 1,
  declared: 0.9,
  // A human-written display name is weaker evidence than an id token or a
  // declared modality, but stronger than an id prefix that is only a brand.
  name: 0.82,
  rule: 0.85,
  provider: 0.8,
  family: 0.6,
  fallback: 0.3,
};

/**
 * Specific id patterns. Checked in order, first match wins. Each rule names
 * the generation modality it implies; vision rules imply text+vision.
 *
 * Patterns are anchored on token boundaries — never bare substrings — so
 * `wan` cannot match `wanderer` and `h3` no longer exists at all.
 */
const DEFAULT_RULES = [
  // ── image generation ──────────────────────────────────────────────────
  { id: "image.nano-banana", pattern: "(?:^|[-_/.])nano[-_]?banana(?:[-_/.]|$)", modalities: ["image"], note: "Google Nano Banana image family" },
  { id: "image.token", pattern: "(?:^|[-_/.])(?:image|img)(?:[-_/.]|$)", modalities: ["image"], note: "id carries an image token" },
  { id: "image.gemini-suffix", pattern: "(?:^|[-_/.])gemini[-_\\d.]+.*(?:image|banana)", modalities: ["image"], note: "Gemini image variant" },
  { id: "image.flux", pattern: "(?:^|[-_/.])(?:flux)(?:[-_\\d.]|$)", modalities: ["image"], note: "FLUX family" },
  { id: "image.dalle", pattern: "(?:^|[-_/.])(?:dall[-_]?e|dalle)(?:[-_\\d.]|$)", modalities: ["image"], note: "DALL·E family" },
  { id: "image.midjourney", pattern: "(?:^|[-_/.])(?:midjourney|niji)(?:[-_\\d.]|$)", modalities: ["image"], note: "Midjourney family" },
  { id: "image.stablediffusion", pattern: "(?:^|[-_/.])(?:sdxl|sd3|sd[-_]?xl|stable[-_]?diffusion|sd[-_]\\d)(?:[-_/.]|$)", modalities: ["image"], note: "Stable Diffusion family" },
  { id: "image.imagen", pattern: "(?:^|[-_/.])(?:imagen)(?:[-_\\d.]|$)", modalities: ["image"], note: "Google Imagen family" },
  { id: "image.seedream", pattern: "(?:^|[-_/.])(?:seedream|seededit|kandinsky|realesrgan|juggernaut|photoreal|playground)(?:[-_/.]|$)", modalities: ["image"], note: "other image generators" },

  // ── video generation ──────────────────────────────────────────────────
  { id: "video.veo", pattern: "(?:^|[-_/.])(?:veo)(?:[-_\\d.]|$)", modalities: ["video"], note: "Google Veo family" },
  { id: "video.sora", pattern: "(?:^|[-_/.])(?:sora)(?:[-_\\d.]|$)", modalities: ["video"], note: "OpenAI Sora family" },
  { id: "video.kling", pattern: "(?:^|[-_/.])(?:kling)(?:[-_\\d.]|$)", modalities: ["video"], note: "Kling family" },
  { id: "video.seedance", pattern: "(?:^|[-_/.])(?:seedance)(?:[-_\\d.]|$)", modalities: ["video"], note: "ByteDance Seedance family" },
  { id: "video.hailuo", pattern: "(?:^|[-_/.])(?:hailuo)(?:[-_\\d.]|$)", modalities: ["video"], note: "MiniMax Hailuo family" },
  { id: "video.wan", pattern: "(?:^|[-_/.])(?:wan)(?:[-_]?\\d|[-_/.]|$)", modalities: ["video"], note: "Wan 2.x video generator (bare \"local-wan\" included)" },
  { id: "video.others", pattern: "(?:^|[-_/.])(?:runway|gen-?3|ltx(?:[-_]?video)?|cogvideo|cogvideox|hunyuan[-_]?video|seedvr|musetalk|lipsync)(?:[-_\\d.]|$)", modalities: ["video"], note: "other video generators" },
  { id: "video.direction", pattern: "(?:^|[-_/.])(?:t2v|i2v|txt2video|img2video|text2video|image2video)(?:[-_/.]|$)", modalities: ["video"], note: "text/image-to-video id token" },
  { id: "video.token", pattern: "(?:^|[-_/.])(?:video)(?:[-_/.]|$)", modalities: ["video"], note: "id carries a video token" },

  // ── speech / music ────────────────────────────────────────────────────
  { id: "tts.token", pattern: "(?:^|[-_/.])(?:tts|speech|text2speech|text-to-speech)(?:[-_/.]|$)", modalities: ["tts"], note: "id carries a tts/speech token" },
  { id: "tts.voice", pattern: "(?:^|[-_/.])(?:voice|voiceclone|voice-clone)(?:[-_/.]|$)", modalities: ["tts"], note: "id carries a voice token" },
  { id: "tts.family", pattern: "(?:^|[-_/.])(?:voxcpm|cosyvoice|elevenlabs|f5[-_]?tts|openvoice)(?:[-_\\d.]|$)", modalities: ["tts"], note: "TTS family" },
  { id: "music.token", pattern: "(?:^|[-_/.])(?:music|song|lyric|lyrics)(?:[-_/.]|$)", modalities: ["music"], note: "id carries a music token" },
  { id: "music.family", pattern: "(?:^|[-_/.])(?:suno|udio|ace[-_]?step|musicgen)(?:[-_\\d.]|$)", modalities: ["music"], note: "music generation family" },

  // ── vision (chat + image input) ───────────────────────────────────────
  { id: "vision.token", pattern: "(?:^|[-_/.])(?:vision|see|ocr)(?:[-_/.]|$)", modalities: ["text", "vision"], note: "id carries a vision token" },
  { id: "vision.vl", pattern: "(?:^|[-_/.])(?:vl)(?:[-_\\d.]|$)", modalities: ["text", "vision"], note: "…-vl / …-vl-plus family" },
  { id: "vision.family", pattern: "(?:llava|internvl|intern[-_]vl|pixtral|paligemma|molmo|cogvlm|minicpm[-_]v|glm[-_]?4v|yi[-_]vl|phi[-_]?3[-_]vision|mantis)", modalities: ["text", "vision"], note: "open VL family" },
];

/**
 * Broad families known to accept images in the chat protocol. Lower
 * confidence than `rule`, and only consulted when no specific rule and no
 * declared metadata decided the model — this is what makes the huge
 * claude / gpt / gemini catalogs of an aggregator usable from
 * `generate_vision` without renaming ids.
 */
const FAMILY_RULES = [
  { id: "family.claude", pattern: "claude|anthropic", modalities: ["text", "vision"], note: "Claude 3+ accepts images" },
  { id: "family.gpt-multimodal", pattern: "(?:^|[-_/.])(?:gpt[-_]?(?:4o|4\\.\\d|5|6)|o[34])(?:[-_\\d.]|$)", modalities: ["text", "vision"], note: "GPT-4o / GPT-5 / GPT-6 / o3 are multimodal" },
  { id: "family.gemini", pattern: "(?:^|[-_/.])gemini(?:[-_\\d.]|$)", modalities: ["text", "vision"], note: "Gemini models accept images" },
  { id: "family.kimi", pattern: "(?:^|[-_/.])kimi(?:[-_\\d.]|$)", modalities: ["text", "vision"], note: "Kimi K2+ accepts images" },
  { id: "family.qwen-vl", pattern: "qwen[-_]?(?:2\\.?5|3)[-_]?vl", modalities: ["text", "vision"], note: "Qwen-VL accepts images" },
];

/**
 * Human-written hints in the display `name`.
 *
 * Local gateways label their catalogue in plain words — "H3C 视频生成
 * (本地)", "MiniMax-H3 视频生成" — while a hosted aggregator ships the same
 * family as a chat model ("MiniMax H3"). The id alone cannot tell those
 * apart, so a *phrase* in the name ("视频生成", "语音合成", …) is the
 * deciding evidence. Deliberately narrow: a bare "视频" or "图像" would
 * pull vision models into the wrong bucket.
 */
const NAME_RULES = [
  { id: "name.image", pattern: "(?:生图|文生图|图生图|出图|绘图|图像生成|图片生成|image\\s*(?:gen|generation))", modalities: ["image"], note: "display name says image generation" },
  { id: "name.video", pattern: "(?:视频生成|文生视频|图生视频|生成视频|video\\s*(?:gen|generation))", modalities: ["video"], note: "display name says video generation" },
  { id: "name.tts", pattern: "(?:语音合成|配音|朗读|text[- ]?to[- ]?speech|speech\\s*synth)", modalities: ["tts"], note: "display name says speech synthesis" },
  { id: "name.music", pattern: "(?:音乐生成|作曲|编曲|配乐|music\\s*(?:gen|generation))", modalities: ["music"], note: "display name says music generation" },
  { id: "name.vision", pattern: "(?:视觉理解|图像理解|视频理解|多模态|视觉)", modalities: ["text", "vision"], note: "display name says it understands images" },
];

const ALL_DEFAULT_RULES = [
  ...NAME_RULES.map((r) => ({ ...r, level: "name" })),
  ...DEFAULT_RULES.map((r) => ({ ...r, level: "rule" })),
  ...FAMILY_RULES.map((r) => ({ ...r, level: "family" })),
];

/** Coerce anything the user may have typed into a clean modality list. */
export function normalizeModalities(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const m = String(raw || "").trim().toLowerCase();
    if (MODALITY_SET.has(m) && !out.includes(m)) out.push(m);
  }
  return out;
}

/** Canonical `provider:id` key used by the override file and the UI. */
export function normalizeModelKey(provider, id) {
  return `${String(provider || "").trim()}:${String(id || "").trim()}`;
}

export function hasModality(model, modality) {
  if (!model) return false;
  const list = Array.isArray(model.modalities) ? model.modalities : [model.type];
  return list.includes(modality);
}

/** Primary label for a modality set: generators first, chat models are text. */
export function primaryOf(modalities) {
  const list = normalizeModalities(modalities);
  for (const m of GENERATION_MODALITIES) if (list.includes(m)) return m;
  if (list.includes("text")) return "text";
  return list[0] || "text";
}

function compileRules(extraRules) {
  const compiled = [];
  for (const rule of [...(Array.isArray(extraRules) ? extraRules : [])]) {
    if (!rule || !rule.pattern) continue;
    const modalities = normalizeModalities(rule.modalities);
    if (modalities.length === 0) continue;
    try {
      compiled.push({
        id: rule.id || rule.pattern,
        re: new RegExp(rule.pattern, rule.flags && rule.flags.includes("i") === false ? rule.flags : "i"),
        modalities,
        level: rule.level === "family" ? "family" : "rule",
        note: rule.note || "",
      });
    } catch (_) {
      // A hand-written regex that does not compile must never break discovery.
    }
  }
  return compiled;
}

/**
 * Match a model id against the rule tables.
 * User rules run before the built-ins so a local convention can win.
 */
function matchRules(id, name, userRules) {
  const haystack = String(id || "");
  const fallbackHaystack = String(name || "");
  for (const rule of compileRules(userRules)) {
    if (rule.re.test(haystack) || (fallbackHaystack && rule.re.test(fallbackHaystack))) {
      return { level: rule.level, id: rule.id, modalities: rule.modalities, note: rule.note };
    }
  }
  for (const rule of ALL_DEFAULT_RULES) {
    const re = new RegExp(rule.pattern, "i");
    if (re.test(haystack) || (fallbackHaystack && re.test(fallbackHaystack))) {
      return { level: rule.level, id: rule.id, modalities: rule.modalities, note: rule.note };
    }
  }
  return null;
}

/** pi-ai's own `model.input` / `model.output` declarations. */
function declaredEvidence(meta) {
  const input = normalizeModalities(meta?.input).map((m) => (m === "image" ? "vision" : m));
  const output = normalizeModalities(meta?.output);
  const out = { generation: [], vision: false, text: false, found: false };
  if (Array.isArray(meta?.input)) {
    out.found = true;
    if (input.includes("text")) out.text = true;
    if (input.includes("vision") || normalizeModalities(meta.input).includes("image")) out.vision = true;
    if (input.includes("audio")) out.generation.push("tts");
    if (input.includes("video")) out.text = true;
  }
  if (Array.isArray(meta?.output)) {
    out.found = true;
    const rawOutput = normalizeModalities(meta.output);
    if (rawOutput.includes("image")) out.generation.push("image");
    if (rawOutput.includes("video")) out.generation.push("video");
    if (rawOutput.includes("audio")) out.generation.push("tts");
    if (rawOutput.includes("text")) out.text = true;
  }
  return out;
}

/** Metadata returned by an OpenAI-compatible `GET {baseURL}/models`. */
export function providerEvidence(meta) {
  const out = { generation: [], vision: false, text: false, found: false };
  if (!meta) return out;
  const arch = meta.architecture || meta.modalities || {};
  const inputs = normalizeModalities(arch.input_modalities || arch.input || meta.input);
  const outputs = normalizeModalities(arch.output_modalities || arch.output || meta.output);
  const caps = Array.isArray(meta.capabilities) ? meta.capabilities.map((c) => String(c).toLowerCase()) : [];
  if (inputs.length || outputs.length || caps.length) out.found = true;
  if (inputs.includes("image")) out.vision = true;
  if (outputs.includes("image")) out.generation.push("image");
  if (outputs.includes("video")) out.generation.push("video");
  if (outputs.includes("audio") || caps.includes("tts") || caps.includes("text-to-speech")) out.generation.push("tts");
  if (caps.includes("vision") || caps.includes("image-input")) out.vision = true;
  if (caps.includes("image-generation")) out.generation.push("image");
  if (caps.includes("video-generation")) out.generation.push("video");
  return out;
}

/**
 * Resolve one model's capabilities from every layer of evidence.
 *
 * @param {object} input
 * @param {string} input.id           model id
 * @param {string} [input.name]       display name (also searched by rules)
 * @param {object} [input.meta]       pi-ai model row (`input`, `output`, …)
 * @param {object} [input.override]   `{ modalities: string[] }` pinned by the user
 * @param {object} [input.providerMeta] metadata from `GET {baseURL}/models`
 * @param {Array}  [input.rules]      user rule rows (`{ id, pattern, modalities }`)
 * @returns {{modalities: string[], primary: string, confidence: number, sources: Array<{level: string, id?: string, detail?: string}>}}
 */
export function resolveCapabilities(input = {}) {
  const id = String(input.id || "");
  const name = String(input.name || "");
  const sources = [];

  // 1) user override — final word.
  const overrideModalities = normalizeModalities(input.override?.modalities);
  if (overrideModalities.length > 0) {
    return {
      modalities: overrideModalities,
      primary: primaryOf(overrideModalities),
      confidence: LEVEL_CONFIDENCE.override,
      sources: [{ level: "override", detail: "pinned by the user" }],
    };
  }

  const declared = declaredEvidence(input.meta);
  const provider = providerEvidence(input.providerMeta);
  const rule = matchRules(id, name, input.rules);

  if (declared.found) sources.push({ level: "declared", detail: describeDeclared(input.meta) });
  if (provider.found) sources.push({ level: "provider", detail: "GET /models metadata" });
  if (rule) sources.push({ level: rule.level, id: rule.id, detail: rule.note });

  // 2) generation modalities win outright: an image/video/tts/music model is
  //    never a chat target.
  const generation = [];
  const addGen = (list) => {
    for (const m of list || []) if (!generation.includes(m)) generation.push(m);
  };
  if (rule && rule.modalities.some((m) => GENERATION_MODALITIES.includes(m))) {
    addGen(rule.modalities.filter((m) => GENERATION_MODALITIES.includes(m)));
  }
  addGen(declared.generation);
  addGen(provider.generation);

  if (generation.length > 0) {
    const modalities = normalizeModalities(generation);
    const confidence = confidenceFor(sources, LEVEL_CONFIDENCE.rule);
    return { modalities, primary: primaryOf(modalities), confidence, sources };
  }

  // 3) chat modalities: text always, vision when any layer says images work.
  const modalities = ["text"];
  const visionEvidence =
    (rule && rule.modalities.includes("vision")) || declared.vision || provider.vision;
  if (visionEvidence) modalities.push("vision");

  if (sources.length === 0) {
    return {
      modalities: ["text"],
      primary: "text",
      confidence: LEVEL_CONFIDENCE.fallback,
      sources: [{ level: "fallback", detail: "no capability evidence; treated as text" }],
    };
  }
  return {
    modalities,
    primary: primaryOf(modalities),
    confidence: confidenceFor(sources, LEVEL_CONFIDENCE.fallback),
    sources,
  };
}

function describeDeclared(meta) {
  const parts = [];
  if (Array.isArray(meta?.input)) parts.push(`input=[${meta.input.join(",")}]`);
  if (Array.isArray(meta?.output)) parts.push(`output=[${meta.output.join(",")}]`);
  return parts.join(" ") || "declared in llm-pi-ai";
}

function confidenceFor(sources, fallback) {
  let best = fallback;
  for (const s of sources) {
    const c = LEVEL_CONFIDENCE[s.level] ?? fallback;
    if (c > best) best = c;
  }
  return best;
}

/**
 * Pick the model row for one tool call.
 *
 * Semantics changed in 0.4 on purpose:
 *   - an explicit `requestedId` is looked up in EVERY row (id / name /
 *     `provider:id` / `provider/id`). A hit is used even when the resolver
 *     did not label it with that modality — the user's word beats the
 *     classifier, and `capabilityMismatch` lets the tool warn instead of
 *     silently calling something else;
 *   - a miss returns `model: null` + `requestedButMissing: true`. The old
 *     silent fallback ("you asked for X, here is Y") was the single most
 *     confusing behaviour of 0.3.
 */
export function pickModel(rows, modality, requestedId) {
  const all = Array.isArray(rows) ? rows : [];
  const want = String(modality || "");
  const req = String(requestedId || "").trim();
  if (req) {
    const exact =
      all.find((m) => m.id === req) ||
      all.find((m) => m.name === req) ||
      all.find((m) => normalizeModelKey(m.provider, m.id) === req) ||
      all.find((m) => `${m.provider}/${m.id}` === req) ||
      null;
    if (exact) {
      return {
        model: exact,
        requestedButMissing: false,
        capabilityMismatch: !hasModality(exact, want),
      };
    }
    return { model: null, requestedButMissing: true, capabilityMismatch: true };
  }
  const auto = all.find((m) => hasModality(m, want)) || null;
  return { model: auto, requestedButMissing: false, capabilityMismatch: false };
}

/** Human-readable candidate list for "model not found" errors. */
export function describeCandidates(rows, modality, limit = 8) {
  const matches = (Array.isArray(rows) ? rows : []).filter((m) => {
    // Rows from discoverModels already carry `modalities`; a bare row (a
    // fixture, or a caller listing what the config declares) is resolved on
    // the spot so the candidate list can never disagree with the selection.
    if (Array.isArray(m?.modalities) && m.modalities.length > 0) return hasModality(m, modality);
    return hasModality(resolveCapabilities({ id: m?.id, name: m?.name }), modality);
  });
  if (matches.length === 0) return "";
  return matches
    .slice(0, limit)
    .map((m) => `- ${m.provider}:${m.id}${m.name && m.name !== m.id ? ` (${m.name})` : ""}`)
    .join("\n");
}

// ── Override store ────────────────────────────────────────────────────────

/** `<profileDir>/llm-multimodal-capabilities.json`, from the patch path. */
export function capabilityStorePath(profilePatchFile) {
  if (profilePatchFile) return joinPath(dirnameOf(profilePatchFile), "llm-multimodal-capabilities.json");
  const home = process.env.DSH_HOME || joinHome(".dsh");
  return joinPath(home, "llm-multimodal-capabilities.json");
}

// Tiny path helpers so this module stays dependency-free (node:path is
// imported by the caller on the host, but tests stub the store path).
function dirnameOf(p) {
  const s = String(p);
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i > 0 ? s.slice(0, i) : ".";
}
function joinPath(a, b) {
  return `${String(a).replace(/[\\/]+$/, "")}/${b}`;
}
function joinHome(rel) {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return joinPath(home, rel);
}

/** Read `{ overrides, rules }`; a missing or broken file is simply empty. */
export async function loadCapabilityStore(filePath, readFile) {
  const empty = { overrides: {}, rules: [] };
  if (!filePath) return empty;
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeStore(parsed);
  } catch (_) {
    return empty;
  }
}

export function normalizeStore(parsed) {
  const overrides = {};
  if (parsed && typeof parsed.overrides === "object" && parsed.overrides) {
    for (const [key, value] of Object.entries(parsed.overrides)) {
      const modalities = normalizeModalities(value?.modalities);
      if (modalities.length === 0) continue;
      overrides[key] = { modalities, updatedAt: value?.updatedAt || "" };
    }
  }
  const rules = Array.isArray(parsed?.rules)
    ? parsed.rules
        .filter((r) => r && typeof r.pattern === "string" && normalizeModalities(r.modalities).length)
        .map((r) => ({
          id: String(r.id || r.pattern),
          pattern: String(r.pattern),
          modalities: normalizeModalities(r.modalities),
          note: typeof r.note === "string" ? r.note : "",
        }))
    : [];
  return { overrides, rules };
}

export async function saveCapabilityStore(filePath, store, writeFile, mkdir) {
  const normalized = normalizeStore(store);
  const body = `${JSON.stringify(normalized, null, 2)}\n`;
  const dir = dirnameOf(filePath);
  if (mkdir) await mkdir(dir, { recursive: true }).catch(() => {});
  await writeFile(filePath, body, "utf8");
  return normalized;
}

/** Set (or clear, with `[]`) one model's pinned modalities. */
export function applyOverrideEntry(store, key, modalities) {
  const next = normalizeStore(store);
  const list = normalizeModalities(modalities);
  if (list.length === 0) delete next.overrides[key];
  else next.overrides[key] = { modalities: list, updatedAt: new Date().toISOString() };
  return next;
}

// ── Live provider introspection ───────────────────────────────────────────

/**
 * GET {baseURL}/models and index the rows by model id.
 *
 * Never throws: an unreachable service degrades to an empty index, because
 * classification must keep working offline (the pi-ai config alone is
 * usually enough).
 */
export async function fetchProviderCatalog(baseURL, apiKey, { timeoutMs = 3000, fetchImpl } = {}) {
  const byId = {};
  if (!baseURL) return { ok: false, models: 0, byId, error: "provider has no baseURL" };
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") return { ok: false, models: 0, byId, error: "fetch unavailable" };
  const url = String(baseURL).replace(/\/+$/, "") + "/models";
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await doFetch(url, {
      method: "GET",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller ? controller.signal : undefined,
    });
    if (!res.ok) return { ok: false, models: 0, byId, error: `HTTP ${res.status}` };
    const body = await res.json();
    const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    for (const row of rows) {
      const id = row && (row.id || row.name);
      if (!id) continue;
      byId[String(id)] = row;
    }
    return { ok: true, models: Object.keys(byId).length, byId };
  } catch (e) {
    return { ok: false, models: 0, byId, error: e?.name === "AbortError" ? "timeout" : e?.message || String(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── In-memory provider metadata cache (shared by discover + /detect) ──────

const providerCache = new Map();

export function setProviderMeta(provider, byId) {
  providerCache.set(String(provider), { byId: byId || {}, at: Date.now() });
}

export function getProviderMeta(provider) {
  return providerCache.get(String(provider))?.byId || null;
}

export function clearProviderMeta() {
  providerCache.clear();
}

/** The default rule table, exposed so the UI/tests can show what ships. */
export function defaultRules() {
  return ALL_DEFAULT_RULES.map((r) => ({ id: r.id, pattern: r.pattern, modalities: r.modalities, level: r.level, note: r.note }));
}
