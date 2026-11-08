/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** CI 注入的版本号，格式 "1.0.<run_number>"；本地开发时为 undefined */
  readonly VITE_APP_VERSION?: string;
  /** 全网访问统计 Worker 地址，例如 https://githubm-stats.xxx.workers.dev */
  readonly VITE_STATS_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
