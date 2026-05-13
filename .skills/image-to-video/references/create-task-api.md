# 图生视频 — 创建图生视频任务 API

## API 基本信息

| 字段 | 值 |
|------|----|
| Plugin ID | `d194f9e8-4977-4d57-9915-66ca3a3fc2dd` |
| API ID | `api-m9xKX785MdZa` |
| Endpoint | `POST https://app-bm0s7wqmrksh-api-m9xKX785MdZa-gateway.appmiaoda.com/beta/video/generations/kling/image2video` |
| Auth 模式 | `platform_managed`（密钥由平台注入） |
| Auth Header | `X-Gateway-Authorization: Bearer ${INTEGRATIONS_API_KEY}` |
| Content-Type | `application/json` |
| third_part_domain | `app-bm0s7wqmrksh-api-m9xKX785MdZa-gateway.appmiaoda.com` |

---

## 请求参数表

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `prompt` | string | 是 | — | 正向文本提示词，最大 2500 字符 |
| `image` | string | 是 | — | 参考图像，支持 Base64 编码（直接传编码字符串，不加 `data:image/...` 前缀）或图片 URL。格式支持 jpg/jpeg/png，文件大小不超过 10MB，分辨率不小于 300×300px，宽高比在 1:2.5 ~ 2.5:1 之间 |
| `duration` | string | 否 | `"5"` | 生成视频时长，可选值：`"5"` 或 `"10"`，单位秒 |

> **重要：** 当用户上传图片或视频时，这些资源必须先转存到 Supabase Storage 以确保持久可访问；生成的 URL 作为 `image` 参数传入本接口。

---

## 响应字段表

### 成功响应（200）

| 字段路径 | 类型 | 说明 |
|----------|------|------|
| `request_id` | string | 请求 ID |
| `data.task_id` | string | 视频生成任务 ID，用于后续轮询查询 |
| `data.task_status` | string | 任务状态（提交后通常为 `submitted`） |
| `data.created_at` | integer | 任务创建时间戳（毫秒） |
| `data.updated_at` | integer | 任务更新时间戳（毫秒） |

### 响应示例

```json
{
  "request_id": "as-8jhimhhqhy",
  "data": {
    "task_id": "67adbb3b5b5ab6927a33478f",
    "task_status": "submitted",
    "created_at": 1739438907194,
    "updated_at": 1739438907194
  }
}
```

---

## 生成期代码（Agent 直接调用）

```typescript
const apiKey = process.env["INTEGRATIONS_API_KEY"]!; // platform_managed，密钥由平台注入

/**
 * 创建图生视频任务
 *
 * @param prompt - 正向文本提示词，最大 2500 字符
 * @param image - 参考图像 Base64 字符串或图片 URL（Base64 不加 data:image/... 前缀）
 * @param duration - 视频时长，"5" 或 "10"，默认 "5"
 * @returns 包含 task_id 和 task_status 的任务数据
 */
async function createImageToVideoTask(
  prompt: string,
  image: string,
  duration: string = "5"
): Promise<{ task_id: string; task_status: string; created_at: number; updated_at: number }> {
  const response = await fetch(
    "https://app-bm0s7wqmrksh-api-m9xKX785MdZa-gateway.appmiaoda.com/beta/video/generations/kling/image2video",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ prompt, image, duration }),
    }
  );

  if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

  const json = await response.json();
  return json.data;
}
```

---

## Edge Function 代码

### Web 和 MiniProgram（实现相同，使用同一 Edge Function）

```typescript
// edge-functions/image-to-video-submit.ts
import { serve } from "https://deno.land/std/http/server.ts";

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // --- 解析客户端请求 ---
  let prompt: string;
  let image: string;
  let duration: string = "5";

  try {
    const body = await req.json();
    prompt = body.prompt;
    image = body.image;
    if (body.duration) duration = body.duration;
    if (!prompt) throw new Error("Missing prompt");
    if (!image) throw new Error("Missing image");
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

  // --- 调用上游接口 ---
  const upstream = await fetch(
    "https://app-bm0s7wqmrksh-api-m9xKX785MdZa-gateway.appmiaoda.com/beta/video/generations/kling/image2video",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ prompt, image, duration }),
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

  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
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
 * 提交图生视频任务（Web）
 *
 * @param prompt - 正向文本提示词
 * @param imageUrl - 已转存至 Supabase Storage 的图片 URL
 * @param duration - 视频时长，"5" 或 "10"
 * @returns 包含 task_id 的响应数据
 */
async function submitImageToVideoTask(
  prompt: string,
  imageUrl: string,
  duration: string = "5"
): Promise<{ task_id: string; task_status: string }> {
  const { data, error } = await supabase.functions.invoke("image-to-video-submit", {
    body: { prompt, image: imageUrl, duration },
  });
  if (error) throw error;
  return data.data;
}
```

### MiniProgram 平台

```typescript
/**
 * 提交图生视频任务（MiniProgram）
 *
 * @param prompt - 正向文本提示词
 * @param imageUrl - 已转存至 Supabase Storage 的图片 URL
 * @param duration - 视频时长，"5" 或 "10"
 * @returns 包含 task_id 的响应数据
 */
async function submitImageToVideoTask(
  prompt: string,
  imageUrl: string,
  duration: string = "5"
): Promise<{ task_id: string; task_status: string }> {
  const { data, error } = await supabase.functions.invoke("image-to-video-submit", {
    body: { prompt, image: imageUrl, duration },
  });
  if (error) throw error;
  return data.data;
}
```

### App 平台（Expo）

App 端提交任务的调用方式与 Web 相同（`supabase.functions.invoke`），但图片上传至 Supabase Storage 时需使用 `expo/fetch` + ArrayBuffer 方式：

依赖说明：

- `expo/fetch`：Expo 内置，**必须使用此包而非全局 fetch**（全局 fetch 在部分 Android 设备上 `arrayBuffer()` 存在兼容性问题）

**图片上传工具函数：**

```ts
// utils/storageUpload.ts
import { fetch } from 'expo/fetch'; // 必须从 expo/fetch 导入
import { supabase } from '@/client/supabase';

export interface UploadOptions {
  fileUrl: string;       // 远程文件 URL
  filePath: string;      // Storage 内目标路径
  mimeType: string;      // MIME 类型
  bucket: string;        // Storage bucket 名称
  upsert?: boolean;
}

export interface UploadResult {
  path: string;
  publicUrl: string;
}

export const uploadFileToStorage = async (options: UploadOptions): Promise<UploadResult> => {
  const { fileUrl, filePath, mimeType, bucket, upsert = false } = options;

  // 使用 expo/fetch 获取文件内容
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`获取文件失败: ${response.status}`);

  // 转换为 ArrayBuffer（跳过 Blob 中间层，三端一致）
  const arrayBuffer = await response.arrayBuffer();

  // 上传至 Supabase Storage
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filePath, arrayBuffer, { contentType: mimeType, upsert });

  if (error) throw new Error(`上传失败: ${error.message}`);

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(data.path);
  return { path: data.path, publicUrl: urlData.publicUrl };
};
```

**App 端完整调用示例：**

```tsx
import * as ImagePicker from 'expo-image-picker';
import { uploadFileToStorage } from '@/utils/storageUpload';
import { supabase } from '@/client/supabase';

/** 选取图片 → 上传至 Storage → 提交图生视频任务 */
const handleSubmit = async (prompt: string) => {
  // 1. 选取图片
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.8,
  });
  if (result.canceled) return;

  const imageUri = result.assets[0].uri;

  // 2. 上传至 Supabase Storage（使用 expo/fetch + ArrayBuffer）
  const uploaded = await uploadFileToStorage({
    fileUrl: imageUri,
    filePath: `video-input/${Date.now()}.jpg`,
    mimeType: 'image/jpeg',
    bucket: 'media',
  });

  // 3. 提交图生视频任务
  const { data, error } = await supabase.functions.invoke('image-to-video-submit', {
    body: { prompt, image: uploaded.publicUrl, duration: '5' },
  });
  if (error) throw error;

  // 4. 用 data.data.task_id 轮询查询接口（见 query-task-api.md）
  return data.data.task_id;
};
```

**CRITICAL 注意事项（App 平台）：**

- **必须使用 `expo/fetch`** 获取远程文件，全局 fetch 在部分 Android 设备上 `arrayBuffer()` 返回空
- 直接使用 ArrayBuffer 上传，跳过 Blob 中间层，iOS / Android / Web 三端行为一致
- 上传时必须传入正确的 `contentType`，否则 Storage 无法识别文件类型
- 用户设备本地图片路径不可直接传给 API，必须先上传至 Supabase Storage 获取公开 URL

---

## 注意事项

- **图片上传规则：** 用户上传的图片必须先转存到 Supabase Storage，再将永久 URL 传入本接口。不可直接传用户设备本地路径。
- **Base64 格式：** 使用 Base64 编码时，直接传编码字符串，不加 `data:image/png;base64,` 等前缀。
- **图片约束：** 格式 jpg/jpeg/png，大小 ≤ 10MB，分辨率 ≥ 300×300px，宽高比 1:2.5 ~ 2.5:1。
- **异步接口：** 本接口返回 `task_id`，需使用查询接口轮询获取生成结果（见 `query-task-api.md`）。
- **密钥安全：** `INTEGRATIONS_API_KEY` 仅在 Edge Function 服务端读取，严禁暴露到前端。
- **错误处理：** 务必处理 429（配额超限）和 402（余额不足）。
- **计费：** 本接口启用计费（`enable_billing: true`，`need_count_calls: true`），原价 ¥130.00，折扣价 ¥85.00，请避免不必要的重复调用。
