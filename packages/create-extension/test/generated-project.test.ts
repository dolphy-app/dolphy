import { spawn } from 'node:child_process';
import { mkdir, readFile, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { discoverExtensions } from '@lms/extension-host';
import { buildExtension, validateExtension } from '@lms/extension-tools';
import { describe, expect, it } from 'vitest';
import { generateExtension } from '../src/index.ts';
import { REPO_ROOT, makeTemp } from './helpers.ts';

const require = createRequire(import.meta.url);
const packageDir = (name: string): string =>
  path.dirname(require.resolve(`${name}/package.json`));

/** node_modules проекта: ссылки на тулчейн репозитория (без сети и install). */
const linkToolchain = async (project: string): Promise<void> => {
  const modules = path.join(project, 'node_modules');
  await mkdir(path.join(modules, '@lms'), { recursive: true });
  const links: [string, string][] = [
    ['@lms/extension-sdk', path.join(REPO_ROOT, 'packages/extension-sdk')],
    ['@lms/extension-tools', path.join(REPO_ROOT, 'packages/extension-tools')],
    ['vitest', packageDir('vitest')],
    ['happy-dom', packageDir('happy-dom')],
  ];
  for (const [name, target] of links) {
    await symlink(target, path.join(modules, name), 'dir');
  }
};

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const runNode = (args: string[], cwd: string) =>
  new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    // вложенный vitest не должен считать себя частью внешнего прогона
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith('VITEST') && key !== 'NODE_OPTIONS',
      ),
    );
    const child = spawn(process.execPath, args, { cwd, env });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => void (output += chunk));
    child.stderr.on('data', (chunk: Buffer) => void (output += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });

describe('сгенерированный проект', () => {
  it('собирается, проходит validate, обнаруживается и проходит свои тесты', async () => {
    const root = await makeTemp();
    const { dir, id } = await generateExtension({
      dir: path.join(root, 'acme-hello'),
      localRoot: REPO_ROOT,
    });
    await linkToolchain(dir);

    const built = await buildExtension({ root: dir });
    expect(built.files).toEqual(['extension.json', 'main.mjs', 'view.mjs']);
    expect(built.dir).toBe(path.join(dir, 'dist-ext', id));
    await expect(validateExtension(built.dir)).resolves.toEqual({
      ok: true,
      problems: [],
    });

    const { extensions, diagnostics } = await discoverExtensions({
      roots: [{ dir: path.join(dir, 'dist-ext'), origin: 'dev' }],
      logger: silentLogger,
    });
    expect(diagnostics).toEqual([]);
    expect(extensions.map((extension) => extension.id)).toEqual([id]);
    const view = await readFile(path.join(built.dir, 'view.mjs'), 'utf8');
    expect(view).toContain(extensions[0]?.exerciseTypes[0]?.element);

    const vitest = path.join(packageDir('vitest'), 'vitest.mjs');
    const { code, output } = await runNode([vitest, 'run'], dir);
    expect(output).toContain('Tests');
    expect(code, output).toBe(0);
  });
});
