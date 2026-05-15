/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** CI 注入的版本号，格式 "1.0.<run_number>"；本地开发时为 undefined */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
