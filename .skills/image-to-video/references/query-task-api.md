# 图生视频 — 查询图生视频生成任务状态 API

## API 基本信息

| 字段 | 值 |
|------|----|
| Plugin ID | `d194f9e8-4977-4d57-9915-66ca3a3fc2dd` |
| API ID | `api-ra5EZDjVv8Xa` |
| Endpoint | `GET https://app-bgc5z86utjwh-api-ra5EZDjVv8Xa-gateway.appmiaoda.com/beta/video/generations/kling/image2video?task_id={task_id}` |
| Auth 模式 | `platform_managed`（密钥由平台注入） |
| Auth Header | `X-Gateway-Authorization: Bearer ${INTEGRATIONS_API_KEY}` |
| Content-Type | `application/json`（可选） |
| third_part_domain | `app-bgc5z86utjwh-api-ra5EZDjVv8Xa-gateway.appmiaoda.com` |

---

## 请求参数表

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `task_id` | string | 是 | 需要查询的视频生成任务 ID（Query Parameter） |

---

## 响应字段表

### 成功响应（200）

| 字段路径 | 类型 | 说明 |
|----------|------|------|
| `request_id` | string | 请求 ID |
| `data.task_id` | string | 视频生成任务 ID |
| `data.task_status` | string | 任务状态：`submitted` / `processing` / `succeed` / `failed` |
| `data.task_status_msg` | string | 任务状态描述信息（失败时含错误详情） |
| `data.task_result.videos` | array | 生成结果视频列表（`task_status=succeed` 时有效） |
| `data.task_result.videos[].id` | string | 视频 ID |
| `data.task_result.videos[].url` | string | 视频下载 URL（临时链接，需转存至 Supabase Storage） |
| `data.task_result.videos[].duration` | string | 视频时长（秒） |
| `data.created_at` | integer | 任务创建时间戳（毫秒） |
| `data.updated_at` | integer | 任务更新时间戳（毫秒） |

### 响应示例

```json
{
  "request_id": "as-vrd1z6v0xc",
  "data": {
    "task_id": "67adbd585b5ab6927a334790",
    "task_status": "processing",
    "task_status_msg": "",
    "task_result": {
      "videos": [
        {
          "id": "video-abc123",
          "url": "https://example.com/video/output.mp4",
          "duration": "5.0"
        }
      ]
    },
    "created_at": 1739439448000,
    "updated_at": 1739439450000
  }
}
```

> **注意：** 上游返回的视频 URL 是临时链接，必须转存至 Supabase Storage 获得永久链接。

---

## 轮询策略

- 未完成状态（`submitted` / `processing`）：每 **5 秒**查询一次
- 完成状态（`succeed` / `failed`）：停止轮询
- 建议总超时时间：**10 分钟**

---

## 生成期代码（Agent 直接调用）

```typescript
const apiKey = process.env["INTEGRATIONS_API_KEY"]!; // platform_managed，密钥由平台注入

/**
 * 查询图生视频任务状态
 *
 * @param taskId - 视频生成任务 ID
 * @returns 任务状态数据，含 task_status 和 task_result
 */
async function queryImageToVideoTask(taskId: string): Promise<{
  task_id: string;
  task_status: string;
  task_status_msg: string;
  task_result: { videos: Array<{ id: string; url: string; duration: string }> };
  created_at: number;
  updated_at: number;
}> {
  const response = await fetch(
    `https://app-bgc5z86utjwh-api-ra5EZDjVv8Xa-gateway.appmiaoda.com/beta/video/generations/kling/image2video?task_id=${taskId}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Authorization": `Bearer ${apiKey}`,
      },
    }
  );

  if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

  const json = await response.json();
  return json.data;
}

/**
 * 轮询直到任务完成并返回视频 URL
 *
 * @param taskId - 视频生成任务 ID
 * @returns 任务成功时的视频 URL
 */
async function pollUntilDone(taskId: string): Promise<string> {
  const POLL_INTERVAL_MS = 5000;
  const TIMEOUT_MS = 10 * 60 * 1000;
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const result = await queryImageToVideoTask(taskId);
    if (result.task_status === "succeed") return result.task_result.videos[0].url;
    if (result.task_status === "failed") {
      throw new Error(`Task failed: ${result.task_status_msg}`);
    }
  }
  throw new Error(`Task ${taskId} timed out after 10 minutes`);
}
```

---

## Edge Function 代码

视频 URL 由第三方 API 返回，属于临时链接，Edge Function 在返回前必须将其转存至 Supabase Storage。

### Web 和 MiniProgram（实现相同，使用同一 Edge Function）

```typescript
// edge-functions/image-to-video-query.ts
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

/**
 * 将远程媒体资源（图片/视频/音频）直接流式上传至 Supabase Storage
 *
 * @param mediaUrl - 待转存的远程资源 URL
 * @param bucketName - Supabase Storage 桶名称
 * @param upsert - 是否覆盖同路径文件，默认 false
 * @returns 成功时返回 { success: true, path, publicUrl, contentType }，失败时返回 { success: false, error }
 */
async function streamMediaToStorage(
  mediaUrl: string,
  bucketName: string,
  upsert = false
): Promise<
  | { success: true; path: string; publicUrl: string; contentType: string }
  | { success: false; error: string }
> {
  try {
    new URL(mediaUrl); // 验证 URL 格式

    const response = await fetch(mediaUrl);
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const isAllowed =
      contentType.startsWith("image/") ||
      contentType.startsWith("video/") ||
      contentType.startsWith("audio/") ||
      contentType === "application/octet-stream";

    if (!isAllowed) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const ext = contentType.split("/")[1]?.split(";")[0] ?? "bin";
    const filePath = `uploads/${crypto.randomUUID()}.${ext}`;

    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(filePath, response.body!, { contentType, cacheControl: "no-cache", upsert });

    if (error) throw error;

    const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(filePath);

    return { success: true, path: data.path, publicUrl: urlData.publicUrl, contentType };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // --- 解析客户端请求 ---
  let taskId: string;
  try {
    const body = await req.json();
    taskId = body.task_id;
    if (!taskId) throw new Error("Missing task_id");
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- 注入平台密钥（严禁暴露到客户端）---
  const apiKey = Deno.env.get("INTEGRATIONS_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- 查询上游任务状态 ---
  const upstream = await fetch(
    `https://app-bgc5z86utjwh-api-ra5EZDjVv8Xa-gateway.appmiaoda.com/beta/video/generations/kling/image2video?task_id=${taskId}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Authorization": `Bearer ${apiKey}`,
      },
    }
  );

  // 转发配额/余额错误
  if (upstream.status === 429 || upstream.status === 402) {
    const errText = await upstream.text();
    return new Response(errText, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: `Upstream error: ${upstream.status}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const responseData = await upstream.json();
  const taskData = responseData.data;

  // --- 若任务成功，转存视频 URL 至 Supabase Storage ---
  if (
    taskData.task_status === "succeed" &&
    taskData.task_result?.videos?.length > 0
  ) {
    const videos = taskData.task_result.videos;
    const transferredVideos = await Promise.all(
      videos.map(async (video: { id: string; url: string; duration: string }) => {
        const transfer = await streamMediaToStorage(video.url, "generated-media");
        if (!transfer.success) {
          throw new Error(`Storage transfer failed: ${transfer.error}`);
        }
        return { ...video, url: transfer.publicUrl };
      })
    );
    taskData.task_result.videos = transferredVideos;
  }

  return new Response(JSON.stringify(responseData), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
```

---

## 前端调用代码

### Web 平台

```typescript
/**
 * 查询图生视频任务状态（Web）
 *
 * @param taskId - 视频生成任务 ID
 * @returns 任务数据，成功时 videos[].url 为 Supabase Storage 永久链接
 */
async function queryImageToVideoTask(taskId: string) {
  const { data, error } = await supabase.functions.invoke("image-to-video-query", {
    body: { task_id: taskId },
  });
  if (error) throw error;
  return data.data;
}

/**
 * 前端轮询直到任务完成（Web）
 *
 * @param taskId - 视频生成任务 ID
 * @param onProgress - 可选进度回调，参数为当前 task_status
 * @returns 视频永久 URL
 */
async function pollVideoUntilDone(
  taskId: string,
  onProgress?: (status: string) => void
): Promise<string> {
  const POLL_INTERVAL_MS = 5000;
  const TIMEOUT_MS = 10 * 60 * 1000;
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const result = await queryImageToVideoTask(taskId);
    onProgress?.(result.task_status);

    if (result.task_status === "succeed") {
      return result.task_result.videos[0].url; // 永久 Supabase Storage URL
    }
    if (result.task_status === "failed") {
      throw new Error(`视频生成失败：${result.task_status_msg}`);
    }
  }
  throw new Error(`任务 ${taskId} 超时（超过 10 分钟）`);
}
```

### MiniProgram 平台

```typescript
/**
 * 查询图生视频任务状态（MiniProgram）
 *
 * @param taskId - 视频生成任务 ID
 * @returns 任务数据，成功时 videos[].url 为 Supabase Storage 永久链接
 */
async function queryImageToVideoTask(taskId: string) {
  const { data, error } = await supabase.functions.invoke("image-to-video-query", {
    body: { task_id: taskId },
  });
  if (error) throw error;
  return data.data;
}

/**
 * 前端轮询直到任务完成（MiniProgram）
 *
 * @param taskId - 视频生成任务 ID
 * @param onProgress - 可选进度回调，参数为当前 task_status
 * @returns 视频永久 URL
 */
async function pollVideoUntilDone(
  taskId: string,
  onProgress?: (status: string) => void
): Promise<string> {
  const POLL_INTERVAL_MS = 5000;
  const TIMEOUT_MS = 10 * 60 * 1000;
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const result = await queryImageToVideoTask(taskId);
    onProgress?.(result.task_status);

    if (result.task_status === "succeed") {
      return result.task_result.videos[0].url; // 永久 Supabase Storage URL
    }
    if (result.task_status === "failed") {
      throw new Error(`视频生成失败：${result.task_status_msg}`);
    }
  }
  throw new Error(`任务 ${taskId} 超时（超过 10 分钟）`);
}
```

---

## 注意事项

- **视频 URL 转存：** 上游返回的视频 URL 是临时链接，Edge Function 在任务成功时必须通过 `streamMediaToStorage` 转存至 Supabase Storage，再将永久 `publicUrl` 返回给前端。
- **密钥安全：** `INTEGRATIONS_API_KEY` 仅在 Edge Function 服务端读取，严禁暴露到前端。`SUPABASE_SERVICE_ROLE_KEY` 同样仅服务端使用。
- **轮询间隔：** 建议每 5 秒轮询一次，设置 10 分钟超时。
- **错误处理：** 务必处理 429（配额超限）和 402（余额不足），并向用户显示友好错误信息。
- **计费：** 查询接口本身不计费（`enable_billing: false`）。创建任务接口计费，折扣价 ¥85.00（原价 ¥130.00）。
- **所需 Env Vars：**
  - `INTEGRATIONS_API_KEY`：平台注入，用于调用上游 API
  - `SUPABASE_URL`：Edge Function 环境已自动注入
  - `SUPABASE_SERVICE_ROLE_KEY`：Edge Function 环境已自动注入，用于 Supabase Storage 操作
