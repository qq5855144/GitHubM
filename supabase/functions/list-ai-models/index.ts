// list-ai-models Edge Function
// 通过服务端代理获取各 AI 平台的可用模型列表，避免前端直接暴露 API Key 及 CORS 问题
// 支持：DeepSeek / OpenAI / 自定义 OpenAI 兼容接口

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 各平台 /v1/models 端点
const PLATFORM_ENDPOINTS: Record<string, string> = {
  deepseek: "https://api.deepseek.com/v1/models",
  openai:   "https://api.openai.com/v1/models",
};

// 过滤规则：只保留对话/生成类模型
function filterChatModels(ids: string[], type: string): string[] {
  if (type === "openai") {
    // 只保留 gpt- 开头的模型，排除 whisper/dall-e/tts/embedding 等
    return ids
      .filter(id =>
        (id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("chatgpt")) &&
        !id.includes("instruct") &&
        !id.includes("realtime")
      )
      .sort((a, b) => {
        // 推荐顺序：gpt-4o > gpt-4 > gpt-3.5
        const priority = (id: string) => {
          if (id.startsWith("o3") || id.startsWith("o1")) return 0;
          if (id.includes("gpt-4o") && !id.includes("mini")) return 1;
          if (id.includes("gpt-4o-mini")) return 2;
          if (id.includes("gpt-4")) return 3;
          return 9;
        };
        return priority(a) - priority(b);
      });
  }
  if (type === "deepseek") {
    // deepseek 只显示 chat/reasoner 模型
    return ids.filter(id => id.includes("deepseek"));
  }
  // custom: 返回所有
  return ids;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  let type: string, api_key: string, endpoint: string | undefined;

  try {
    const body = await req.json();
    type = body.type;
    api_key = body.api_key;
    endpoint = body.endpoint;

    if (!type) throw new Error("缺少参数: type");
    if (type !== "wenxin" && !api_key?.trim()) throw new Error("缺少参数: api_key");
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 文心不需要动态获取
  if (type === "wenxin") {
    return new Response(
      JSON.stringify({ models: [{ id: "ernie-4.5-turbo", name: "ERNIE 4.5 Turbo" }] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 确定请求地址
  let modelsUrl: string;
  if (type === "custom") {
    if (!endpoint) {
      return new Response(
        JSON.stringify({ error: "自定义接口需要填写接口地址" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // 从 completions 地址推断 models 地址（去掉 /chat/completions 换成 /models）
    modelsUrl = endpoint.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "") + "/models";
  } else {
    modelsUrl = PLATFORM_ENDPOINTS[type];
    if (!modelsUrl) {
      return new Response(
        JSON.stringify({ error: `不支持的模型类型: ${type}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // 请求上游 /v1/models
  let res: Response;
  try {
    res = await fetch(modelsUrl, {
      headers: {
        Authorization: `Bearer ${api_key}`,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `网络请求失败: ${(err as Error).message}` }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!res.ok) {
    const errText = await res.text();
    let message = `API 返回 ${res.status}`;
    try {
      const parsed = JSON.parse(errText);
      message = parsed.error?.message || parsed.message || message;
    } catch { /* ignore */ }
    return new Response(
      JSON.stringify({ error: message }),
      { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let data: { data?: Array<{ id: string; owned_by?: string }> };
  try {
    data = await res.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "解析响应失败，接口可能不兼容" }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const allIds = (data.data || []).map(m => m.id).filter(Boolean);
  const filtered = filterChatModels(allIds, type);

  return new Response(
    JSON.stringify({
      models: filtered.map(id => ({ id, name: id })),
      total: allIds.length,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
