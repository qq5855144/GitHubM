---
name: image-generation-super
description: 图片生成与编辑 (超级版)，调用 GPT-Image-2 模型生成和编辑图片。当用户需要 AI 画图、生成图片、编辑图片、多图融合、背景替换、风格转换、电商商品图合成、海报设计、插画创作时触发。支持文本生成图片和多图 AI 编辑。
license: MIT
---

## 能力概述

调用 GPT-Image-2 模型进行 AI 图像生成与编辑，支持通过自然语言描述生成高质量图片，以及上传多张图片进行 AI 编辑融合。

| 属性 | 值 |
|------|-----|
| Plugin ID | `e480d4b6-835c-45f8-a494-d38da962b394` |
| 认证模式 | `platform_managed`（密钥由平台注入） |
| 密钥来源 | `process.env["INTEGRATIONS_API_KEY"]` |
| Auth Header | `X-Gateway-Authorization: Bearer <key>` |
| 支持平台 | Web、MiniProgram |
| 响应格式 | JSON，图片以 Base64 编码内嵌于 `data[].b64_json` |

**接口列表：**

| 接口 | 方法 | Endpoint | 说明 |
|------|------|----------|------|
| 创建图片 | POST | `http://app-bo4w33bsdqm9-api-wLNdpny6ZpVa-gateway.appmiaoda.com/v1/images/generations` | 根据文本描述生成图片 |
| 编辑图片 | POST | `http://app-bo4w33bsdqm9-api-baBw3XMNVmv9-gateway.appmiaoda.com/v1/images/edits` | 上传 1–3 张图片进行 AI 编辑融合 |

**核心能力：**

- **文生图**：通过 `prompt` 描述生成全新图片，支持多种尺寸和数量配置
- **多图编辑**：上传 1–3 张图片，通过文本描述控制融合、背景替换、风格统一、局部重绘等效果
- **提示词优化**：接口返回 `revised_prompt`，展示模型自动优化后的提示词

**平台差异概览：**

| 平台 | Edge Function 返回 | 前端获取图片方式 |
|------|-------------------|----------------|
| Web | JSON（含 Base64） | 解析 JSON，构造 `data:image/png;base64,...` URI 或用 Blob 渲染 |
| MiniProgram | JSON（含 Base64） | 解析 JSON，写临时文件后用 `<image>` 组件展示 |

详细参数说明、代码示例及两平台完整实现见：
- `references/image-generations-api.md` — 创建图片接口
- `references/image-edits-api.md` — 编辑图片接口

---

## 生成期用法（Agent 直接调用）

两个接口均为同步调用，直接返回 Base64 编码图片数据，不含 URL。获得响应后必须立即将 Base64 解码保存为图片文件。

```typescript
const apiKey = process.env["INTEGRATIONS_API_KEY"]!;

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

/** 创建图片（文生图） */
async function createImage(
  prompt: string,
  size?: string,
  n?: number
): Promise<CreateImageResult> {
  const response = await fetch(
    "http://app-bo4w33bsdqm9-api-wLNdpny6ZpVa-gateway.appmiaoda.com/v1/images/generations",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt,
        size,
        n,
      }),
    }
  );
  if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
  const json = await response.json();
  if (json.error) throw new Error(`API error: ${JSON.stringify(json.error)}`);
  return json;
}

interface EditImageResult {
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
  usage?: {
    input_tokens: number;
    input_tokens_details: { image_tokens: number; text_tokens: number };
    output_tokens: number;
    output_tokens_details: { image_tokens: number; text_tokens: number };
    total_tokens: number;
  };
}

/** 编辑图片（多图融合/编辑） */
async function editImage(
  prompt: string,
  images: File[],
  size?: string,
  n?: number
): Promise<EditImageResult> {
  const formData = new FormData();
  formData.append("model", "gpt-image-2");
  formData.append("prompt", prompt);
  if (size) formData.append("size", size);
  if (n) formData.append("n", String(n));
  images.forEach((file, index) => {
    formData.append(`image[${index}]`, file);
  });

  const response = await fetch(
    "http://app-bo4w33bsdqm9-api-baBw3XMNVmv9-gateway.appmiaoda.com/v1/images/edits",
    {
      method: "POST",
      headers: {
        "X-Gateway-Authorization": `Bearer ${apiKey}`,
      },
      body: formData,
    }
  );
  if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
  const json = await response.json();
  if (json.error) throw new Error(`API error: ${JSON.stringify(json.error)}`);
  return json;
}
```

**生成期文件保存（必须执行）：**

两个接口均返回 Base64 编码图片，数据仅存在于当次响应中。获得 Base64 后，**必须立即使用 Bash 工具将其解码并保存到本地**，以便用户查看结果。

```bash
echo "<base64_data>" | base64 -d > <本地路径>.png
```

**完整生成期工作流（含保存步骤）：**

1. 根据用户需求选择对应接口（`createImage` 或 `editImage`）
2. 构造请求参数并调用接口获取响应
3. 从 `json.data[0].b64_json` 提取 Base64 数据
4. 使用 Bash 工具将 Base64 解码并保存：`echo "<b64_json>" | base64 -d > <本地路径>.png`
5. 告知用户文件已保存到对应路径，同时展示 `revised_prompt`

> **注意**：Base64 数据仅存在于当次响应中，必须及时保存，否则数据丢失。

---

## 生成后用法（应用内通过 Edge Function 调用）

应用内通过 Edge Function 安全调用上游 API，密钥不暴露给前端。

**安全合约：**
- 前端只发送业务参数到 Edge Function，不接触 API Key
- Edge Function 从 `Deno.env.get("INTEGRATIONS_API_KEY")` 读取密钥
- 请求上游时注入 `X-Gateway-Authorization: Bearer ${apiKey}`
- `429`（配额超限）和 `402`（余额不足）错误体原样透传给前端
- 返回的 Base64 数据由前端接收并解码渲染

**Edge Function 实现：**
- `image-generations`：代理创建图片接口，处理 JSON 请求
- `image-edits`：代理编辑图片接口，处理 multipart/form-data 请求

完整 Edge Function 代码和前端调用代码详见：
- `references/image-generations-api.md`（创建图片的 Edge Function + 前端代码）
- `references/image-edits-api.md`（编辑图片的 Edge Function + 前端代码）

---

## 参数说明

### 创建图片核心参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | `string` | 是 | 固定值：`gpt-image-2` |
| `prompt` | `string` | 是 | 图片生成描述词 |
| `size` | `string` | 否 | 输出尺寸：`1024x1024`、`1536x1024`、`1024x1536`、`2848x1152` |
| `n` | `integer` | 否 | 生成数量，默认 1 |

### 编辑图片核心参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | `string` | 是 | 固定值：`gpt-image-2` |
| `prompt` | `string` | 是 | 图片编辑描述词 |
| `size` | `string` | 否 | 输出尺寸 |
| `n` | `integer` | 否 | 输出数量，默认 1 |
| `image[0]` | `file` | 是 | 主图片文件 |
| `image[1]` | `file` | 否 | 附加图片文件 |
| `image[2]` | `file` | 否 | 附加图片文件 |

### 返回核心字段

| 字段路径 | 类型 | 说明 |
|----------|------|------|
| `created` | `number` | 创建时间戳 |
| `data` | `array` | 生成结果列表 |
| `data[].b64_json` | `string` | Base64 编码图片内容 |
| `data[].revised_prompt` | `string` | 模型自动优化后的提示词 |
| `usage` | `object` | Token 消耗统计（仅编辑接口返回） |

---

## 注意事项

- **密钥安全**：`INTEGRATIONS_API_KEY` 仅可在 Edge Function 服务端读取，严禁暴露到前端代码或客户端环境变量中。
- **Base64 数据及时保存**：两个接口均返回 Base64 编码图片，数据仅存在于当次响应中。生成期必须在获得响应后立即使用 Bash `base64 -d` 保存为文件。
- **文件上传限制**：编辑接口最多支持 3 张图片（`image[0]` 必填，`image[1]`、`image[2]` 可选），需确保图片格式和大小符合上游要求。
- **错误处理**：
  - `429` — 配额已用尽
  - `402` — 余额不足
  - `400` — 请求参数错误
  - `401` — 认证失败
- **计费**：本插件未启用计费（`enable_billing: false`），但仍需确保 API Key 有效且配额充足。
