# dsh-llm-multimodal

[![中文](https://img.shields.io/badge/lang-zh-CN-blue)](./README.md) [![English](https://img.shields.io/badge/language-English-lightgrey)](./README.en.md) [![npm](https://img.shields.io/npm/v/dsh-llm-multimodal)](https://www.npmjs.com/package/dsh-llm-multimodal)

> **DSH plugin: six generation tools for text / image / video / vision / speech / music, backed by OpenAI-compatible APIs.**

`generate_text` / `generate_image` / `generate_video` / `generate_vision` / `generate_tts` / `generate_music` are auto-discovered from the existing `llm-pi-ai` settings. Any model whose id contains image / flux / dall / imagen / sdxl / realesrgan / juggernaut / photoreal / video / sora / seedance / kling / veo / runway / pika / wan / ltx / cogvideox / seedvr / musetalk / lipsync / vision / qwen-vl / llava / internvl / pixtral / glm-4v / tts / speech / voice / minimax / voxcpm / cosyvoice / music / song / lyric becomes an available tool target automatically.

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

Supports duration (4–15s) and aspect ratio (16:9 / 9:16 / 1:1, …), first/last-frame keyframe mode, and image-array reference mode.

### Vision understanding
`generate_vision` speaks the OpenAI-compatible multimodal `/chat/completions` protocol (text + image_url parts) and accepts multiple images per call (Data URI Base64, `file://`, or absolute local paths are converted to Data URIs automatically):

GPT-4o Vision / Claude 3 Vision / Gemini Vision / Qwen-VL / LLaVA / InternVL / Pixtral / PaliGemma / GLM-4V / Mantis …

Supports `detail` (low / high / auto, OpenAI token-cost hint), `history` (multi-turn visual chat), and `temperature` / `top_p` sampling.

### Text generation
`generate_text` routes through the harness LlmRuntime (`ctx.llm.prepareCall`), so the harness handles multi-protocol routing and it is not restricted to OpenAI. Model ids use the `<provider>/<model>` shape.

## Configuration

1. Add a provider in **Settings > Models** with a `baseURL` pointing to your API gateway
2. Make sure the model id contains image / video keywords so the plugin auto-discovers it
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

## Usage

Call tools directly in DSH chat:

- Text: ask a question; the assistant will call `generate_text`
- Image: describe the image you want; the assistant will call `generate_image`
- Video: describe the video you want; the assistant will call `generate_video`
- Vision: attach or point at images and ask about them; the assistant will call `generate_vision`
- Speech: `generate_tts` (text → speech) and `generate_music` (music / BGM / SFX, same OpenAI-compatible `/audio/speech` endpoint)

The tools auto-discover available models from configuration; no extra parameters required.

### Speech synthesis and voice cloning

- **Modality-separated models**: `generate_tts` only uses TTS-classified models (id contains `tts/speech/voice/minimax/voxcpm/cosyvoice`); `generate_music` only uses music-classified models (id contains `music/song/lyric`). Neither serves the other
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
