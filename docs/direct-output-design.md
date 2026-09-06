# dsh-llm-multimodal 直传设计：让 Agent 直接拿到 provider 数据并写入项目源目录

> 起草于 2026-09-06，针对以下痛点：
> 1. `generate_image` 把 Agnes CDN URL 下载到本地再返回 `file://`，原始 URL 丢失
> 2. `generate_image(I2I)` 透传 `args.image` 数组时不做 `file:// → data URI` 适配，provider 拒绝
> 3. `generate_video(I2V)` 同上
> 4. 输出目录默认 `/tmp`，与 media-studio 项目源目录解耦，Agent 需要二次迁移

## 设计目标

让 `generate_*` 工具的响应同时包含：
- **原始数据**（base64 / CDN URL）—— 让 Agent 决定怎么用
- **本地落盘路径**（可选）—— 当 `outputDir` 指向项目源目录时直接落地
- **provider 元信息**（model / request id / task_id）—— 便于审计

## 三套方案（轻 → 重）

### 方案 A：最小改动 —— 响应增加 `sourceUrl` 透传字段

**改动量**：~30 行
**风险**：零
**效果**：Agent 拿到 Agnes CDN URL 后可以直接喂给下一次 I2V/I2I 调用，不再被截断

```js
// lib/index.js 第 1262 行附近
const media = extractFirstMedia(body);
if (media.b64) {
  const dest = join(resolveOutputDir(getScope()), `llm-multimodal-${Date.now()}.png`);
  await writeFile(dest, Buffer.from(media.b64, "base64"));
  return {
    success: true,
    url: "file://" + dest,           // 保留原行为（向后兼容）
    sourceUrl: media.b64 ? null : media.url,  // ★ 新增：Agnes 返回的 CDN URL
    b64: media.b64 || null,          // ★ 新增：保留 base64 以便 Agent 转发
    model: target.id,
    bytes: media.b64 ? Buffer.from(media.b64, "base64").length : 0,
    latencyMs: Date.now() - t0,
    message: "图像已生成",
  };
}
```

视频工具的 `coverUrl` 已经存在但容易忽略（line 1489/1519），可以把视频 URL 改成 `sourceUrl` 字段并加 `expiresAt`（CDN URL 7 天后会过期）。

### 方案 B：写文件到"项目源目录"——核心目标

**改动量**：~80 行
**风险**：中（需要 scope 注入 media-studio 服务或新增配置）
**效果**：生成的图片/视频/音频直接落到 media-studio 当前激活项目的 `<wsRoot>/projects/<projectId>/assets/` 子目录

#### B.1 配置层（最小侵入）

新增 settings 字段：
```yaml
llm-multimodal:
  outputDir: ~/.media-studio/web-jobs   # 已生效
  outputStrategy: web-jobs              # 现有：写到 outputDir
  outputStrategy: media-studio-active   # 新增：写到当前激活项目
```

#### B.2 Plugin 拿 media-studio 服务

`media-studio` 注册了一个服务用于查询激活项目 ID。dsh-llm-multimodal 增加 inject：

```js
// lib/index.js line 5
export const inject = ["tools", "credentials", "settings", "llm", "webServer", "mediaStudio"];
//                                                                                ↑ 新增
```

`mediaStudio` 服务暴露：
```ts
interface MediaStudioService {
  getActiveProjectId(): string | null;
  getProjectAssetDir(projectId: string, kind: 'character' | 'scene' | 'audio' | 'clip'): string;
  getWorkspaceRoot(): string;
}
```

#### B.3 生成工具路由

```js
function resolveAssetDestination(scope, kind, ext) {
  const strategy = scope.get().outputStrategy || "web-jobs";
  if (strategy === "media-studio-active") {
    const studio = ctx["mediaStudio"]; // 通过 ctx 拿
    const projectId = studio?.getActiveProjectId?.();
    if (projectId) {
      const dir = studio.getProjectAssetDir(projectId, kind);
      return join(dir, `llm-multimodal-${Date.now()}.${ext}`);
    }
  }
  // fallback 到现有逻辑
  return join(resolveOutputDir(scope), `llm-multimodal-${Date.now()}.${ext}`);
}
```

调用处（generate_image line 1260）：
```js
const kind = "scene"; // 或 character / audio / clip
const dest = resolveAssetDestination(getScope(), kind, "png");
```

#### B.4 返回值携带项目路径

```js
return {
  success: true,
  url: "file://" + dest,
  sourceUrl: media.url || null,
  b64: media.b64 || null,
  model: target.id,
  bytes: ...,
  projectId: "p-mtosxj1a-ddd2e0",       // ★ 写到哪个项目
  assetPath: "/Users/xiao/.media-studio/projects/p-.../assets/scenes/llm-multimodal-xxx.png",
  // ↑ Agent 可以直接拿这个去调 media_studio_register_asset
  message: "图像已生成",
};
```

### 方案 C：I2I/I2V 输入适配 —— 解决 file:// 失败

**改动量**：~50 行
**风险**：低
**效果**：`generate_image(image="file:///tmp/x.png")` 和 `generate_video(image=...)` 自动工作

```js
// 新增工具函数
async function adaptImageInput(img, exec) {
  if (!img) return img;
  if (typeof img !== "string") return img;
  if (img.startsWith("file://")) {
    const path = img.slice(7);
    const buf = await readFile(path);
    const ext = path.split(".").pop().toLowerCase();
    const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  if (img.startsWith("/") && fs.existsSync(img)) {
    // 绝对路径但没有 file:// 前缀
    const buf = await readFile(img);
    return `data:image/png;base64,${buf.toString("base64")}`;
  }
  return img; // 公网 URL 或 data URI 原样透传
}
```

调用处：
```js
// generate_image line 1198-1203
const rawImages = []
  .concat(Array.isArray(args.image) ? args.image : [], ...)
  .filter(Boolean);
const i2iImages = await Promise.all(rawImages.map(img => adaptImageInput(img, exec)));
```

## 推荐组合：A + B + C

**优先级**：
1. **C 优先**（I2I/I2V 输入适配）—— 30 行代码，立即让 `generate_image` 工具的 I2I/I2V 模式可用
2. **A 次之**（响应增加 sourceUrl）—— 30 行代码，让 Agent 可以链式调用
3. **B 最后**（写入项目源目录）—— 80 行代码，需要 media-studio 服务协调

## 实施步骤

### Step 1: 方案 C（输入适配）

修改 `/Users/xiao/projects/dsh-llm-multimodal/lib/index.js`：

```diff
@@ line 1198 @@
+ import { readFile } from "node:fs/promises";
+ import { existsSync } from "node:fs";

+ async function adaptImageInput(img) {
+   if (!img || typeof img !== "string") return img;
+   if (img.startsWith("file://")) {
+     const path = img.slice(7);
+     if (existsSync(path)) {
+       const buf = await readFile(path);
+       const ext = path.split(".").pop().toLowerCase();
+       const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
+       return `data:${mime};base64,${buf.toString("base64")}`;
+     }
+     return img;
+   }
+   if (img.startsWith("/") && existsSync(img)) {
+     const buf = await readFile(img);
+     return `data:image/png;base64,${buf.toString("base64")}`;
+   }
+   return img;
+ }

@@ line 1205 @@
  if (i2iImages.length > 0) {
    if (isAgnesStyle) {
+     const adapted = await Promise.all(i2iImages.map(adaptImageInput));
      imgBody.extra_body = {
        ...(imgBody.extra_body || {}),
-       image: i2iImages,
+       image: adapted,
        response_format: "url",
      };
```

类似改动在 `generate_video` 的 `first_frame` 赋值处（line 1401）。

### Step 2: 方案 A（响应增加 sourceUrl）

修改 `generate_image` 和 `generate_video` 的 return 语句，分别添加 `sourceUrl` 和 `b64` 字段。

### Step 3: 方案 B（写入项目源目录）

需要先在 media-studio 注册服务，再在 dsh-llm-multimodal 注入并调用。

## 测试验证

修改后，跑我之前的端到端测试用例：
- `generate_image(image="file:///tmp/llm-multimodal-xxx.png", prompt="matte black")` → 期望返回成功
- `generate_image(image="data:image/jpeg;base64,...", prompt="moonlight")` → 期望成功（已验证）
- `generate_video(image="file:///tmp/xxx.png", prompt="fox looks up")` → 期望返回 task_id + CDN URL

## 收益

1. **Agent 链路闭环**：I2I/I2V 工具模式真正可用 → 不需要直连 curl
2. **素材自动入库**：生成的图片直接落到 media-studio 项目 assets 目录 → `media_studio_register_asset` 一行就能入库
3. **CDN URL 链路可重现**：保留 provider 原始 URL，下次 I2V 调用直接喂 URL → 避免大 base64 在 tool context 中被截断

## 风险与注意事项

- **方案 C 的副作用**：把 file:// 转 base64 后 base64 字符串可能很长，会膨胀 tool call payload。**建议加上文件大小检查**（>5MB 时拒绝）
- **方案 B 的依赖**：需要 media-studio 服务稳定暴露，未来如果 media-studio 重构服务接口要同步更新
- **CDN URL 过期**：Agnes 返回的 URL 7 天有效，过期后 `resultUrl` 需要重新下载

---

## 🔄 后续重评估（2026-09-06 后）

实际落地方案 A + C 后，重新审视方案 B，**确认更优解是方案 D（也就是你刚才描述的方向）**：

> "media-studio 调用 dsh-llm-multimodal 返回的 url/base64，经由 media-studio 写回项目源路径"

### 为什么方案 D 是最优

- ✅ media-studio 是 sourcePath 的**单一真相源**（持有 projects.json）
- ✅ media-studio **已经在用 `callMultimodal()` 调用 dsh-llm-multimodal**（tools.ts:512）
- ✅ 拿到 `url/base64` 后**完全可以在自己这边决定**写到 sourcePath 还是 web-jobs
- ✅ dsh-llm-multimodal 保持轻量（**不动**）

### 已有基础设施

- `canvasStore.getSourcePath(canvasId)` —— **已经为这个需求而存在**（canvas-store.ts:213）
- `prepareVideoForCanvas()` —— 已经下载视频到 web-jobs（video-cover.ts:130）
- `callMultimodal()` —— media-studio 内部已经能调 dsh-llm-multimodal 工具（tools.ts:512）
- `resolveMediaTarget()` —— sourcePath 项目自动 URL 重写（routes.ts:185-194）

### 实施：4 个改动点

1. **新增 `prepareImageForCanvas()`**（src/image-cover.ts）
2. **`executeNodeRefresh()` image 分支**调 prepareImageForCanvas（tools.ts:619）
3. **`prepareVideoForCanvas` 升级**支持 sourcePath 分支
4. **`callMultimodal()` 扩展**：返回值携带 `b64`/`sourceUrl` 字段，方便 prepare* 选择下载源

### 写入路径逻辑

```ts
const sourcePath = opts.canvasSourcePath;
const destDir = sourcePath
  ? join(sourcePath, 'assets', kindDir)  // ← sourcePath 项目
  : join(opts.wsRoot, 'web-jobs');       // ← 默认项目

const resultUrl = sourcePath
  ? `projects/${projectId}/assets/${kindDir}/${filename}`  // ← 走 sourcePath 重写
  : `file://${destPath}`;
```

### 数据流（最终版）

```
Agent / 用户
    │
    ├─ 直接调 generate_image ─→ 浏览器用 sourceUrl (CDN 直拉)
    │                     │
    │                     └─ 调 canvas_graph_patch / canvas_refresh_node
    │                                  │
    │                                  ▼
    │                          media-studio
    │                                  │
    │                                  ├─ callMultimodal() → dsh-llm-multimodal
    │                                  │   (返回 url + sourceUrl + b64)
    │                                  │
    │                                  ├─ prepareImageForCanvas()
    │                                  │   ├─ sourcePath 项目 → 写到 sourcePath/assets/
    │                                  │   └─ 默认项目       → 写到 web-jobs/
    │                                  │
    │                                  └─ 节点 resultUrl = projects/<id>/assets/...
    │                                     （sourcePath 项目自动重写）
    │
    └─ 显式 media_studio_register_asset（轻量入库）
```

**结论**：你的描述和方案 D 完全一致——这是最优路径，**不动 plugin**。