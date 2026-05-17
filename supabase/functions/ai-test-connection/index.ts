// AI 连接测试 Edge Function
// 向指定平台发送一条极简消息("Hi")，验证 API Key 有效性，返回响应延迟或错误原因

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 各平台的 Chat Completions 接口地址
function getEndpointAndHeaders(type: string, apiKey: string, endpoint?: string): {
  url: string;
  headers: Record<string, string>;
  model: string;
} {
  switch (type) {
    case "deepseek":
      return {
        url: "https://api.deepseek.com/v1/chat/completions",
        headers: { Authorization: `Bearer ${apiKey}` },
        model: "deepseek-chat",
      };
    case "gemini":
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        headers: { Authorization: `Bearer ${apiKey}` },
        model: "gemini-2.5-flash-preview-05-20",
      };
    case "qwen":
      return {
        url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        headers: { Authorization: `Bearer ${apiKey}` },
        model: "qwen2.5-coder-32b-instruct",
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: { Authorization: `Bearer ${apiKey}` },
        model: "gpt-4o-mini",
      };
    case "custom":
      return {
        url: endpoint || "",
        headers: { Authorization: `Bearer ${apiKey}` },
        model: "gpt-3.5-turbo",
      };
    default:
      throw new Error(`不支持测试连接的平台类型：${type}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, api_key, model, endpoint } = await req.json();

    if (!type) {
      return new Response(
        JSON.stringify({ success: false, error: "缺少平台类型参数" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 文心由平台内置，无需测试
    if (type === "wenxin") {
      return new Response(
        JSON.stringify({ success: false, error: "文心由平台内置，无需测试连接" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!api_key?.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: "请先填写 API Key" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { url, headers, model: defaultModel } = getEndpointAndHeaders(type, api_key.trim(), endpoint);

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: "自定义接口地址不能为空" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const useModel = model?.trim() || defaultModel;

    // 使用 10s 超时
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort("test-timeout"), 10_000);

    const startMs = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          model: useModel,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 5,
          stream: false,
        }),
        signal: abort.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const err = e as Error;
      if (err?.name === "AbortError" || String(err?.message).includes("timeout")) {
        return new Response(
          JSON.stringify({ success: false, error: "连接超时（10s），请检查网络或 API Key 是否有效" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: `网络请求失败：${err.message}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    clearTimeout(timer);

    const elapsedMs = Date.now() - startMs;

    if (!res.ok) {
      let errText = "";
      try { errText = await res.text(); } catch { /* ignore */ }
      let errMsg = "";
      try {
        const parsed = JSON.parse(errText);
        errMsg = parsed?.error?.message || parsed?.error || parsed?.message || "";
      } catch { /* not JSON */ }
      if (!errMsg) {
        errMsg = errText.replace(/\s+/g, " ").trim().slice(0, 300) || res.statusText;
      }

      // 常见错误码友好提示
      let hint = errMsg;
      if (res.status === 401) hint = `API Key 无效或已过期（${errMsg || "401 Unauthorized"}）`;
      else if (res.status === 402) hint = `账户余额不足，请前往平台充值（${errMsg || "402 Payment Required"}）`;
      else if (res.status === 403) hint = `无访问权限（${errMsg || "403 Forbidden"}）`;
      else if (res.status === 429) hint = `请求频率超限，请稍后再试（${errMsg || "429 Too Many Requests"}）`;
      else if (res.status >= 500) hint = `平台服务异常（${res.status}），请稍后重试`;

      return new Response(
        JSON.stringify({ success: false, error: hint }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 成功：不需要读取响应体，延迟即可
    return new Response(
      JSON.stringify({ success: true, elapsedMs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
