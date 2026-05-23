# 创建图片接口 — 完整规格与实现

## API 基本信息

| 字段 | 值                                                                         |
|------|---------------------------------------------------------------------------|
| Plugin ID | `e480d4b6-835c-45f8-a494-d38da962b394`                                    |
| API ID | `api-wLNdpny6ZpVa`                                                        |
| Endpoint | `POST http://app-bo4w33bsdqm9-api-wLNdpny6ZpVa-gateway.appmiaoda.com/v1/images/generations` |
| Content-Type | `application/json`                                                        |
| 认证模式 | `platform_managed`                                                        |
| Auth Header | `X-Gateway-Authorization: Bearer ${INTEGRATIONS_API_KEY}`                 |
| 支持平台 | Web、MiniProgram                                                           |

---

## 请求参数表

### 顶层参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `model` | `string` | 是 | 固定值：`gpt-image-2` |
| `prompt` | `string` | 是 | 图片生成描述词，越详细效果越好 |
| `size` | `string` | 否 | 输出图片尺寸：`1024x1024`、`1536x1024`、`1024x1536`、`2848x1152` |
| `n` | `integer` | 否 | 生成图片数量，默认 1 |

---

## 响应字段表

### 成功响应（HTTP 200）

```json
{
  "created": 1778148759,
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAAANSUhEUgAA...",
      "revised_prompt": "赛博朋克东京夜景，霓虹灯，电影感，超高细节，电影级光影"
    }
  ],
  "background": "auto",
  "output_format": "png",
  "quality": "auto",
  "size": "1536x1024",
  "model": "gpt-image-2"
}
```

| 字段路径 | 类型 | 说明 |
|----------|------|------|
| `created` | `number` | 创建时间戳 |
| `data` | `array` | 生成结果列表 |
| `data[].b64_json` | `string` | Base64 编码后的图片内容，需解码后保存为 png/jpg 文件 |
| `data[].revised_prompt` | `string` | 模型自动优化后的提示词 |
| `background` | `string` | 背景设置（如 `auto`） |
| `output_format` | `string` | 输出格式（如 `png`） |
| `quality` | `string` | 图片质量（如 `auto`） |
| `size` | `string` | 输出尺寸 |
| `model` | `string` | 使用的模型 |

---

## 生成期代码（TypeScript）

生成期由 Agent 直接调用上游 API。认证使用 `platform_managed` 模式，密钥由平台注入。

```typescript
const apiKey = process.env["INTEGRATIONS_API_KEY"]!;

interface CreateImageParams {
  model: "gpt-image-2";
  prompt: string;
  size?: string;
  n?: number;
}

interface CreateImageResult {
  created: number;
  data: Array<{
    b64_json: string;
    revised_prompt: string;
  }>;
  background: string;
  output_format: string;
  quality: string;
  size: string;
  model: string;
}

async function createImage(params: CreateImageParams): Promise<CreateImageResult> {
  const response = await fetch(
    "http://app-bo4w33bsdqm9-api-wLNdpny6ZpVa-gateway.appmiaoda.com/v1/images/generations",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(params),
    }
  );

  if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

  const json = await response.json();
  if (json.error) throw new Error(`API error: ${JSON.stringify(json.error)}`);

  return json;
}
```

### 生成期文件保存（必须执行）

本接口直接返回 **Base64 编码的媒体数据**（不含 URL），在生成期获得 Base64 数据后，**必须立即使用 Bash 工具将其解码并保存到本地**，以便用户查看结果。

```bash
echo "<base64_data>" | base64 -d > <本地路径>.png
```

**完整生成期工作流（含保存步骤）：**

1. 调用 `createImage(params)` 获取响应
2. 从 `json.data[0].b64_json` 提取 Base64 数据
3. 使用 Bash 工具将 Base64 解码并保存：`echo "<b64_json>" | base64 -d > <本地路径>.png`
4. 告知用户文件已保存到对应路径，同时展示 `revised_prompt`

> **注意**：Base64 数据仅存在于当次响应中，必须及时保存，否则数据丢失。

---

## Edge Function 代码

### Web 平台

```typescript
// edge-functions/image-generations.ts
import { serve } from "https://deno.land/std/http/server.ts";

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // --- Parse client request ---
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body.prompt) throw new Error("Missing prompt");
    body.model = "gpt-image-2"; // enforce model
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Inject platform key (never expose to client) ---
  const apiKey = Deno.env.get("INTEGRATIONS_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Call upstream ---
  const upstream = await fetch(
    "http://app-bo4w33bsdqm9-api-wLNdpny6ZpVa-gateway.appmiaoda.com/v1/images/generations",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }
  );

  // Forward quota/balance errors verbatim
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

### MiniProgram 平台

MiniProgram 的 Edge Function 逻辑与 Web 平台相同（均返回 JSON），前端处理图片的方式略有不同（需写入临时文件后用 `<image>` 组件展示，weapp 真机不支持 `data:` URI 直接渲染）。

---

## 前端调用代码

### Web 平台（React / Vue / 原生 TypeScript）

**推荐方式（supabase client 可用时）：**

```typescript
async function createImage(params: { prompt: string; size?: string; n?: number }) {
  const { data, error } = await supabase.functions.invoke("image-generations", {
    body: params,
  });
  if (error) throw error;
  return data;
}
```

**备用方式（无法使用 supabase client 时）：**

```typescript
async function createImage(params: { prompt: string; size?: string; n?: number }) {
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/image-generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (res.status === 429) {
    const err = await res.json();
    throw new Error(`配额已用尽：${err.message ?? res.statusText}`);
  }
  if (res.status === 402) {
    const err = await res.json();
    throw new Error(`余额不足：${err.message ?? res.statusText}`);
  }
  if (!res.ok) throw new Error(`请求失败：${res.status}`);

  const json = await res.json();
  return json;
}
```

**前端解码 Base64：**

```typescript
const base64 = json.data[0].b64_json;
const byteCharacters = atob(base64);
const byteNumbers = new Array(byteCharacters.length);
for (let i = 0; i < byteCharacters.length; i++) {
  byteNumbers[i] = byteCharacters.charCodeAt(i);
}
const byteArray = new Uint8Array(byteNumbers);
const blob = new Blob([byteArray], { type: "image/png" });
const imageUrl = URL.createObjectURL(blob);
// 使用 imageUrl 在 <img> 中展示
```

### MiniProgram 平台（Taro / 原生小程序）

```typescript
import Taro from "@tarojs/taro";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.TARO_APP_SUPABASE_URL!,
  process.env.TARO_APP_SUPABASE_ANON_KEY!
);

async function createImage(params: { prompt: string; size?: string; n?: number }) {
  const { data, error } = await supabase.functions.invoke("image-generations", {
    body: params,
  });
  if (error) throw error;
  return data;
}

// 获取 Base64 后写入临时文件并展示
async function saveAndPreviewBase64(base64: string): Promise<string> {
  const fs = Taro.getFileSystemManager();
  const filePath = `${Taro.env.USER_DATA_PATH}/generated_${Date.now()}.png`;
  const buffer = Taro.base64ToArrayBuffer(base64);

  return new Promise((resolve, reject) => {
    fs.writeFile({
      filePath,
      data: buffer,
      encoding: "binary",
      success: () => resolve(filePath),
      fail: reject,
    });
  });
}

// 使用示例
const result = await createImage({ prompt: "一只可爱的猫咪", size: "1024x1024" });
const imagePath = await saveAndPreviewBase64(result.data[0].b64_json);
// <Image src={imagePath} mode="aspectFit" />
```

---

## 注意事项

1. **密钥安全**：`INTEGRATIONS_API_KEY` 仅可在 Edge Function 服务端读取，严禁暴露到前端。

2. **Base64 格式**：返回的 `b64_json` 是纯 Base64 字符串，不含 `data:image/xxx;base64,` 前缀，前端需自行拼接或转为 Blob。

3. **错误处理**：务必处理 429（配额超限）和 402（余额不足）两种错误状态码，这两种错误会从上游直接转发。

4. **支持的图片格式**：输出固定为 PNG 格式。
