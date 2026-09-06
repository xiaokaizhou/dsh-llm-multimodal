# dsh-llm-multimodal

[![中文](https://img.shields.io/badge/lang-zh-CN-blue)](./README.md) [![English](https://img.shields.io/badge/language-English-lightgrey)](./README.en.md) [![npm](https://img.shields.io/npm/v/dsh-llm-multimodal)](https://www.npmjs.com/package/dsh-llm-multimodal)

> **DSH plugin: provides image and video generation tools backed by OpenAI-compatible APIs.**

`generate_image` / `generate_video` are auto-discovered from the existing `llm-pi-ai` settings. Any model whose id contains image / flux / dall / imagen / sdxl / video / sora / seedance / kling / veo / runway / pika becomes an available tool target automatically.

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

Sora / Seedance / Kling / Veo / Runway / Pika / Hunyuan Video / CogVideo

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

- Image generation: describe the image you want; the assistant will call `generate_image`
- Video generation: describe the video you want; the assistant will call `generate_video`

The tools auto-discover available models from configuration; no extra parameters required.

## Limitations

- Manual provider configuration UI is paused in this build; use `llm-pi-ai` settings for provider discovery
- Video generation uses polling and may wait up to ~5 minutes
- Provider must support an OpenAI-compatible interface

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
