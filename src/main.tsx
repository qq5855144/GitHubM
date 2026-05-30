// ── Polyfills（兼容低版本 Android WebView）──────────────────────────
// Object.hasOwn 是 ES2022 API，Android 11 及以下 WebView（Chromium < 93）不支持。
// react-markdown v10 / rehype-highlight v7 直接调用此方法，不兼容旧版本 WebView，
// 在仓库详情页渲染 README 时会抛出 "Object.hasOwn is not a function"。
// 使用 (Object as any) 避免 tsconfig lib:ES2020 下的类型报错。
if (typeof (Object as any).hasOwn !== "function") {
  (Object as any).hasOwn = (obj: object, prop: PropertyKey) =>
    Object.prototype.hasOwnProperty.call(obj, prop);
}

// crypto.randomUUID 是 ES2021 API（Chrome 92），旧版 WebView 不支持。
// 降级为 Math.random 拼接的 UUID v4 格式，功能等价。
if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
  const cr = (typeof crypto !== "undefined" ? crypto : {}) as Crypto;
  (cr as any).randomUUID = (): string => {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  };
}

import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import { ThemeProvider } from "./contexts/ThemeContext.tsx";

createRoot(document.getElementById("root")!).render(
  <AppWrapper>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </AppWrapper>
);
