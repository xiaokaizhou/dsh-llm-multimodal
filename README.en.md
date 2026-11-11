# dsh-llm-multimodal

[![中文](https://img.shields.io/badge/lang-zh-CN-blue)](./README.md) [![English](https://img.shields.io/badge/language-English-lightgrey)](./README.en.md) [![npm](https://img.shields.io/npm/v/dsh-llm-multimodal)](https://www.npmjs.com/package/dsh-llm-multimodal)

> **DSH plugin: six generation tools for text / image / video / vision / speech / music, backed by OpenAI-compatible APIs.**

`generate_text` / `generate_image` / `generate_video` / `generate_vision` / `generate_tts` / `generate_music` are auto-discovered from the existing `llm-pi-ai` settings. Every model's modalities (text / image / video / vision / tts / music) are resolved by a **layered capability resolver**: a manual pin wins, then the provider's declared metadata, then metadata probed from the provider's own model list, then family rules, and finally a text fallback. A verdict can be corrected by hand in the settings card — see [Model capability resolution](docs/capability-resolution.md).

## Companion plugins

This plugin forms a complete **generate → orchestrate → preview** loop with two sibling DSH plugins by the same author. Install them together:

| Plugin | Role | npm |
|---|---|---|
| [dsh-media-studio](https://github.com/xiaokaizhou/dsh-media-studio) | Multi-project infinite canvas: lands generated media on canvas nodes, plus a per-project asset library and global search. `canvas_refresh_node` calls back into this plugin's generators | [npm: dsh-media-studio](https://www.npmjs.com/package/dsh-media-studio) |
| [media-preview](https://github.com/xiaokaizhou/dsh-media-preview) | Renders local/online media paths in chat as playable previews (Range / caching / 27 formats) | [npm: media-preview](https://www.npmjs.com/package/media-preview) |

- **Generate + orchestrate**: `dsh-media-studio` publishes the cross-plugin `mediaStudio` service (soft reference, no hard dependency). With the default `outputStrategy=project`, this plugin's `generate_image` / `generate_video` / `generate_tts` / `generate_music` write straight into the active media-studio project's `<sourcePath>/assets/<kind>/` (images default to `character`, pass `asset_kind=scene` for backgrounds; video → `clips`; audio → `audio`). Results carry `projectId` + `canvasUrl`, so `canvas_graph_patch`'s `batchAddMedia` attaches them to canvas nodes in one step. When media-studio is absent or has no active project, the plugin falls back to the `outputDir` strategy (default `/tmp`) — install order does not matter.
- **Preview**: `media-preview` renders the `file://` paths this plugin produces as inline `<audio>` / `<video>` / `<img>` previews in chat.

## Install

```bash
# from your DSH web profile
cd ~/.dsh/profiles/web

# Option 1 (recommended): dsh CLI (auto-writes bundles and cordis.patch.yml)
dsh plugin --profile web add xiaokaizhou/dsh-llm-multimodal

# Option 2: pnpm (requires a manual step, see below)
pnpm add xiaokaizhou/dsh-llm-multimodal
```

The profile `package.json` lives at:

- Default: `~/.dsh/profiles/web/package.json` (macOS / Linux)
- Windows: `%USERPROFILE%\.dsh\profiles\web\package.json`
- Custom `$DSH_HOME`: `$DSH_HOME/profiles/web/package.json` (override via `DSH_HOME` env)
- Multiple profiles: `~/.dsh/profiles/<profile-name>/package.json` for each

For Option 2, add this to the profile `package.json` above:

```json
"dsh": {
  "profile": {
    "bundles": [
      "dsh-llm-multimodal"
    ]
  }
}
```

Restart `dsh web` after any source change.

## Supported models

### Image generation
Any OpenAI-compatible `/images/generations` endpoint. Works with:

DALL-E / Flux / Imagen / Midjourney / SDXL / Kandinsky

### Video generation
OpenAI Sora-style `/videos/generations` and Agnes-style `/videos` endpoints. Works with:

Sora / Seedance / Kling / Veo / Runway / Pika / Hunyuan Video / CogVideo / MiniMax Hailuo

Supports text-to-video, image-to-video (pass `image`), and keyframe animation (pass `keyframes` — first/last map to the provider's first_frame / last_frame); `mode` accepts `text` / `keyframe` / `reference` explicitly. `duration` defaults to 5s (Agnes 2.5 Flash accepts 4–12), and framing goes through `size` (pixels such as `1280x720` for OpenAI, tiers such as `720P` for Agnes); `negative_prompt` is also available. `num_frames` / `frame_rate` are no longer accepted — the provider picks the frame count.

### Vision understanding
`generate_vision` speaks the OpenAI-compatible multimodal `/chat/completions` protocol (text + image_url parts) and accepts multiple images per call (Data URI Base64, `file://`, or absolute local paths are converted to Data URIs automatically):

GPT-4o Vision / Claude 3 Vision / Gemini Vision / Qwen-VL / LLaVA / InternVL / Pixtral / PaliGemma / GLM-4V / Mantis …

Parameters: `prompt` (required), `images` (multiple allowed), `model`, `system`, `max_tokens` (default 1024), `temperature` (default 0.2, tuned for factual visual QA), `top_p`, and `detail` (`low` = 85 fixed tokens / `high` = per-tile cost for OCR and fine detail / `auto` = model decides).

### Text generation
`generate_text` routes through the harness LlmRuntime (`ctx.llm.prepareCall`), so the harness handles multi-protocol routing and it is not restricted to OpenAI. Model ids use the `<provider>/<model>` shape.

## Configuration

1. Add a provider in **Settings > Models** with a `baseURL` pointing to your API gateway
2. Capabilities come from the resolver: the provider's declared `input` / `output` first, then family rules; correct anything it gets wrong in the settings card
3. Set `apiKeyEnv` in your shell, or fill `apiKey` directly in provider settings
4. Restart `dsh web`

Example `llm-pi-ai` config:

```yaml
llm-pi-ai:
  providers:
    - id: openai
      baseURL: https://api.openai.com/v1
      apiKeyEnv: OPENAI_API_KEY
      models:
        - id: gpt-image-1
          name: GPT Image
    - id: agnes
      baseURL: https://api.agnes.ai/v1
      apiKeyEnv: AGNES_API_KEY
      models:
        - id: agnes-video-2.5
          name: Agnes Video
```

### Model capability resolution

A model is no longer bucketed into one label by "the id contains some keyword". Each model resolves to a *set* of modalities, by evidence priority:

| Priority | Source | Notes |
|---|---|---|
| P0 | Manual override | The set you pin in the settings card — always wins |
| P1 | Provider declaration | The `input` / `output` metadata carried by the model in `llm-pi-ai` |
| P2 | Provider metadata | Probed online from `GET {baseURL}/models` (`architecture.modality` / `capabilities`) |
| P3 | Family rules | Built-in rules plus any custom rule you add (token-boundary regexes) |
| P4 | Fallback | Nothing matched — treated as `text` |

A model may hold several modalities at once (e.g. `["text","vision"]`). The settings card shows the verdict as multi-label chips with its confidence and the evidence behind it (manual / declared / probed / rule / family / fallback), so every row answers "why is this an image model?".

**Correcting a verdict**: in **Settings > Plugins > llm-multimodal**, tick the model's modality set in place to save it; **Clear override** returns it to automatic resolution. Overrides are persisted to a file keyed by `provider:id`:

```json
{
  "overrides": {
    "acme:gemini-nano-banana-2.1": { "modalities": ["image"], "updatedAt": "2026-11-11T12:00:00.000Z" }
  },
  "rules": [
    { "id": "acme-diffusion", "pattern": "(^|[-_/])acme-diffusion-v\\d+($|[-_])", "modalities": ["image"], "note": "in-house image gateway family" }
  ]
}
```

The file lives at `<profileDir>/llm-multimodal-capabilities.json` (falling back to `~/.dsh/llm-multimodal-capabilities.json` when the profile directory cannot be derived). An empty `modalities` array clears that entry.

**Online probe**: the **Re-probe** button requests `GET {baseURL}/models` once for that provider (with the apiKey, 3 s timeout) and merges the returned modality metadata into the verdict. A failed probe never blocks a call — resolution falls back to declared / rule / fallback.

**An explicit model is never swapped silently**: a `model` argument wins, and when it matches nothing the tool fails with the candidates currently available for that modality instead of quietly using a different model.

> The full design (data structures, HTTP API, migration and known limits) is in [docs/capability-resolution.md](docs/capability-resolution.md).
>
> To check the verdicts on your own catalog, run `node scripts/verify-capabilities.mjs` — it reads the current profile's `llm-pi-ai` config and validates 21 real model ids; a non-zero exit code means a mismatch.

## Usage

Call tools directly in DSH chat:

- Text: ask a question; the assistant will call `generate_text`
- Image: describe the image you want; the assistant will call `generate_image`
- Video: describe the video you want; the assistant will call `generate_video`
- Vision: attach or point at images and ask about them; the assistant will call `generate_vision`
- Speech: `generate_tts` (text → speech) and `generate_music` (music / BGM / SFX, same OpenAI-compatible `/audio/speech` endpoint)

The tools auto-discover available models from configuration; no extra parameters required.

### Speech synthesis and voice cloning

- **Modality-separated models**: `generate_tts` only uses models resolved as `tts`, and `generate_music` only uses models resolved as `music`; neither serves the other
- **OpenAI protocol**: the five multimodal tools (image / video / vision / tts / music) speak OpenAI-compatible endpoints; providers default to `apiProtocol: openai`, and an explicit non-OpenAI protocol (e.g. `claude`) is rejected before the call with an actionable message. `generate_text` is exempt — it routes via the harness LlmRuntime (`ctx.llm.prepareCall`)
- Preset voices: pass a MiniMax preset id (e.g. `female-shaonv` / `male-qn-jingying`) as `voice`, or an existing cloned voice_id
- Per-character voice (cloning): pass `clone_audio` (reference audio: local path / `file://` / http(s) URL / `data:audio` base64) plus `voice_name` (use the character's name)
  - The first call runs "upload audio → register voice_id → speak with the cloned voice" automatically
  - Later calls with the same `voice_name` reuse the cloned voice (persisted in `~/.dsh/llm-multimodal-voices.json`) with zero extra network overhead
  - Optional `clone_voice_id` to pin a custom voice_id; `output_format` supports `mp3` / `wav` / `pcm` / `aac` / `flac` / `opus`
  - Requires a provider that supports the MiniMax-compatible `files/upload` + `voice_clone` endpoints

## Output routing (media-studio integration)

With [dsh-media-studio](https://www.npmjs.com/package/dsh-media-studio) installed (default `outputStrategy=project`), generated media no longer lands in `/tmp` but writes directly into the **active media-studio project**:

```
<project sourcePath>/assets/characters/…  # generate_image (asset_kind defaults to character; scene/prop/conceptart/reference also accepted)
<project sourcePath>/assets/clips/…       # generate_video
<project sourcePath>/assets/audio/…        # generate_tts / generate_music
```

Results carry `projectId` and `canvasUrl`; pair them with media-studio's `canvas_graph_patch` `batchAddMedia` to attach media to canvas nodes in one step. Without media-studio (or with no active project) the plugin falls back to the `outputDir` strategy (default `/tmp`) — no hard dependency.

To preview those local artifacts inline in chat, install [media-preview](https://www.npmjs.com/package/media-preview) alongside.

## Limitations

- Manual provider configuration UI is paused in this build; use `llm-pi-ai` settings for provider discovery
- Video generation uses polling and may wait up to ~10 minutes
- Provider must support an OpenAI-compatible interface (`generate_text` excepted — it routes via the harness LlmRuntime)

## Sponsorship

If this plugin saves you time, you can buy me a coffee with one of the following QR codes.

<table>
  <tr>
    <td align="center">
      <img src="https://raw.githubusercontent.com/xiaokaizhou/dsh-llm-multimodal/main/.github/wechat-pay.jpg" width="180" alt="WeChat Pay"><br>
      <strong>WeChat Pay</strong>
    </td>
    <td align="center">
      <img src="https://raw.githubusercontent.com/xiaokaizhou/dsh-llm-multimodal/main/.github/alipay.jpg" width="180" alt="Alipay"><br>
      <strong>Alipay</strong>
    </td>
  </tr>
</table>

## License

MIT
