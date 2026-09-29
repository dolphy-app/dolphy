import fs from 'node:fs';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import electron from 'vite-plugin-electron/multi-env';

// «запретить всё», кроме нужного; в dev Vite HMR требует websocket
const CSP = {
  build:
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
  serve:
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:* http://localhost:*",
} as const;

const csp = (command: 'build' | 'serve'): Plugin => ({
  name: 'lms:csp',
  transformIndexHtml: (html) => html.replace('__CSP__', CSP[command]),
});

// нативный модуль не бандлится: грузится из node_modules (asarUnpack)
const NATIVE = ['better-sqlite3'];

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  fs.rmSync('dist-electron', { recursive: true, force: true });

  const isServe = command === 'serve';
  const isBuild = command === 'build';
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG;

  return {
    plugins: [
      vue(),
      csp(command),
      electron([
        {
          name: 'main',
          input: 'electron/main/index.ts',
          options: {
            build: {
              sourcemap,
              minify: isBuild,
              outDir: 'dist-electron/main',
              copyPublicDir: false,
            },
          },
        },
        {
          name: 'preload',
          input: { index: 'electron/preload/index.ts' },
          // sandbox: true не грузит ESM-preload, поэтому CJS
          onstart: ({ reload }) => reload(),
          options: {
            build: {
              sourcemap: sourcemap ? 'inline' : undefined, // #332
              minify: isBuild,
              outDir: 'dist-electron/preload',
              copyPublicDir: false,
              rolldownOptions: {
                output: { format: 'cjs', entryFileNames: '[name].cjs' },
              },
            },
          },
        },
        {
          // хост движка и вход дочернего процесса раннера SQL: бандл с
          // workspace-пакетами и зависимостями, кроме нативного модуля
          name: 'host',
          input: {
            index: 'electron/host/index.ts',
            'sql-worker': 'electron/host/sql-worker.ts',
          },
          bundleDeps: { both: { include: true, exclude: NATIVE } },
          options: {
            build: {
              sourcemap,
              minify: false,
              outDir: 'dist-electron/host',
              copyPublicDir: false,
              rolldownOptions: { external: NATIVE },
            },
          },
        },
      ]),
    ],
    clearScreen: false,
  };
});
