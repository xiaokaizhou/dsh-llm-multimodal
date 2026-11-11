# dsh-llm-multimodal

[![中文](https://img.shields.io/badge/语言-中文-blue)](./README.md) [![English](https://img.shields.io/badge/language-English-lightgrey)](./README.en.md) [![npm](https://img.shields.io/npm/v/dsh-llm-multimodal)](https://www.npmjs.com/package/dsh-llm-multimodal)

> **DSH 插件：在聊天中提供文本/图像/视频/视觉理解/语音/音乐 六个生成工具，基于 OpenAI 兼容 API。**

`generate_text` / `generate_image` / `generate_video` / `generate_vision` / `generate_tts` / `generate_music` 六个工具会自动从 `llm-pi-ai` 设置中发现可用模型，并用**分层能力解析**判定每个模型支持哪些模态（text / image / video / vision / tts / music）：优先采信人工覆盖与 provider 声明，其次是服务商在线元数据与家族规则，最后兜底为文本。判定结果可在设置卡片里手动纠正 —— 详见[模型能力解析](https://github.com/xiaokaizhou/dsh-llm-multimodal/blob/main/docs/capability-resolution.md)。

## 配套插件（互推）

本插件与同作者的另外两个 DSH 插件组成「生成 → 编排 → 预览」完整闭环，建议一起安装：

| 插件 | 角色 | npm |
|---|---|---|
| [dsh-media-studio](https://github.com/xiaokaizhou/dsh-media-studio) | 多项目无限画布：把生成的媒体落到画布节点、素材库与全局搜索；`canvas_refresh_node` 会回调本插件的生成工具 | [npm: dsh-media-studio](https://www.npmjs.com/package/dsh-media-studio) |
| [media-preview](https://github.com/xiaokaizhou/dsh-media-preview) | 把聊天中的本地/在线媒体路径渲染为可播放预览（Range / 缓存 / 27 种格式） | [npm: media-preview](https://www.npmjs.com/package/media-preview) |

- 生成与编排：`dsh-media-studio` 发布跨插件服务 `mediaStudio`（软引用、无硬依赖）。本插件的 `generate_image` / `generate_video` / `generate_tts` / `generate_music` 默认 `outputStrategy=project` —— 产物直接写进活跃 media-studio 项目的 `<sourcePath>/assets/<类别>/`（图片默认 character、可传 `asset_kind=scene`；视频 clip；音频 audio），结果附带 `projectId` + `canvasUrl`，`canvas_graph_patch` 的 `batchAddMedia` 可一步挂到画布节点。media-studio 服务缺失或无活跃项目时自动回退 `outputDir`（空 → `/tmp`），安装顺序无关。
- 预览：`media-preview` 负责把本插件产出的 `file://` 路径在聊天里渲染为内联 `<audio>`/`<video>`/`<img>` 预览组件。

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

Sora / Seedance / Kling / Veo / Runway / Pika / Hunyuan Video / CogVideo / MiniMax Hailuo

支持文生视频、图生视频（传 `image`）与关键帧模式（传 `keyframes`，首帧/尾帧映射到 provider 的 first_frame / last_frame）；`mode` 可显式指定 `text` / `keyframe` / `reference`。`duration` 默认 5 秒（Agnes 2.5 Flash 接受 4–12），画幅走 `size`（OpenAI 用像素如 `1280x720`，Agnes 用档位如 `720P`）；另有 `negative_prompt`。`num_frames` / `frame_rate` 已不再接受——帧数由 provider 决定。

### 视觉理解
`generate_vision` 走 OpenAI 兼容 `/chat/completions` 多模态内容协议（text + image_url），一次可传多张图（Data URI Base64、`file://` 或绝对本地路径会自动转 Data URI）：

GPT-4o Vision / Claude 3 Vision / Gemini Vision / Qwen-VL / LLaVA / InternVL / Pixtral / PaliGemma / GLM-4V / Mantis …

参数：`prompt`（必填）、`images`（支持多张）、`model`、`system`、`max_tokens`（默认 1024）、`temperature`（默认 0.2，偏事实型视觉问答）、`top_p`、`detail`（`low` 固定 85 token / `high` 分块计费，OCR 与细节场景用 `high` / `auto` 由模型决定）。

### 文本生成
`generate_text` 走 harness 的 LlmRuntime（`ctx.llm.prepareCall`），由 harness 内部多协议路由处理，协议不受 OpenAI 限制；model id 形如 `<provider>/<model>`。

## 配置说明

1. 在「设置 > 模型」中添加一个 provider，`baseURL` 指向你的 API 网关
2. 模型能力由能力解析器判定：优先读 provider 声明的 `input` / `output`，其次匹配家族规则；判定不准时可在设置卡片里手动纠正
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

### 模型能力解析

每个模型不再靠「id 里有某个关键词」单标签归类，而是按证据优先级解析出一组模态：

| 优先级 | 来源 | 说明 |
|---|---|---|
| P0 | 人工覆盖 | 你在设置卡片里手动 pin 的能力集合，永远最高 |
| P1 | provider 声明 | `llm-pi-ai` 里模型自带的 `input` / `output` 元数据 |
| P2 | 服务商元数据 | 在线探测 `GET {baseURL}/models` 的 `architecture.modality` / `capabilities` |
| P3 | 家族规则 | 内置家族规则 + 你追加的自定义规则（词元边界正则） |
| P4 | 兜底 | 都没有时按 `text` 处理 |

模型可以同时具备多个模态（如 `["text","vision"]`），设置卡片里以多标签 chip 展示判定结果、置信度与判定来源（人工覆盖 / 声明 / 服务商 / 规则 / 家族 / 兜底），每一行都能回答「为什么判成这个模态」。

**手动纠正**：在「设置 > 插件 > llm-multimodal」的模型能力区块里，就地勾选该模型的模态集合即可保存；「清除覆盖」会让它回到自动判定。覆盖也写在文件里，键为 `provider:id`：

```json
{
  "overrides": {
    "saygm:gemini-nano-banana-2.1": { "modalities": ["image"], "updatedAt": "2026-11-11T12:00:00.000Z" }
  },
  "rules": [
    { "id": "acme-diffusion", "pattern": "(^|[-_/])acme-diffusion-v\\d+($|[-_])", "modalities": ["image"], "note": "自建图像网关家族" }
  ]
}
```

文件位置：`<profileDir>/llm-multimodal-capabilities.json`（profile 目录推导不出时回落到 `~/.dsh/llm-multimodal-capabilities.json`）。`modalities` 为空数组表示清除该条覆盖。

**在线探测**：设置卡片里的「重新探测」按钮会对该 provider 请求一次 `GET {baseURL}/models`（带 apiKey、3 秒超时），把服务端返回的模态元数据合并进判定；探测失败不阻塞使用，能力判定照常回落到声明 / 规则 / 兜底。

**显式指定模型不会被偷偷换掉**：调用时传入的 `model` 参数优先，未命中就明确报错并列出该模态当前可用候选，不再静默降级到别的模型。

> 完整设计（数据结构、HTTP API、迁移与已知边界）见 [docs/capability-resolution.md](https://github.com/xiaokaizhou/dsh-llm-multimodal/blob/main/docs/capability-resolution.md)。
>
> 想确认你自己的目录判得对不对，跑 `node scripts/verify-capabilities.mjs`（读当前 profile 的 `llm-pi-ai` 配置，校验 21 条真实模型 id，退出码非 0 表示有偏差）。

## 使用方式

在 DSH 对话中直接调用工具：

- 生成文本：直接提问，助手会调用 `generate_text`
- 生成图像：描述你想要的画面，助手会调用 `generate_image`
- 生成视频：描述你想要的视频内容，助手会调用 `generate_video`
- 视觉理解：给出图片（路径或链接）并提问，助手会调用 `generate_vision`
- 生成语音/音乐：`generate_tts`（文本 → 语音）与 `generate_music`（音乐/BGM/音效，共用 OpenAI 兼容 `/audio/speech` 端点）

工具会自动从配置中发现可用模型，无需额外参数。

### 语音合成与音色克隆

- 生成语音：`generate_tts`（文本 → 语音）与 `generate_music`（音乐/BGM/音效，共用 OpenAI 兼容 `/audio/speech` 端点）
- **模型按模态分离**：`generate_tts` 只用 TTS 类模型（id 含 `tts/speech/voice/minimax/voxcpm/cosyvoice`）；`generate_music` 只用 music 类模型（id 含 `music/song/lyric`）。TTS 模型不会服务于 music，反之亦然
- **OpenAI 协议**：5 个多模态工具（image / video / vision / tts / music）走 OpenAI 兼容端点；provider 默认 `apiProtocol: openai`；显式配置为其他协议（如 `claude`）时工具会在调用前拒绝并给出可操作提示。`generate_text` 不在此列，它走 harness 的 LlmRuntime（`ctx.llm.prepareCall`），由 harness 内部多协议路由处理
- 预设音色：`voice` 参数填 MiniMax 预设 id（如 `female-shaonv` / `male-qn-jingying`），或直接填已克隆的 voice_id
- 角色专属音色（克隆）：传 `clone_audio`（参考音频：本地路径 / `file://` / http(s) URL / `data:audio` base64）+ `voice_name`（建议用角色名）
  - 首次调用自动执行「上传音频 → 注册 voice_id → 用克隆音色朗读」
  - 后续相同 `voice_name` 调用直接复用已克隆音色（持久化在 `~/.dsh/llm-multimodal-voices.json`），零额外网络开销
  - 可选 `clone_voice_id` 自定义 voice_id；`output_format` 支持 `mp3` / `wav` / `pcm` / `aac` / `flac` / `opus`
  - 需要 provider 支持 MiniMax 兼容的 `files/upload` + `voice_clone` 接口

## 输出路由（media-studio 集成）

安装 [dsh-media-studio](https://www.npmjs.com/package/dsh-media-studio) 后（默认 `outputStrategy=project`），生成产物不再写 `/tmp`，而是直接落盘到**当前活跃 media-studio 项目**：

```
<project sourcePath>/assets/characters/…  # generate_image（默认 asset_kind=character，可传 scene/prop/conceptart/reference）
<project sourcePath>/assets/clips/…       # generate_video
<project sourcePath>/assets/audio/…        # generate_tts / generate_music
```

返回结果附带 `projectId` 与 `canvasUrl`；配合 media-studio 的 `canvas_graph_patch` `batchAddMedia`，媒体一步挂到画布节点。未安装 media-studio（或服务缺失 / 无活跃项目）时回退 `outputDir` 策略（默认 `/tmp`），零硬依赖。

想直接在聊天里看到这些本地产物的播放预览，另装 [media-preview](https://www.npmjs.com/package/media-preview)。

## 限制

- 当前版本自动 provider 配置界面已暂停；工具通过 `llm-pi-ai` 设置自动发现模型
- 视频生成采用轮询，最长等待约 10 分钟
- 需要 provider 支持 OpenAI 兼容接口（`generate_text` 除外，走 harness LlmRuntime 多协议路由）

## 打赏支持

若这个插件帮到了你，欢迎用下面的二维码请我喝杯咖啡。

<table>
  <tr>
    <td align="center">
      <img src="https://raw.githubusercontent.com/xiaokaizhou/dsh-llm-multimodal/main/.github/wechat-pay.jpg" width="180" alt="WeChat Pay"><br>
      <strong>微信支付</strong>
    </td>
    <td align="center">
      <img src="https://raw.githubusercontent.com/xiaokaizhou/dsh-llm-multimodal/main/.github/alipay.jpg" width="180" alt="Alipay"><br>
      <strong>支付宝</strong>
    </td>
  </tr>
</table>

## License

MIT
