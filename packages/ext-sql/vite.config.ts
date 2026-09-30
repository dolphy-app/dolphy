import { build, defineConfig } from 'vite';
import type { InlineConfig, Plugin } from 'vite';

// Бандлы под Node самодостаточны: внешние — только встроенные модули и
// better-sqlite3 (драйвер запасного профиля, грузится лениво через require).
const nodeBundle = (
  entry: string,
  file: string,
  emptyOutDir: boolean,
): InlineConfig => ({
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    target: 'node22',
    outDir: 'dist-ext',
    emptyOutDir,
    minify: false,
    copyPublicDir: false,
    lib: { entry, formats: ['es'], fileName: () => file },
    rolldownOptions: { external: [/^node:/, 'better-sqlite3'] },
  },
});

// отдельная сборка воркера: общий чанк с main.mjs дал бы лишний файл в каталоге
const workerBundle = (): Plugin => ({
  name: 'lms:worker-bundle',
  async closeBundle() {
    await build(nodeBundle('src/worker.ts', 'worker.mjs', false));
  },
});

// `main` — код расширения (+ воркер раннера), `view` — элемент ответа под браузер
export default defineConfig(({ mode }) => {
  if (mode === 'main') {
    return {
      ...nodeBundle('src/main.ts', 'main.mjs', true),
      plugins: [workerBundle()],
    };
  }
  return {
    publicDir: false,
    build: {
      target: 'es2022',
      outDir: 'dist-ext',
      emptyOutDir: false,
      minify: false,
      copyPublicDir: false,
      lib: {
        entry: 'src/view.ts',
        formats: ['es'],
        fileName: () => 'view.mjs',
      },
    },
  };
});
