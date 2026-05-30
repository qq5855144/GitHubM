import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  // './' 使静态资源使用相对路径，确保在 GitHub Pages 子目录或 WebView file:// 下正确加载
  base: "./",
  plugins: [
    react(),
    svgr({
      svgrOptions: {
        icon: true,
        exportType: "named",
        namedExport: "ReactComponent",
      },
    }),
    // ── 移除 crossorigin 属性（WebView file:// 白屏修复）──────────
    // Vite 默认为 type="module" script 和 stylesheet link 添加 crossorigin，
    // 该属性会在 file:// 协议下触发 CORS 预检，而 file:// 协议没有 Origin，
    // 导致 WebView 静默拒绝加载脚本和样式，产生白屏。
    // GitHub Pages 不受影响（https:// 同源，crossorigin 可有可无）。
    {
      name: "remove-crossorigin",
      transformIndexHtml(html: string) {
        return html
          .replace(/<script\b([^>]*)\s+crossorigin\b([^>]*)>/g, "<script$1$2>")
          .replace(/<link\b([^>]*)\s+crossorigin\b([^>]*?)>/g, "<link$1$2>");
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // ── Vitest 配置 ────────────────────────────────────────────────────
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/tests/**/*.test.ts", "src/tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/services/**", "src/pages/**", "src/utils/**"],
      reporter: ["text", "html"],
    },
  },
  build: {
    // 关闭 sourcemap，减小 APK 内嵌包体积
    sourcemap: false,
    // 静态资源统一放 assets/ 目录
    assetsDir: "assets",
    chunkSizeWarningLimit: 2000,
    // 关闭 <link rel="modulepreload">：
    // WebView 以 file:// 加载时，modulepreload 会触发额外的文件请求，
    // 在部分 Android 版本中会因 file:// 跨资源限制而静默失败，导致白屏/黑屏
    modulePreload: false,
    rollupOptions: {
      output: {
        // 不做 manualChunks 拆分：
        // file:// 协议下，动态 import() 跨 chunk 文件在部分 WebView 版本中
        // 受同源策略限制，可能被阻断，导致 React 无法完成初始化渲染。
        // 不拆包后，所有代码合并进少量静态 chunk，WebView 可以顺序加载，无动态 import 权限问题。
        manualChunks: undefined,
      },
    },
  },
});
