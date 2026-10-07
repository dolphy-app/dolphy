import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, defineConfig } from 'vite';
import type { Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import electron from 'vite-plugin-electron/multi-env';

// «запретить всё», кроме нужного; шрифты (Roboto, MDI) — с 'self' и data:
// (Vite инлайнит мелкие подмножества шрифтов); модули и ресурсы расширений
// (стили, изображения, шрифты) — с dolphy-ext:; в dev HMR требует websocket
const CSP = {
  build:
    "default-src 'none'; script-src 'self' dolphy-ext:; style-src 'self' 'unsafe-inline' dolphy-ext:; img-src 'self' data: dolphy-ext:; font-src 'self' data: dolphy-ext:; connect-src 'self'",
  serve:
    "default-src 'none'; script-src 'self' dolphy-ext:; style-src 'self' 'unsafe-inline' dolphy-ext:; img-src 'self' data: dolphy-ext:; font-src 'self' data: dolphy-ext:; connect-src 'self' ws://localhost:* http://localhost:*",
} as const;

const csp = (command: 'build' | 'serve'): Plugin => ({
  name: 'dolphy:csp',
  transformIndexHtml: (html) => html.replace('__CSP__', CSP[command]),
});

const REPO_ROOT = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../..',
);

// расширения по умолчанию (packages/ext-*) собираются в каталоги и кладутся
// рядом с приложением: <outRoot>/extensions/<id>/ (в упаковке — extraResources)
const extensions = (target: string): Plugin => ({
  name: 'dolphy:extensions',
  buildStart() {
    const packages = path.join(REPO_ROOT, 'packages');
    fs.rmSync(target, { recursive: true, force: true });
    const dirs = fs
      .readdirSync(packages)
      .filter((name) => name.startsWith('ext-'));
    for (const name of dirs) {
      const dir = path.join(packages, name);
      const pkg = JSON.parse(
        fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
      ) as { name: string };
      execFileSync('pnpm', ['-F', pkg.name, 'build'], {
        cwd: REPO_ROOT,
        stdio: 'inherit',
        // на Windows pnpm — pnpm.cmd, без оболочки spawn его не находит (ENOENT)
        shell: process.platform === 'win32',
      });
      const built = path.join(dir, 'dist-ext');
      const ids = fs
        .readdirSync(built, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      if (ids.length !== 1) {
        throw new Error(`${pkg.name}: dist-ext must contain one extension`);
      }
      const [id] = ids;
      const manifest = JSON.parse(
        fs.readFileSync(path.join(built, id, 'extension.json'), 'utf8'),
      ) as { id: string };
      if (manifest.id !== id) {
        throw new Error(`${pkg.name}: manifest id '${manifest.id}' != '${id}'`);
      }
      fs.cpSync(path.join(built, id), path.join(target, id), {
        recursive: true,
      });
    }
  },
});

// дочерний процесс для кода расширений не из поставки: один самодостаточный
// ES-модуль <outRoot>/restricted/ext-restricted.mjs (в упаковке — extraResources,
// вне asar: режим разрешений Node проверяет настоящие пути файлов)
const restrictedChild = (target: string): Plugin => ({
  name: 'dolphy:restricted-child',
  async buildStart() {
    fs.rmSync(target, { recursive: true, force: true });
    await build({
      root: fileURLToPath(new URL('.', import.meta.url)),
      configFile: false,
      publicDir: false,
      logLevel: 'warn',
      build: {
        target: 'node22',
        outDir: path.resolve(target),
        emptyOutDir: true,
        minify: false,
        copyPublicDir: false,
        lib: {
          entry: 'electron/ext-host/restricted-child.ts',
          formats: ['es'],
          fileName: () => 'ext-restricted.mjs',
        },
        rolldownOptions: { external: [/^node:/, ...builtinModules] },
      },
    });
  },
});

// нативный модуль не бандлится: грузится из node_modules (asarUnpack)
const NATIVE = ['better-sqlite3'];

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  // смоук-сборка (DOLPHY_SMOKE_BUILD=1) включает код смоука и пишет в dist-smoke,
  // релизная — в dist и dist-electron; DOLPHY_BUILD_OUT задаёт корень явно
  // (тест «релиз без смоука» собирает во временный каталог)
  const smokeBuild = process.env.DOLPHY_SMOKE_BUILD === '1';
  const outRoot =
    process.env.DOLPHY_BUILD_OUT ?? (smokeBuild ? 'dist-smoke' : '.');
  const out = (dir: string) => path.join(outRoot, dir);
  fs.rmSync(out('dist-electron'), { recursive: true, force: true });

  const isServe = command === 'serve';
  const isBuild = command === 'build';
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG;

  // vite-plugin-electron/multi-env задаёт окружениям свой `define`, и
  // верхнеуровневый не доходит до main/preload/host — дублируем в каждое
  const define = { __DOLPHY_SMOKE_BUILD__: JSON.stringify(smokeBuild) };

  return {
    define,
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: { outDir: out('dist'), emptyOutDir: true },
    plugins: [
      vue(),
      vuetify(),
      csp(command),
      extensions(out('extensions')),
      restrictedChild(out('restricted')),
      electron([
        {
          name: 'main',
          input: 'electron/main/index.ts',
          options: {
            define,
            build: {
              sourcemap,
              minify: isBuild,
              outDir: out('dist-electron/main'),
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
            define,
            build: {
              sourcemap: sourcemap ? 'inline' : undefined, // #332
              minify: isBuild,
              outDir: out('dist-electron/preload'),
              copyPublicDir: false,
              rolldownOptions: {
                output: { format: 'cjs', entryFileNames: '[name].cjs' },
              },
            },
          },
        },
        {
          // хост движка и хост расширений: бандл с workspace-пакетами и
          // зависимостями, кроме нативного модуля
          name: 'host',
          input: {
            index: 'electron/host/index.ts',
            'ext-host': 'electron/ext-host/index.ts',
          },
          bundleDeps: { both: { include: true, exclude: NATIVE } },
          options: {
            define,
            build: {
              sourcemap,
              minify: false,
              outDir: out('dist-electron/host'),
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
