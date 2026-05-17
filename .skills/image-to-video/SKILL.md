---
name: image-to-video
description: 图生视频（Kling），输入参考图片和提示词生成 5/10 秒短视频，异步任务需轮询结果。需要图片转视频、图片动态化时使用。
license: MIT
---

## 能力概述

基于百度千帆平台 Kling 模型，将静态图片与文字提示词转换为高质量短视频（5 秒或 10 秒）。适用于创意设计、内容营销、多媒体内容创作、电商产品视频化等场景。

**接口列表：**

| 接口 | Method | Endpoint |
|------|--------|----------|
| 创建图生视频任务 | POST | `https://app-bo4w33bsdqm9-api-m9xKX785MdZa-gateway.appmiaoda.com/beta/video/generations/kling/image2video` |
| 查询图生视频生成任务状态 | GET | `https://app-bo4w33bsdqm9-api-ra5EZDjVv8Xa-gateway.appmiaoda.com/beta/video/generations/kling/image2video?task_id={task_id}` |

**工作流（异步轮询）：**

1. 调用创建接口，传入 `prompt` 和 `image`，获取 `task_id`
2. 每 5 秒轮询查询接口，直到 `task_status` 为 `succeed` 或 `failed`
3. 任务成功后从 `data.task_result.videos[0].url` 获取视频 URL
4. 将视频 URL 转存至 Supabase Storage 以获得永久链接

**任务状态枚举：**

| task_status | 含义 |
|-------------|------|
| `submitted` | 已提交 |
| `processing` | 处理中 |
| `succeed` | 成功 |
| `failed` | 失败 |

**多平台支持：** Web、MiniProgram、App 均支持，视频 URL 转存方式相同。App 平台转存文件至 Supabase Storage 时需使用 `expo/fetch` + ArrayBuffer 方式。

---

## 生成期用法（Agent 直接调用）

完整异步工作流：提交任务 → 轮询状态 → 获取结果。详见 `references/create-task-api.md` 和 `references/query-task-api.md`。

```typescript
const apiKey = process.env["INTEGRATIONS_API_KEY"]!; // platform_managed，密钥由平台注入

/**
 * 完整图生视频流程：提交任务并轮询直到完成
 *
 * @param prompt - 正向文本提示词，最大 2500 字符
 * @param image - 参考图像 Base64 或 URL（Base64 直接传编码字符串，不加 data:image/... 前缀）
 * @param duration - 视频时长，"5" 或 "10"，默认 "5"
 * @returns 视频任务结果对象，含 task_id 和 videos 列表
 */
async function generateImageToVideo(
  prompt: string,
  image: string,
  duration: string = "5"
): Promise<{ taskId: string; videoUrl: string }> {
  // Step 1: 提交任务
  const submitRes = await fetch(
    "https://app-bo4w33bsdqm9-api-m9xKX785MdZa-gateway.appmiaoda.com/beta/video/generations/kling/image2video",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ prompt, image, duration }),
    }
  );
  if (!submitRes.ok) throw new Error(`HTTP error: ${submitRes.status}`);
  const submitData = await submitRes.json();
  const taskId: string = submitData.data.task_id;

  // Step 2: 轮询查询状态
  const POLL_INTERVAL_MS = 5000;
  const TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟超时
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const queryRes = await fetch(
      `https://app-bo4w33bsdqm9-api-ra5EZDjVv8Xa-gateway.appmiaoda.com/beta/video/generations/kling/image2video?task_id=${taskId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Gateway-Authorization": `Bearer ${apiKey}`,
        },
      }
    );
    if (!queryRes.ok) throw new Error(`Query HTTP error: ${queryRes.status}`);
    const queryData = await queryRes.json();
    const status: string = queryData.data.task_status;

    if (status === "succeed") {
      const videoUrl: string = queryData.data.task_result.videos[0].url;
      return { taskId, videoUrl };
    }
    if (status === "failed") {
      throw new Error(`Task failed: ${queryData.data.task_status_msg}`);
    }
    // submitted / processing → 继续轮询
  }

  throw new Error(`Task ${taskId} timed out after 10 minutes`);
}
```

> 详细参数表和单接口代码见：
> - `references/create-task-api.md`（创建任务接口）
> - `references/query-task-api.md`（查询任务接口）

**生成期文件下载（必须执行）：**

生成接口返回的 URL 是 CDN 临时链接，在生成期（Agent 直接调用场景）获得 URL 后，**必须立即使用 Bash 工具将文件下载到本地**，以便用户查看结果。

```bash
curl -L -o <本地路径> "<生成的文件 URL>"
```

**完整生成期工作流（含下载步骤）：**

1. 调用生成函数获取文件 URL
2. 使用 Bash 工具执行 `curl -L -o <本地路径> "<url>"` 将文件下载到本地
3. 告知用户文件已保存到对应路径

> **注意**：上游 CDN 链接有时效性，应在获得 URL 后立即下载，不要延迟。

---

## 生成后用法（应用内通过 Edge Function 调用）

在应用中通过两个 Edge Function 实现完整的图生视频流程：

1. **`image-to-video-submit`**：接受 `prompt`、`image`（已转存至 Supabase Storage 的 URL）、`duration`，调用上游提交接口，返回 `task_id`
2. **`image-to-video-query`**：接受 `task_id`，轮询查询任务状态，任务成功时将视频 URL 转存至 Supabase Storage 并返回永久 `publicUrl`

**重要：上传图片规则**
用户上传的图片必须先转存到 Supabase Storage，再将生成的永久 URL 作为 `image` 参数传入 `image-to-video-submit`。

**Web / MiniProgram 调用差异：**

| 平台 | 调用方式 | 图片上传 |
|------|----------|----------|
| Web | `supabase.functions.invoke` 或原生 `fetch` | 上传后取 publicUrl |
| MiniProgram | `supabase.functions.invoke` | 上传后取 publicUrl |

详见：
- `references/create-task-api.md`（Edge Function 提交实现 + 前端代码）
- `references/query-task-api.md`（Edge Function 查询实现 + 前端代码）
