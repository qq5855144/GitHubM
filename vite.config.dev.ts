
    import * as vite from 'vite';
    import { defineConfig, loadConfigFromFile } from "vite";
    import type { Plugin, ConfigEnv } from "vite";
    import tailwindcss from "tailwindcss";
    import autoprefixer from "autoprefixer";
    import fs from "fs/promises";
    import path from "path";
    import {
      makeTagger,
      injectedGuiListenerPlugin,
      injectOnErrorPlugin,
      monitorPlugin
    } from "miaoda-sc-plugin";

    export default defineConfig(async () => {
      const env: ConfigEnv = { command: "serve", mode: "development" };
      const configFile = path.resolve(__dirname, "vite.config.ts");
      const result = await loadConfigFromFile(env, configFile);
      const userConfig = result?.config;

      const viteVersionInfo = {
        version: vite.version,
        rollupVersion: (vite as any).rollupVersion ?? null,
        rolldownVersion: (vite as any).rolldownVersion ?? null,
        isRolldownVite: 'rolldownVersion' in vite
      };

      return {
        ...userConfig,
        define: {
          __VITE_INFO__: JSON.stringify(viteVersionInfo),
          ...(userConfig?.define || {})
        },
        // 将 Vite 缓存目录设置为项目本地目录，避免在 /workspace/node_modules/ 下创建
        cacheDir: path.resolve(__dirname, "node_modules/.vite"),
        server: {
          ...(userConfig?.server || {}),
          warmup: { clientFiles: ["./src/main.tsx"] }
        },
        plugins: [
          makeTagger(),
          injectedGuiListenerPlugin({
            path: 'https://resource-static.cdn.bcebos.com/common/v2/injected.js'
          }),
          injectOnErrorPlugin(),
          ...(userConfig?.plugins || []),
          
{
  name: 'hmr-toggle',
  configureServer(server) {
    let hmrEnabled = true;

    // 包装原来的 send 方法
    const _send = server.ws.send;
    server.ws.send = (payload) => {
      if (hmrEnabled) {
        return _send.call(server.ws, payload);
      } else {
        console.log('[HMR disabled] skipped payload:', payload.type);
      }
    };

    // 提供接口切换 HMR
    server.middlewares.use('/innerapi/v1/sourcecode/__hmr_off', (req, res) => {
      hmrEnabled = false;
      let body = {
          status: 0,
          msg: 'HMR disabled'
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    });

    server.middlewares.use('/innerapi/v1/sourcecode/__hmr_on', (req, res) => {
      hmrEnabled = true;
      let body = {
          status: 0,
          msg: 'HMR enabled'
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    });

    // 注册一个 HTTP API，用来手动触发一次整体刷新
    server.middlewares.use('/innerapi/v1/sourcecode/__hmr_reload', (req, res) => {
      if (hmrEnabled) {
        server.ws.send({
          type: 'full-reload',
          path: '*', // 整页刷新
        });
      }
      res.statusCode = 200;
      let body = {
          status: 0,
          msg: 'Manual full reload triggered'
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    });
  },
  load(id) {
    if (id === 'virtual:after-update') {
      return `
        if (import.meta.hot) {
          import.meta.hot.on('vite:afterUpdate', () => {
            window.postMessage(
              {
                type: 'editor-update'
              },
              '*'
            );
          });
        }
      `;
    }
  },
  transformIndexHtml(html) {
    return {
      html,
      tags: [
        {
          tag: 'script',
          attrs: {
            type: 'module',
            src: '/@id/virtual:after-update'
          },
          injectTo: 'body'
        }
      ]
    };
  }
},
,
          monitorPlugin(
            {
              scriptSrc: 'https://resource-static.cdn.bcebos.com/sentry/browser.sentry.min.js',
              sentryDsn: 'https://e3c07b90fcb5207f333d50ac24a99d3e@sentry.miaoda.cn/233',
              environment: 'undefined',
              appId: 'app-bo4w33bsdqm9'
            }
          )
        ]
      };
    });
    