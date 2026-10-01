import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createRestrictedRunner,
  discoverExtensions,
  inspectExtensionDir,
} from '@dolphy-app/extension-host';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const hostileDir = join(appDir, 'e2e/fixtures/hostile-extension');
const viteBin = join(
  dirname(createRequire(import.meta.url).resolve('vite/package.json')),
  'bin/vite.js',
);
const BUILD_TIMEOUT_MS = 120_000;
// шрифты и CSS (иконки MDI: `mdi-smoke-detector`) кода смоука содержать не могут
const CODE_FILE = /\.(?:[cm]?js|html)$/;
// `whitesmoke` — имя цвета CSS в таблице Vue Flow (граф знаний), не смоук
const SMOKE_MARKER = /(?<!white)smoke/i;

const outputs: string[] = [];

/** Настоящий `vite build` (без electron-builder) во временный каталог. */
const build = (smokeBuild: boolean): string => {
  const out = mkdtempSync(join(tmpdir(), 'dolphy-bundle-'));
  outputs.push(out);
  const env: NodeJS.ProcessEnv = { ...process.env, DOLPHY_BUILD_OUT: out };
  delete env.DOLPHY_SMOKE_BUILD;
  if (smokeBuild) env.DOLPHY_SMOKE_BUILD = '1';
  execFileSync(process.execPath, [viteBin, 'build'], {
    cwd: appDir,
    env,
    stdio: 'pipe',
  });
  return out;
};

const filesOf = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesOf(join(dir, entry.name))
      : [join(dir, entry.name)],
  );

const textOf = (root: string, part: string): string =>
  filesOf(root)
    .filter((file) => file.includes(part))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

afterAll(() => {
  for (const out of outputs) rmSync(out, { recursive: true, force: true });
});

describe('смоук и релизная сборка', () => {
  it(
    'релизный бандл не содержит кода смоука',
    () => {
      const out = build(false);
      const files = filesOf(out);
      expect(files.some((file) => file.includes('dist-electron/main'))).toBe(
        true,
      );
      const leaks = files.filter((file) => {
        if (!CODE_FILE.test(file)) return false;
        const text = readFileSync(file, 'utf8');
        return SMOKE_MARKER.test(text) || text.includes('sql_kb::where');
      });
      expect(leaks).toEqual([]);
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    'релизный бандл содержит расширения по умолчанию вне кода приложения',
    async () => {
      const out = build(false);
      const expected = {
        'dolphy.sql': [
          'extension.json',
          'main.mjs',
          'worker.mjs',
          'view.mjs',
          'schema/spec.json',
          'schema/answer.json',
        ],
        'dolphy.choice': [
          'extension.json',
          'main.mjs',
          'view.mjs',
          'schema/spec.json',
          'schema/answer.json',
        ],
        'dolphy.math': ['extension.json', 'markdown.mjs'],
      };
      for (const [id, names] of Object.entries(expected)) {
        for (const name of names) {
          expect(existsSync(join(out, 'extensions', id, name)), name).toBe(
            true,
          );
        }
      }
      const warnings: object[] = [];
      const logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: (fields: object) => warnings.push(fields),
        error: () => undefined,
      };
      const { extensions, diagnostics } = await discoverExtensions({
        roots: [{ dir: join(out, 'extensions'), origin: 'bundled' }],
        logger,
      });
      expect(extensions.map(({ id }) => id).sort()).toEqual([
        'dolphy.choice',
        'dolphy.math',
        'dolphy.sql',
      ]);
      expect(diagnostics).toEqual([]);
      expect(warnings).toEqual([]);
      expect(existsSync(join(out, 'dist-electron/host/sql-worker.js'))).toBe(
        false,
      );
      // собранный дочерний процесс запускается в режиме разрешений и
      // отказывает расширению в запрещённом
      const inspected = await inspectExtensionDir(hostileDir);
      if (!inspected.ok) throw new Error(inspected.message);
      const runner = createRestrictedRunner({
        extension: {
          ...inspected.extension,
          origin: 'user',
          install: null,
          revision: '',
        },
        entryPath: join(out, 'restricted/ext-restricted.mjs'),
        library: { readText: async () => '', stat: async () => null },
        logger,
      });
      try {
        const response = await runner.handle({
          id: '1',
          method: 'grade',
          params: {
            type: 'acme.hostile',
            exerciseId: 'e',
            spec: {},
            answer: join(out, 'pwned.txt'),
            timeoutMs: 15_000,
            authorMode: false,
            isolated: true,
          },
        });
        expect(response.ok && response.result).toMatchObject({
          feedback: expect.stringContaining('write=denied'),
        });
        expect(existsSync(join(out, 'pwned.txt'))).toBe(false);
      } finally {
        await runner.dispose();
      }
      expect(existsSync(join(out, 'dist-electron/host/ext-host.js'))).toBe(
        true,
      );
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    'смоук-сборка содержит смоук во всех процессах: детектор не слепой',
    () => {
      const out = build(true);
      expect(textOf(out, 'dist-electron/main')).toContain('DOLPHY_SMOKE');
      expect(textOf(out, 'dist-electron/preload')).toContain('smoke:report');
      expect(textOf(out, 'dist-electron/host')).toContain('DOLPHY_SMOKE');
      expect(textOf(out, 'dist-electron/host')).toContain(
        'exercise types discovered',
      );
      expect(textOf(out, '/dist/')).toContain('sql_kb::where::q2');
    },
    BUILD_TIMEOUT_MS,
  );
});
