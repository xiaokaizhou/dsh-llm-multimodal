# dsh-llm-multimodal

[![中文](https://img.shields.io/badge/语言-中文-blue)](./README.md) [![English](https://img.shields.io/badge/language-English-lightgrey)](./README.en.md) [![npm](https://img.shields.io/npm/v/dsh-llm-multimodal)](https://www.npmjs.com/package/dsh-llm-multimodal)

> **DSH 插件：在聊天中提供图像/视频生成工具，基于 OpenAI 兼容 API。**

`generate_image` / `generate_video` 两个工具会自动从 `llm-pi-ai` 设置中识别可用模型：模型 id 包含 image / flux / dall / imagen / sdxl / video / sora / seedance / kling / veo / runway / pika 等关键词时，工具即可使用。

## 安装

```bash
# 进入 DSH web profile
cd ~/.dsh/profiles/web

# 方式一（推荐）：dsh 官方命令（自动写入 bundles 与 cordis.patch.yml）
dsh plugin --profile web add xiaokaizhou/dsh-llm-multimodal

# 方式二：pnpm 直装（需手动补一步，见下方说明）
pnpm add xiaokaizhou/dsh-llm-multimodal
```

`package.json` 位于 DSH profile 根目录：

- 默认路径：`~/.dsh/profiles/web/package.json`（macOS / Linux）
- Windows：`%USERPROFILE%\.dsh\profiles\web\package.json`
- 自定义路径：`$DSH_HOME/profiles/web/package.json`
- 如有多个 profile，对应路径为 `~/.dsh/profiles/<profile-name>/package.json`

方式二手动补全：在上面的 `package.json` 中添加：

```json
"dsh": {
  "profile": {
    "bundles": [
      "dsh-llm-multimodal"
    ]
  }
}
```

源码修改后需重启 `dsh web`。

## 支持模型

### 图像生成
支持任何 OpenAI 兼容的 `/images/generations` 端点，已适配：

DALL-E / Flux / Imagen / Midjourney / SDXL / Kandinsky

### 视频生成
支持 OpenAI Sora 风格 `/videos/generations` 与 Agnes 风格 `/videos`，已适配：

Sora / Seedance / Kling / Veo / Runway / Pika / Hunyuan Video / CogVideo

## 配置说明

1. 在「设置 > 模型」中添加一个 provider，`baseURL` 指向你的 API 网关
2. 在模型 id 中包含 image / video 关键词，插件会自动识别
3. 设置 `apiKeyEnv` 环境变量，或在 provider 配置中直接填写 apiKey
4. 重启 `dsh web`

示例 `llm-pi-ai` 配置结构：

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

## 使用方式

在 DSH 对话中直接调用工具：

- 生成图像：描述你想要的画面，助手会调用 `generate_image`
- 生成视频：描述你想要的视频内容，助手会调用 `generate_video`

工具会自动从配置中发现可用模型，无需额外参数。

## 限制

- 当前版本自动 provider 配置界面已暂停；工具通过 `llm-pi-ai` 设置自动发现模型
- 视频生成采用轮询，最长等待约 5 分钟
- 需要 provider 支持 OpenAI 兼容接口

## 赞助

如果你觉得这个插件对你有帮助，欢迎打赏支持：

![微信支付](https://raw.githubusercontent.com/xiaokaizhou/dsh-llm-multimodal/main/.github/wechat-pay.jpg) ![支付宝](https://raw.githubusercontent.com/xiaokaizhou/dsh-llm-multimodal/main/.github/alipay.jpg)

## License

MIT
