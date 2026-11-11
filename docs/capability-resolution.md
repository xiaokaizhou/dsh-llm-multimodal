# 模型能力解析（Capability Resolution）设计文档

> 状态：设计契约 v1 —— 与实现任务 `task-1`（`lib/capabilities.js` + `lib/index.js` 改造）对齐。
> 适用范围：`dsh-llm-multimodal` 六个生成工具（`generate_text` / `generate_image` / `generate_video` / `generate_vision` / `generate_tts` / `generate_music`）的模型能力判定与选型。
> 关键词：`capability` / `modality` / `modalities` / `primary` / `confidence` / `sources` / `override` / `declared` / `provider` / `rule` / `fallback`。

---

## 1. 问题：单标签关键词匹配撑不住真实模型目录

### 1.1 旧实现

旧实现在 `lib/index.js` 里，形态是「一张关键词表 + 一个分类函数」：

- 维护若干张关键词表：`IMG_KEYWORDS`、`VID_KEYWORDS`、`VL_KEYWORDS`、`TTS_KEYWORDS`、`MUSIC_KEYWORDS`、`TEXT_KEYWORDS`；
- `classifyModelId(id)` 用 `String.prototype.includes` 依次做**朴素子串匹配**，返回**单一**标签（`text` / `image` / `video` / `vision` / `tts` / `music`）；
- 判定输入只有 `model.id` 与 `model.name` —— pi-ai provider 自己声明的 `model.input` / `model.output` 元数据**完全没有被读取**；
- 命中顺序写死为 video → vision → image → tts → music → text，先命中者胜，`text` 是兜底。

### 1.2 实测误判（真实 provider 目录）

用用户实际 `llm-pi-ai` 配置跑一遍旧分类：

| 模型 id | 真实能力 | 旧判定 | 原因 |
|---|---|---|---|
| `gemini-nano-banana-2.1` | 图像生成 | `text` | id 里没有 image / flux / imagen 等词，但含 `gemini`，落到 TEXT_KEYWORDS 兜底 |
| `minimax/h3` | 对话（文本） | `video` | `VID_KEYWORDS` 为兼容本地 h3c 网关留了裸子串 `h3`，`minimax/h3` 因子串命中 |
| `claude-*` / `gpt-5.6-*` / `gemini-3.x` / `kimi-k3` | 文本 + 视觉理解 | `text` | `VL_KEYWORDS` 只收 `vision` / `qwen-vl` / `llava` 这类显式 VL 词，裸家族名一律判 text |
| `flux.2-klein-4b`、`agnes-image-*` | 图像 | 依赖词表条目 | 家族命名一变就漏判 |
| `google/veo-3.1-fast`、`wan-ai/wan-2.6-t2v`、`agnes-video-*` | 视频 | `video` ✓ | 恰好命中 `veo` 等既有词条 |

误判沿链路放大成四个真实故障：

1. **vision 池为空 → `generate_vision` 完全不可用。**
   `VL_KEYWORDS` 收得太窄，`claude-*` / `gpt-*` / `gemini-3.x` / `kimi-*` 全部落进 `text`，视觉候选池为空，工具直接报「未发现可用的视觉模型」。

2. **显式指定模型被静默替换。**
   `pickModel()` 在显式 id 未命中时，会回落到该模态的第一个候选并**继续调用**。用户以为出图用的是 A，实际用的是 B，只在结果里附一行警告。

3. **无 `baseURL` 的 provider 被整块丢弃。**
   `discoverModels()` 里 `if (!baseURL && type !== "text") continue;` —— 像 `minimax-cn` 这类走 harness 通道、没有 baseURL 的 provider，只要模型被误判为非 text 就整块消失。

4. **判定不可解释。**
   一个模型为什么被判成 image，UI 与日志都答不出来，用户只能靠改 id 名字绕开。

### 1.3 结构性缺陷

| 缺陷 | 后果 |
|---|---|
| 单标签 | 一个模型只能服务一个模态，`text + vision` 这类主流多模态模型无法表达 |
| 朴素子串匹配 | `h3` 撞 `minimax/h3`、`wan` 撞任意含 wan 的 id、`sd-` 撞无关 id |
| 只读 id / name | provider 自己声明的 `input` / `output` 元数据被丢弃 |
| 无优先级概念 | 人工修正与自动推断无法共存，用户无法干预 |
| 无来源记录 | 无法解释、无法审计、无法增量修正 |

---

## 2. 目标架构：分层证据 + 多标签 + 可解释

核心思路：**把「一个模型是什么」从「猜一个标签」换成「按优先级收集证据，合并出一组模态，并记录每条证据的来源」。**

### 2.1 证据优先级

从高到低，高优先级命中即采用，低优先级不再参与判定：

| 优先级 | 层级 `sources[].level` | 证据来源 | 说明 |
|---|---|---|---|
| P0 | `override` | 人工 pin | 用户在设置卡片或覆盖文件里手写的能力集合，**永远最高** |
| P1 | `declared` | pi-ai provider 声明 | provider 配置里 `model.input` / `model.output` 的声明式元数据 |
| P2 | `provider` | 服务商在线元数据 | `GET {baseURL}/models` 返回的 `architecture.modality` / `capabilities` |
| P3 | `rule` / `family` | 家族规则表 | 内置家族规则 + 用户追加的自定义规则（词元边界正则） |
| P4 | `fallback` | 兜底 | 都没有 → `["text"]` |

> `sources[].level` 取值集合：`override | declared | provider | rule | family | fallback`。
> `rule` 与 `family` 都属于「规则表命中」：`rule` 表示命中了具体规则条目（`sources[].id` 给出规则 id），`family` 表示按家族默认推断。二者的精确分工以实现为准，语义上二者都低于 `provider`、高于 `fallback`。

### 2.2 解析流程

```
resolveCapabilities({ id, name, meta, override, providerMeta })
  → { modalities, primary, confidence, sources }
```

1. **override**：命中人工覆盖（键为 `provider:id`）→ 直接采用其 `modalities`，写入 `sources: [{ level: "override", ... }]`。
2. **declared**：读 pi-ai provider 的 `model.input` / `model.output`：
   - `output` 决定「能产出什么」（`image` / `video` / `tts` / `music` …）；
   - `input` 决定「能吃什么」（`["text","image"]` → 该模型是视觉理解模型）。
   - 命中即写入 `sources: [{ level: "declared", ... }]`。
3. **provider**：用在线探测到的 `architecture.modality` / `capabilities` 补充或判定，写入 `sources: [{ level: "provider", ... }]`。
4. **rule**：命中家族规则表（内置 + 用户自定义），写入 `sources: [{ level: "rule", id: "<rule-id>", ... }]`。
5. **fallback**：都没有 → `modalities = ["text"]`，写入 `sources: [{ level: "fallback", ... }]`。

规则表由 `familyRules()` 提供，使用**词元边界正则**而不是裸子串，覆盖：nano-banana / gemini-*-image / imagen / flux / dall-e / seedream / sora / veo / kling / seedance / wan-2.x / hailuo / qwen-vl / llava / internvl / pixtral / tts / speech / voice / music / song / lyric，以及 chat / instruct。

> **硬约束**：规则表里**禁止**使用裸子串 `"h3"`、`"wan"`、`"sd-"`。这类短词元正是 `minimax/h3` 误判为 video 的根因；规则必须是带边界或带家族前缀的形式（如 `wan-2\.`、`nano-banana`、`hailuo`）。

### 2.3 多标签 + primary + confidence + sources

- **`modalities`**：模型可服务的模态集合，可同时包含多个，例如 `["text", "vision"]`。取值域固定为
  `MODALITIES = ["text", "image", "video", "vision", "tts", "music"]`。
- **`primary`**：多标签里的**单一代表模态**——同一个模型出现在多个模态池时，默认选型以 `primary` 为准。`primary` 一定包含在 `modalities` 里。
- **`confidence`**：`0..1` 的置信度，反映「本次判定有多可靠」。层级越高置信度越高（人工覆盖 > provider 声明 > 在线探测 > 规则推断 > 兜底）。它是**启发式等级，不是统计概率**，UI 只用于排序与提示「这个判定值得复核」。
- **`sources`**：判定依据列表，每项形如 `{ level, id?, detail? }`：
  - `level`：见 §2.1 的取值集合；
  - `id`：命中规则的 id（有规则时给出），或命中的人工覆盖键；
  - `detail`：人话说明，例如「pi-ai provider 声明 input=[text,image]」。

UI 必须能把结论解释给用户：**每一行模型都要能回答"为什么是这个模态"。**

---

## 3. 数据结构

### 3.1 模型行（row）

`discoverModels()` 与 `buildModelsSnapshot()` 统一产出同一种行：

```jsonc
{
  "provider": "saygm",                 // provider id
  "id": "gemini-nano-banana-2.1",      // 模型 id
  "name": "Nano Banana 2.1",           // 显示名（缺省回落到 id）
  "type": "image",                     // 兼容字段：恒等于 primary
  "modalities": ["image"],             // 多标签能力集合
  "primary": "image",                  // 代表模态
  "confidence": 0.9,                   // 0..1
  "sources": [                         // 判定依据（可解释）
    { "level": "override", "id": "saygm:gemini-nano-banana-2.1", "detail": "人工覆盖" }
  ],
  "contextWindow": 128000,             // 可选：provider 声明的上下文窗口
  "maxTokens": 8192,                   // 可选：provider 声明的最大输出
  "input": ["text", "image"],          // 可选：provider 声明的输入模态
  "output": ["image"],                 // 可选：provider 声明的输出模态
  "baseURL": "https://…/v1",           // 直连端点；文本通道可为空
  "apiKey": "sk-…",                    // 已解析的 apiKey（可能为空）
  "apiKeyEnv": "SAYGM_API_KEY",        // apiKey 所在环境变量名
  "apiProtocol": "openai"              // 协议；非 openai 的多模态通道会在调用前拒绝
}
```

字段分组：

| 组 | 字段 | 用途 |
|---|---|---|
| 身份 | `provider` / `id` / `name` | 行标识与显示 |
| 能力 | `type` / `modalities` / `primary` / `confidence` / `sources` | 本文档 §2.3 |
| 声明 | `contextWindow` / `maxTokens` / `input` / `output` | provider 自述的元数据（可能缺省） |
| 连接 | `baseURL` / `apiKey` / `apiKeyEnv` / `apiProtocol` | 调用所需 |

### 3.2 覆盖文件

**路径**：`<profileDir>/llm-multimodal-capabilities.json`

- `profileDir` 的推导沿用 `lib/index.js` 的 `profilePatchPath()` 逻辑取其所在目录（即当前 DSH profile 目录，典型为 `~/.dsh/profiles/web`）；
- 推导不出 profile 目录时，回落到 `~/.dsh/llm-multimodal-capabilities.json`。

**格式**：

```json
{
  "overrides": {
    "saygm:gemini-nano-banana-2.1": {
      "modalities": ["image"],
      "updatedAt": "2026-11-11T12:00:00.000Z"
    }
  },
  "rules": [
    {
      "id": "my-org-acme-diffusion",
      "pattern": "(^|[-_])acme-diffusion-v\\d+($|[-_])",
      "modalities": ["image"],
      "note": "自建扩散模型网关，统一走 image 通道"
    }
  ]
}
```

约定：

- **`overrides`** 的键是 **`provider:id`**（由 `normalizeModelKey(provider, id)` 生成），值为 `{ modalities, updatedAt }`。
- **`overrides` 里 `modalities` 为空数组 `[]`** 表示**清除**该条覆盖，让判定回落到 P1→P4。
- **`rules`** 是用户追加的家族规则，参与 P3 判定；`pattern` 是正则字符串，`id` 是规则自身的标识（会出现在 `sources[].id` 里），`note` 是自由文本备注（会出现在 `sources[].detail` 里）。
- 读取与写入由 `loadOverrides(filePath)` / `saveOverrides(filePath, overrides)` 负责；`rules` 与 `overrides` 同文件共存，写入覆盖时不得丢掉用户已有的 `rules`。

---

## 4. HTTP API

四个路由挂在既有的 `/api/llm-multimodal/*` 命名空间下，与现有的 `GET /api/llm-multimodal/models`、`GET /api/llm-multimodal/providers`、`GET /api/llm-multimodal/settings`、`POST /api/llm-multimodal/settings/mutate` 并列。

### 4.1 `GET /api/llm-multimodal/models`

返回完整模型目录，**在既有形状上追加** `modalities` / `primary` / `confidence` / `sources`；`byModality` 由多标签重建 —— **同一个模型可以同时出现在 `text` 与 `vision` 两个池里**。

```jsonc
{
  "ok": true,
  "providers": [
    {
      "id": "saygm",
      "name": "SayGM",                  // 显示名（旧的 displayName 字段继续保留）
      "baseURL": "https://…/v1",
      "apiKeyEnv": "SAYGM_API_KEY",
      "apiProtocol": "openai",
      "models": [ /* row，见 §3.1 */ ]
    }
  ],
  "byModality": {
    "text":   [ /* row */ ],
    "image":  [ /* row */ ],
    "video":  [ /* row */ ],
    "vision": [ /* row */ ],
    "tts":    [ /* row */ ],
    "music":  [ /* row */ ]
  }
}
```

### 4.2 `GET /api/llm-multimodal/capabilities`

返回当前生效的覆盖与规则，以及它们所在的文件路径。

```jsonc
{
  "ok": true,
  "overrides": {
    "saygm:gemini-nano-banana-2.1": {
      "modalities": ["image"],
      "updatedAt": "2026-11-11T12:00:00.000Z"
    }
  },
  "rules": [
    { "id": "my-org-acme-diffusion", "pattern": "…", "modalities": ["image"], "note": "…" }
  ],
  "file": "/Users/me/.dsh/profiles/web/llm-multimodal-capabilities.json"
}
```

### 4.3 `POST /api/llm-multimodal/capabilities/override`

写入一条人工覆盖。

- **body**：`{ "key": "saygm:gemini-nano-banana-2.1", "modalities": ["image"] }`
- **`modalities` 为空数组 `[]`** → 清除该条覆盖。
- **响应**：`{ "ok": true, "overrides": { … } }`（回写整份 overrides，便于 UI 刷新）。

```bash
curl -X POST http://127.0.0.1:<port>/api/llm-multimodal/capabilities/override \
  -H 'Content-Type: application/json' \
  -d '{"key":"saygm:gemini-nano-banana-2.1","modalities":["image"]}'
```

### 4.4 `POST /api/llm-multimodal/detect`

对某个 provider 做**在线探测**：向该 provider 的 `GET {baseURL}/models` 发一次请求（带 `apiKey`，3 秒超时），把返回里的 `architecture.modality` / `capabilities` 合并为 P2 证据。

- **body**：`{ "provider": "saygm" }`（省略 `provider` 则探测**所有**有 `baseURL` 的 provider）
- **响应**：`{ "ok": true, "provider": "saygm", "merged": 12, "results": [ … ], "providers": [ … ], "byModality": { … } }`
  - `results`：逐 provider 的探测结果 `{ provider, ok, models?, error? }`，`models` 是本次探测到的模型条数；
  - `merged`：所有 provider 成功合并进能力判定的条数合计；
  - `providers` / `byModality`：探测后的**新模型目录**，客户端可直接替换，无需再拉一次 `/models`。

**失败降级**：探测失败（超时 / 401 / 网络不通 / 返回体没有 `models` 字段）**不阻塞**任何东西 —— 能力判定回落到 P1 → P4，接口仍返回 `ok: true` 并在结果里说明未合并到任何元数据。

---

## 5. 选型语义

### 5.1 `pickModel(rows, modality, requestedId)`

| 情形 | 行为 |
|---|---|
| 给了 `requestedId`，在**全部行**中命中 | 直接使用该行。命中方式接受 `id`、`name`、`provider:id` 三种写法 |
| 给了 `requestedId`，但该行**不含**目标模态 | 仍然使用该行，并附 `capabilityMismatch` 标记（调用前/结果里给出 warning：「该模型未被判定为 <模态>，可能调用失败」） |
| 给了 `requestedId`，完全没命中 | 返回 `{ model: null, requestedButMissing: true }`；工具必须返回**可操作的错误**（列出该模态当前可用候选 + 提示如何 pin 能力），**不得**自动降级到别的模型 |
| 没给 `requestedId` | 取 `modalities` 含该模态的**第一行** |

> **禁止静默替换**：显式指定的模型要么被原样使用，要么明确报错。绝不"你写 A、我用 B"。

### 5.2 视觉通道的顺序修复

候选池 = `modalities` 含 `"vision"` 的行。**显式 `model` 参数的查找必须发生在池过滤之前** —— 旧实现先过滤再查（`lib/index.js` 中视觉通道的候选过滤早于 `pickModel` 调用），导致 `claude-*` / `gpt-*` / `gemini-3.x` 这类多模态对话模型在视觉通道里根本查不到，只能报「未发现可用的视觉模型」。新语义下，只要模型被判定为含 `vision`，显式指定就能命中。

### 5.3 无 `baseURL` 的 provider

旧实现整块丢弃没有 baseURL 的 provider。新语义：**只有当某行仅具备 `text` 能力时才要求 baseURL**；带 baseURL 的多模态行照常保留，没有 baseURL 的 provider（如 `minimax-cn`）不再因为误判而整块消失。

### 5.4 文本通道

`generate_text` 的 `model` 参数形态是 `<provider>/<model>`（例如 `deepseek/deepseek-chat`），与其他五个工具的裸 id 不同。文本通道走 harness 的 LlmRuntime（`ctx.llm.prepareCall`），由 harness 内部做多协议路由，不受 OpenAI 协议限制。

---

## 6. 用户操作手册

### 6.1 手动 pin 某个模型的能力（最高优先级）

**方式 A —— 设置卡片（推荐）**

在「设置 → 插件 → llm-multimodal」的**模型能力**区块里：

1. 按 provider 分组找到目标模型；
2. 就地勾选它的模态集合（`text` / `image` / `video` / `vision` / `tts` / `music`，可多选）；
3. 保存 —— 客户端 `POST /api/llm-multimodal/capabilities/override`，随后刷新模型目录（`GET /api/llm-multimodal/models`）并提示结果；
4. 需要撤销时点「清除覆盖」，该行会回落到自动判定（`modalities: []` 即清除）。

**方式 B —— 直接改覆盖文件**

```json
{
  "overrides": {
    "saygm:gemini-nano-banana-2.1": { "modalities": ["image"], "updatedAt": "2026-11-11T12:00:00.000Z" },
    "minimax:h3": { "modalities": ["text"], "updatedAt": "2026-11-11T12:05:00.000Z" }
  }
}
```

键必须是 `provider:id`（`normalizeModelKey(provider, id)` 的产物）。改完重启 `dsh web` 或让设置卡片刷新。

**方式 C —— curl**

见 §4.3。

### 6.2 加一条自定义家族规则

当一批模型都该走同一个通道、但家族名不好用正则写死时，加一条 `rules` 条目：

```json
{
  "rules": [
    {
      "id": "acme-diffusion",
      "pattern": "(^|[-_/])acme-(diffusion|painter)([-_.]|$)",
      "modalities": ["image"],
      "note": "自建图像网关家族"
    }
  ]
}
```

规则要点：

- `pattern` 是**正则字符串**，按**词元边界**写，别用裸短词（`h3`、`wan`、`sd-` 这类会误伤）；
- `id` 会出现在该模型的 `sources[].id` 里，方便日后溯源是哪条规则判的；
- `note` 会出现在 `sources[].detail` 里，UI 会直接展示给用户；
- 用户规则的优先级与内置家族规则同级（P3），**仍然低于**人工 override 与 provider 声明。

### 6.3 对服务商在线探测

设置卡片里点该 provider 的**「重新探测」**按钮 → 客户端 `POST /api/llm-multimodal/detect`，body `{ "provider": "saygm" }`。返回里会告诉你**合并了多少条**服务端元数据（`merged`）。

用途：

- provider 的 `/models` 端点带 `architecture.modality` / `capabilities` 时，一次探测就能把整批模型的能力标对；
- 探测失败**不影响使用** —— 能力判定回落到声明式元数据 / 规则表 / 兜底，接口不会阻塞；
- 探测只读取元数据，不发起任何生成请求。

### 6.4 排查手册：能力判错了怎么办

| 现象 | 处理 |
|---|---|
| 模型没出现在某个模态池 | 先看 `GET /api/llm-multimodal/models` 里该行的 `sources`：若 `level` 是 `fallback`，说明没有任何证据命中 → 用 §6.1 手动 pin |
| 模型出现在错误的池里 | 同上，用 §6.1 覆盖；或在 §6.2 加一条更精确的家族规则 |
| 显式指定模型报「未找到」 | 说明 id 没匹配上任何行。检查 `provider:id` 写法与 `llm-pi-ai` 配置里的 `id` / `name` 是否一致 |
| 显式指定模型被提示「能力不符」 | 说明模型命中了但模态集合不含目标模态（`capabilityMismatch`）—— 确认 provider 的真实能力后再决定是否 pin |
| 判定结果每次重启都在变 | 检查是否有多个覆盖文件：profile 目录优先，推导不出时才回落 `~/.dsh/` |

---

## 7. 迁移与回退

### 7.1 兼容矩阵

| 旧行为 | 新行为 | 兼容方式 |
|---|---|---|
| 行上有 `type` 字段（单标签） | 行上有 `modalities`（多标签）+ `primary` | **`type` 字段保留，值恒等于 `primary`**，旧客户端读 `type` 不受影响 |
| `byModality[type]` 索引 | `byModality[modality]` 按多标签重建 | 同一模型可同时出现在多个池里；旧的按单标签订阅逻辑仍能取到它 |
| 关键词表分类 | 分层证据解析 | **旧关键词表降级为最后兜底**（P4 之前还有 override/declared/provider/rule；连规则表都没命中时，旧关键词逻辑作为最终兜底给出 `text`） |
| 显式 model 未命中 → 静默换模型 | 显式 model 未命中 → 报错并列出候选 | **行为变更**：这是有意的修复，错误信息里会给出可操作的下一步 |
| 无 baseURL 的 provider 整块丢弃 | 仅 text-only 行才要求 baseURL | 行为放宽，模型行变多 |

### 7.2 回退路径

1. **只想关掉某条覆盖**：把 `overrides` 里对应条目的 `modalities` 改成 `[]`（或删掉该条目）。
2. **想整体退回自动判定**：删除 `<profileDir>/llm-multimodal-capabilities.json`。
3. **想退回旧的关键词行为**：清空覆盖文件里的 `rules`（用户规则优先于内置规则，清空后回到内置家族规则）；内置规则表本身不随覆盖文件关闭。

### 7.3 不需要改动的下游

- `generate_text` 之外五个工具的**调用协议不变**（OpenAI 兼容端点）；
- 各模态的 `defaultModel` 预设下拉仍然可用，数据源仍是 `byModality` —— 只是同一个模型可能同时出现在多个模态池里；
- 输出路由（media-studio 集成）、音色克隆等其它子系统不受影响。

---

## 8. 已知边界

1. **家族默认 VL 可能误伤。**
   为修好「vision 池为空」，家族规则会推断主流对话模型（`claude-*` / `gpt-*` / `gemini-3.x` / `kimi-*`）具备 `vision` 能力。这对绝大多数 provider 是对的，但**只支持纯文本的同名模型**（自建网关裁剪过的上下文、或纯文本推理服务）会被多标一个 `vision`。缓解方式：用 §6.1 手动 pin 精确的模态集合覆盖掉推断结果。

2. **在线探测不可信时必须降级。**
   服务商 `/models` 的返回体千差万别：`architecture.modality` 可能缺失、可能用 `["text","image"]` 也可能用 `["TEXT","IMAGE"]`、可能把输入输出混在一个字段里。探测结果**只作为 P2 证据**（低于 override 与 declared），解析不出来就跳过、继续往下一层走，绝不因为探测失败而阻断能力判定或模型发现。3 秒超时也是同理：探测是**尽力而为**的旁路，不是必经步骤。

3. **`confidence` 不是概率。**
   它是证据层级的启发式映射，只适合排序与"这个判定值得复核"的提示，不适合做统计意义上的阈值判断。

4. **覆盖文件是单一事实源，但仍是本地文件。**
   多个 DSH profile 各自一份，profile 目录优先；UI 写入与手工编辑同一文件，**手工编辑后需让卡片刷新**才能看到变化。

5. **规则表是有限枚举。**
   家族规则覆盖的是主流命名习惯；自建网关的私有命名必须靠用户规则或人工 pin 兜住 —— 这是把最终决定权交还给用户，而不是继续扩张内置词表。

---

## 附录 A：字段速查

| 字段 | 位置 | 含义 |
|---|---|---|
| `MODALITIES` | `lib/capabilities.js` | `["text","image","video","vision","tts","music"]` |
| `resolveCapabilities({ id, name, meta, override, providerMeta })` | `lib/capabilities.js` | 返回 `{ modalities, primary, confidence, sources }` |
| `familyRules()` | `lib/capabilities.js` | 家族规则数组（词元边界正则） |
| `loadOverrides(filePath)` / `saveOverrides(filePath, overrides)` | `lib/capabilities.js` | 覆盖文件读写 |
| `normalizeModelKey(provider, id)` | `lib/capabilities.js` | `"provider:id"` |
| `pickModel(rows, modality, requestedId)` | `lib/index.js` | 新选型语义（见 §5） |

## 附录 B：来源标签释义

| `sources[].level` | 中文 | 含义 |
|---|---|---|
| `override` | 人工覆盖 | 用户手动 pin 的能力集合 |
| `declared` | 声明 | pi-ai provider 的 `model.input` / `model.output` 声明 |
| `provider` | 服务商 | 在线探测 `GET {baseURL}/models` 的 `architecture.modality` / `capabilities` |
| `rule` | 规则 | 命中家族规则表中的某条规则（`sources[].id` 为规则 id） |
| `family` | 家族 | 按家族默认推断得到的能力 |
| `fallback` | 兜底 | 没有任何证据命中，按 `text` 处理 |
