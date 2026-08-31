/**
 * dsh-llm-multimodal — host half (Node).
 *
 * Registers two model-facing tools that hit any OpenAI-compatible
 * `/images/generations` and `/videos/generations` endpoint:
 *   - generate_image  → POST {baseURL}/images/generations
 *   - generate_video  → POST {baseURL}/videos/generations  (preferred)
 *                         ↳ fallback: POST {baseURL}/chat/completions
 *
 * Provider sources:
 *   1. Auto-discovery from the existing `llm-pi-ai` settings namespace —
 *      any configured model whose id matches image/video keywords becomes
 *      an available tool target WITHOUT any extra configuration.
 *   2. The credentials service resolves `apiKeyEnv` to the actual key.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

export const name = "dsh-llm-multimodal";
export const inject = ["tools", "credentials"];

// ── Settings loader (reads llm-pi-ai from disk) ──────────────────────────────

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

// ── API key resolution ──────────────────────────────────────────────────────

async function resolveApiKey(credentials, apiKeyEnv) {
  if (!apiKeyEnv) return "";
  // 1. Try the credentials service (which layers env + .credentials.yaml + .env)
  try {
    if (credentials && typeof credentials.resolve === "function") {
      const resolved = await credentials.resolve(apiKeyEnv);
      if (resolved && resolved.value) return resolved.value;
    }
  } catch (_) { /* fall through */ }
  // 2. Fallback to direct process.env (covers the DSH web launch shell)
  return process.env[apiKeyEnv] || "";
}

// ── LLM client factory ──────────────────────────────────────────────────────

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

  /**
   * Agnes video models have divergent API contracts:
   *   - agnes-video-v2.0, agnes-video-2.5:   mode=ti2vid, GET /v1/videos/{id}
   *   - agnes-video-2.5-flash:              mode=text,   size must be "720P",
   *                                         GET /agnesapi?video_id={vid}&model_name={model}
   */
  const isAgnesFlash = /agnes-video-2\.5-flash/i.test(modelId || "");

  return {
    images: {
      generate: (params) =>
        fetchJson(base + "images/generations", {
          method: "POST", headers: jsonHeaders, body: JSON.stringify(params)
        }),
    },
    videos: {
      // Agnes-style: POST {base}/videos
      generate: (params) => {
        const body = { mode: isAgnesFlash ? "text" : "ti2vid", ...params };
        if (isAgnesFlash) body.size = "720P";
        return fetchJson(base + "videos", {
          method: "POST", headers: jsonHeaders, body: JSON.stringify(body)
        });
      },
      // Agnes Flash uses /agnesapi?video_id=...&model_name=... for polling.
      // Other models use the standard GET /v1/videos/{task_id}.
      retrieve: (taskId) => {
        if (isAgnesFlash) {
          // Agnes Flash uses video_id, not task_id
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
  };
}

// ── Auto-discovery ──────────────────────────────────────────────────────────

const IMG_KEYWORDS = ["image", "flux", "dall", "imagen", "midjourney", "sdxl", "sd-", "kandinsky"];
const VID_KEYWORDS = ["video", "sora", "seedance", "kling", "veo", "runway", "pika", "hunyuan-video", "cogvideo"];

function classifyModelId(id) {
  const m = (id || "").toLowerCase();
  if (VID_KEYWORDS.some(k => m.includes(k))) return "video";
  if (IMG_KEYWORDS.some(k => m.includes(k))) return "image";
  return null;
}

/**
 * Read the llm-pi-ai section, resolve each provider's API key (from
 * credentials service or process.env), and flatten to one row per model.
 */
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
      if (!type) continue;
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
  return models.find(m => m.type === type) || null;
}

// ── Video URL extraction ────────────────────────────────────────────────────

function extractFirstVideoUrl(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(/https?:\/\/[^\s"']+\.(mp4|mov|webm|m3u8)(\?[^\s"']*)?/i);
  return m ? m[0] : null;
}

// ── Plugin apply ─────────────────────────────────────────────────────────────

export async function apply(ctx) {
  const tools = ctx.tools;
  const credentials = ctx.credentials;

  // ── generate_image ──────────────────────────────────────────────────────

  tools.register(defineTool({
    name: "generate_image",
    description: "通过 OpenAI 兼容 API 生成图像。支持 DALL-E、Flux、Imagen、Midjourney 及任何 OpenAI 兼容的图像生成端点。模型自动从当前 LLM 配置中发现：模型 id 包含 image / dall / flux / imagen / sdxl / midjourney 等关键字即可。如未发现任何可用模型，会提示用户去「设置 > 模型」中配置。",
    parameters: {
      prompt:  { type: "string", required: true, description: "图像生成的文本提示词" },
      model:   { type: "string", description: "模型 ID，留空则使用第一个可用模型" },
      size:    { type: "string", description: "图像尺寸，如 1024x1024、1792x1024、1024x1792", default: "1024x1024" },
      quality: { type: "string", description: "质量，如 standard/hd/auto", default: "standard" },
      n:       { type: "integer", description: "生成数量", default: 1 }
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_, v) => [{ type: "text", text: v.message || "图像已生成" }]
    },
    async execute(args) {
      const models = await discoverModels(credentials);
      const imgModels = models.filter(m => m.type === "image");
      if (!imgModels.length) {
        return {
          success: false,
          message: "未发现可用的图像生成模型。请到「设置 > 模型」中配置一个大模型：模型 id 需要包含 image / dall / flux / imagen / sdxl / midjourney 等关键字之一。配置完成后，generate_image 工具会自动识别。"
        };
      }
      const model = pickModel(imgModels, "image", args.model);
      if (!model) return { success: false, message: "未找到模型: " + args.model };
      if (!model.apiKey) {
        const envName = model.apiKeyEnv || "API_KEY";
        return {
          success: false,
          message: "模型 " + model.id + " 已自动发现，但当前 dsh web 进程 " + envName + " 环境变量未设置。请在启动 dsh web 的 shell 里执行 export " + envName + "=<your-key> 后重启 dsh web，或在「设置 > 模型」中切换为 apiKey 模式直接填写。"
        };
      }
      try {
        const { ok, body } = await createClient(model.baseURL, model.apiKey, model.id).images.generate({
          model: model.id,
          prompt: args.prompt,
          n: args.n || 1,
          size: args.size || "1024x1024"
          // NOTE: `quality` is intentionally omitted — some providers
          // (e.g. Agnes) reject it with "quality is not supported by
          // text image queue". OpenAI-compatible providers that DO honor
          // it can be added back via a per-provider opt-in.
        });
        if (!ok) {
          return { success: false, message: "图像生成失败: HTTP " + (body?.error?.message || JSON.stringify(body).slice(0, 200)) };
        }
        const data = body?.data;
        if (Array.isArray(data) && data.length > 0) {
          const imgs = data.map(img => {
            if (img.url) return { type: "url", url: img.url };
            if (img.b64_json) return { type: "base64", mimeType: "image/png", data: img.b64_json };
            return null;
          }).filter(Boolean);
          const urls = imgs.filter(i => i.type === "url").map(i => i.url).join(", ");
          return {
            success: true,
            message: "图像生成成功" + (urls ? " | " + urls : ""),
            images: imgs
          };
        }
        if (body?.url || body?.b64_json) {
          const img = body.url
            ? { type: "url", url: body.url }
            : { type: "base64", mimeType: "image/png", data: body.b64_json };
          return { success: true, message: "图像生成成功 | " + (body.url || "(base64)"), images: [img] };
        }
        return { success: false, message: "图像生成失败: 无返回数据。响应: " + JSON.stringify(body).slice(0, 200) };
      } catch (e) {
        return { success: false, message: "图像生成失败: " + e.message };
      }
    }
  }));

  // ── generate_video ──────────────────────────────────────────────────────

  tools.register(defineTool({
    name: "generate_video",
    description: "通过 OpenAI 兼容 API 生成视频。支持 Sora、Seedance、Kling、Veo、Runway、Pika 等视频生成模型。优先尝试 POST /videos/generations，回退到 /chat/completions（部分 provider 用 chat 端点）。模型自动从当前 LLM 配置中发现：模型 id 包含 video / sora / seedance / kling / veo / runway / pika 等关键字即可。",
    parameters: {
      prompt:    { type: "string", required: true, description: "视频生成的文本提示词" },
      model:     { type: "string", description: "模型 ID，留空则使用第一个可用模型" },
      duration:  { type: "integer", description: "视频时长（秒）", default: 5 },
      size:      { type: "string", description: "视频尺寸，如 1280x720、1920x1080", default: "1280x720" }
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_, v) => [{ type: "text", text: v.message || "视频已生成" }]
    },
    async execute(args) {
      const models = await discoverModels(credentials);
      const vidModels = models.filter(m => m.type === "video");
      if (!vidModels.length) {
        return {
          success: false,
          message: "未发现可用的视频生成模型。请到「设置 > 模型」中配置一个大模型：模型 id 需要包含 video / sora / seedance / kling / veo / runway / pika 等关键字之一。配置完成后，generate_video 工具会自动识别。"
        };
      }
      const model = pickModel(vidModels, "video", args.model);
      if (!model) return { success: false, message: "未找到模型: " + args.model };
      if (!model.apiKey) {
        const envName = model.apiKeyEnv || "API_KEY";
        return {
          success: false,
          message: "模型 " + model.id + " 已自动发现，但当前 dsh web 进程 " + envName + " 环境变量未设置。请在启动 dsh web 的 shell 里执行 export " + envName + "=<your-key> 后重启 dsh web，或在「设置 > 模型」中切换为 apiKey 模式直接填写。"
        };
      }

      const client = createClient(model.baseURL, model.apiKey, model.id);

      /**
       * If the first attempt hits "invalid mode", some providers (notably Agnes)
       * ship multiple video models where only one supports the /videos endpoint.
       * This scans the provider's other video models and retries with a known-
       * compatible one.
       */
      async function discoverCompatibleModel(credentials, provider, baseURL, apiKey, altId) {
        const providers = await readPiAiProviders();
        const p = providers[provider];
        if (!p || !Array.isArray(p.models)) return null;
        for (const m of p.models) {
          if (m.id === altId) continue;
          const type = classifyModelId(m.id);
          if (type !== "video") continue;
          const key = await resolveApiKey(credentials, p.apiKeyEnv);
          if (!key) continue;
          return { ...m, type, baseURL, apiKey: key, apiKeyEnv: p.apiKeyEnv };
        }
        return null;
      }

      // Agnes-style endpoint expects: { model, prompt, seconds (STRING), size } (no duration).
      // OpenAI Sora expects: { model, prompt, duration, size } on /videos/generations.
      // For Flash, size is forced to "720P" inside createClient. Pass minimal body.
      const agnesBody = {
        model: model.id,
        prompt: args.prompt,
        seconds: String(args.duration || 5)
      };
      const openAIBody = {
        model: model.id,
        prompt: args.prompt,
        duration: args.duration || 5,
        size: args.size || "1280x720"
      };

      /**
       * Poll a task until it reaches a terminal status, then return the URL.
       * Agnes returns status in { queued, processing, succeeded, failed } with
       * progress percentage and a `url` field on success.
       */
      async function pollForVideo(taskId, retrieve) {
        const POLL_INTERVAL_MS = 5_000;
        const MAX_POLLS = 60; // ~5 minutes total
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

      // Strategy 1: Agnes-style /videos endpoint (POST {base}/videos, mode=ti2vid auto-added)
      try {
        const { ok, body } = await client.videos.generate(agnesBody);
        if (ok) {
          const url = body?.url || body?.video?.url || extractFirstVideoUrl(JSON.stringify(body));
          if (url) return { success: true, message: "视频生成成功 | " + url, videoUrl: url, response: body };
          const taskId = body?.video_id || body?.id || body?.task_id || body?.job_id;
          if (taskId) {
            try {
              const polled = await pollForVideo(taskId, client.videos.retrieve);
              return { success: true, message: "视频生成成功 | " + polled.url, videoUrl: polled.url, response: polled.response };
            } catch (e) {
              return { success: false, message: e.message, taskId, response: body };
            }
          }
          // ok=true but no URL/taskId — treat as endpoint not really supported, fall through
        } else {
          // Non-OK response. Continue only if the error explicitly says "use another endpoint".
          const msg = (body?.error?.message || "").toLowerCase();
          const shouldFallThrough = /invalid url|not found|invalid request|invalid mode|is a video model|use \/v1\/videos/.test(msg);
          if (!shouldFallThrough) {
            return { success: false, message: "视频生成失败: " + (body?.error?.message || JSON.stringify(body).slice(0, 200)) };
          }
        }
      } catch (_) { /* fall through */ }

      // Strategy 2: OpenAI Sora-style /videos/generations endpoint
      try {
        const { ok, body } = await client.videosOpenAI.generate(openAIBody);
        if (ok) {
          const url = body?.url || body?.video?.url || extractFirstVideoUrl(JSON.stringify(body));
          if (url) return { success: true, message: "视频生成成功 | " + url, videoUrl: url, response: body };
          const taskId = body?.video_id || body?.id || body?.task_id || body?.job_id;
          if (taskId) {
            try {
              const polled = await pollForVideo(taskId, client.videosOpenAI.retrieve);
              return { success: true, message: "视频生成成功 | " + polled.url, videoUrl: polled.url, response: polled.response };
            } catch (e) {
              return { success: false, message: e.message, taskId, response: body };
            }
          }
        } else {
          const msg = (body?.error?.message || "").toLowerCase();
          const shouldFallThrough = /invalid url|not found|invalid request|is a video model|use \/v1\/videos/.test(msg);
          if (!shouldFallThrough) {
            return { success: false, message: "视频生成失败: " + (body?.error?.message || JSON.stringify(body).slice(0, 200)) };
          }
        }
      } catch (_) { /* fall through */ }

      // Strategy 3: chat completions with mode=video_generation (some Sora-style providers)
      try {
        const { ok, body } = await client.chat.completions.create({
          model: model.id,
          messages: [{ role: "user", content: args.prompt }],
          extraBody: {
            mode: "video_generation",
            duration: args.duration || 5,
            size: args.size || "1280x720"
          }
        });
        if (ok) {
          const content = body?.choices?.[0]?.message?.content ?? null;
          const url = extractFirstVideoUrl(content || "") || extractFirstVideoUrl(JSON.stringify(body));
          if (url) return { success: true, message: "视频生成成功 | " + url, videoUrl: url, response: body };
          if (content) return { success: false, message: "视频生成返回了文本但无视频 URL: " + content.slice(0, 200) };
        }
        return {
          success: false,
          message: "视频生成失败: 端点 " + model.baseURL + " 未返回可用视频数据。HTTP " + (body?.error?.message || JSON.stringify(body).slice(0, 200))
        };
      } catch (e) {
        return { success: false, message: "视频生成失败: " + e.message };
      }
    }
  }));
}
