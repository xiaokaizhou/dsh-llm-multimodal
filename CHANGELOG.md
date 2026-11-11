# 更新日志

本文件记录 `dsh-llm-multimodal` 的对外变更。版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## 0.5.0 — 2025-11-11

首个打 tag 的版本。相对 0.3.0（上一次发布），核心变化是**模型能力不再靠名字猜**：改为分层证据解析，并且判定结果可见、可纠正。

### 新增

- **分层能力解析引擎** `lib/capabilities.js`：每个模型解析出声明的全部模态，而不是单一标签。证据按可信度分层，低层只在高层未命中时生效：

  | 层 | 来源 | 置信度 |
  |---|---|---|
  | P0 | 人工覆盖（设置卡片/覆盖文件） | 1.00 |
  | P1 | provider 声明元数据（`input` / `output`） | 0.90 |
  | P2 | 自定义规则（`rules`） | 0.85 |
  | P3 | 规则引擎（词元边界匹配，含模型族） | 0.85 / 0.60 |
  | P4 | provider 在线元数据（`GET {baseURL}/models`） | 0.80 |
  | P5 | 兜底：纯文本 | 0.30 |

- **多标签**：一个模型可同时是 `text` + `vision`（如 `claude-*`、`gpt-5.6-*`、`gemini-3.x`、`kimi-k3`、`MiniMax-M3`），`byModality` 按多标签建桶，同一模型可出现在多个分类里。
- **人工纠正矩阵**：设置卡片新增「模型能力」，按 provider 分组列出每个模型的模态 chip、置信度与证据来源，可就地勾选保存，或清除覆盖。覆盖持久化到 `<profileDir>/llm-multimodal-capabilities.json`。
- **在线探测**：`POST /api/llm-multimodal/detect` 拉取 `GET {baseURL}/models` 的 `architecture.modality` / capabilities 并合并；探测失败只降级、不阻塞工具调用。
- **新增接口**：`GET /api/llm-multimodal/capabilities`、`POST /api/llm-multimodal/capabilities/override`、`POST /api/llm-multimodal/detect`。
- **真实目录校验器** `scripts/verify-capabilities.mjs`（`npm run verify:capabilities`）：用真实 `cordis.patch.yml` 跑 21 条期望，可 `--all` 打印全量。
- 文档：[docs/capability-resolution.md](docs/capability-resolution.md)；README 中英双语补充「模型能力解析」章节。

### 变更

- **显式指定的模型不再被静默替换**：`model` 未命中时报错并列出当前候选，而不是回落到同类型的第一个模型。
- 没有 `baseURL` 的 provider 不再整块丢弃——只要模型被判为纯文本就保留在文本池里。
- TTS / 音乐分类为空时，明确说明「没有识别到该分类的模型」，并给出三种落地方式（补模型 id、给 provider 配 baseURL、用自定义端点）。
- 模型下拉改为本地草稿 + 快照对齐 + 直写回落，消除「选中后仍显示请选择」。
- 能力矩阵与模态选择器的结构样式改为内联，样式表仅负责配色；宿主作用域化注入 CSS 时不再塌成一片文字。

### 修复

- `gemini-nano-banana-2.1`、`gemini-3-pro-image`、`flux.2-klein-4b` 等图像模型被误判为文本，导致 `generate_image` 选不到。
- `minimax/h3`、`taiwan-chat`、`wanderer-7b` 等因裸子串（`h3` / `wan` / `sd-`）被误判；规则改为词元边界匹配。
- 视觉通道因候选池为空而完全不可用（`vision` 池 0 → 32）。
- 混合网关把 `claude-*` / `gemini-*` 挂在 `/v1/messages`、`/v1beta/models/*:generateContent` 时自动挑选失败；现自动后置，并在报错里解释。
- 空候选时设置里的 `defaultModel` 救不回来；新增 `modelFromOverride` 兜底。

### 不兼容变更

- 模型行的 `type` 现在是 `primary`（生成模态优先，否则 `text`），并新增 `modalities` / `primary` / `confidence` / `sources`。
- `pickModel()` 未命中返回 `{ model: null, requestedButMissing: true }`，不再静默回退。

### 验证

- `vitest`：7 个文件 159 例通过。
- `scripts/verify-capabilities.mjs`：真实配置 75 个模型、21 条期望 **pass 21 / fail 0**。
- 运行中宿主实测：池子 `text 63 / image 8 / video 4 / vision 32 / tts 0 / music 0`；`generate_vision` 不带 `model` 自动选到 `saygm:gpt-5.4` 并正确识别红色测试图。

### 已知限制

- 语音 / 音乐池为空是**配置事实**：默认 `llm-pi-ai` 里没有任何 TTS / 音乐模型。补上 id（含 `speech` / `tts` / `voice`，或 `music` / `song` / `lyric`）并给该 provider 配 `baseURL` 即可出现。
- 设置页 UI 未经真实浏览器视觉验收（宿主 GUI 需鉴权 token，自动化无法进入）。
