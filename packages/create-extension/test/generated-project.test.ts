import { spawn } from 'node:child_process';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { discoverExtensions } from '@dolphy-app/extension-host';
import { buildExtension, validateExtension } from '@dolphy-app/extension-tools';
import { describe, expect, it } from 'vitest';
import { generateExtension } from '../src/index.ts';
import { REPO_ROOT, makeTemp } from './helpers.ts';

const require = createRequire(import.meta.url);
const packageDir = (name: string): string =>
  path.dirname(require.resolve(`${name}/package.json`));

/** node_modules проекта: ссылки на тулчейн репозитория (без сети и install). */
const linkToolchain = async (project: string): Promise<void> => {
  const modules = path.join(project, 'node_modules');
  await mkdir(path.join(modules, '@dolphy-app'), { recursive: true });
  await mkdir(path.join(modules, '@types'), { recursive: true });
  const links: [string, string][] = [
    [
      '@dolphy-app/extension-sdk',
      path.join(REPO_ROOT, 'packages/extension-sdk'),
    ],
    [
      '@dolphy-app/extension-tools',
      path.join(REPO_ROOT, 'packages/extension-tools'),
    ],
    ['@types/node', packageDir('@types/node')],
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

const tscBin = path.join(packageDir('typescript'), 'bin', 'tsc');
const tsc = (project: string) => runNode([tscBin, '--noEmit'], project);

const generate = async (name: string) => {
  const root = await makeTemp();
  const generated = await generateExtension({
    dir: path.join(root, name),
    localRoot: REPO_ROOT,
  });
  await linkToolchain(generated.dir);
  return generated;
};

describe('сгенерированный проект', () => {
  it('собирается, проходит validate, обнаруживается и проходит свои тесты', async () => {
    const { dir, id } = await generate('acme-hello');

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

  it('после сборки tsc принимает проект с типами id из extension.json', async () => {
    const { dir } = await generate('acme-hello');
    await buildExtension({ root: dir });
    const ids = await readFile(path.join(dir, '.dolphy/ids.d.ts'), 'utf8');
    expect(ids).toContain("commands: 'acme-hello.status'");
    const { code, output } = await tsc(dir);
    expect(code, output).toBe(0);
  });

  it('tsc отвергает неверные id и записи, расходящиеся с манифестом', async () => {
    const { dir } = await generate('acme-hello');
    await buildExtension({ root: dir });
    const lines = [
      "import { defineExtension, inActivate } from '@dolphy-app/extension-sdk';",
      "import type { ExtensionViews } from '@dolphy-app/extension-sdk';",
      '',
      'export const wrongIds = defineExtension({',
      "  exerciseTypes: { 'acme-hello': inActivate },",
      "  commands: { 'acme-hello.status': inActivate },",
      '  activate(ctx) {',
      "    ctx.commands.register('acme-hello.nope', () => undefined);", // 8
      "    ctx.settings.get('acme-hello.nope');", // 9
      "    const goal: string = ctx.settings.get('acme-hello.trim');", // 10
      "    ctx.events.on('attempt.closed', () => undefined);", // 11
      "    ctx.registerExerciseType('acme-hello.other', {", // 12
      '      project: () => ({}),',
      "      grade: () => ({ outcome: 'passed' }),",
      '    });',
      '    return void goal;',
      '  },',
      '});',
      '',
      'export const missingCommands = defineExtension({', // 20
      "  exerciseTypes: { 'acme-hello': inActivate },",
      '});',
      '',
      'export const extraCommand = defineExtension({',
      "  exerciseTypes: { 'acme-hello': inActivate },",
      "  commands: { 'acme-hello.status': inActivate, 'acme-hello.extra': inActivate },", // 26
      '});',
      '',
      'export const missingExerciseTypes = defineExtension({', // 29
      "  commands: { 'acme-hello.status': inActivate },",
      '});',
      '',
      'export const extraView = {',
      "  'acme-hello': 1 as never,",
      "  'acme-hello.extra': 1 as never,", // 35
      '} satisfies ExtensionViews;',
      '',
      'export const missingView = {} satisfies ExtensionViews;', // 38
      '',
    ];
    await writeFile(path.join(dir, 'src/wrong.ts'), lines.join('\n'));

    const { code, output } = await tsc(dir);
    expect(code).toBe(1);
    const diagnostics = output
      .split('\n')
      .map((line) =>
        /^src\/wrong\.ts\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line),
      )
      .filter((match) => match !== null)
      .map(([, line, tsCode, text]) => `${line} ${tsCode} ${text}`);
    expect(diagnostics, output).toEqual([
      `8 TS2345 Argument of type '"acme-hello.nope"' is not assignable to parameter of type '"acme-hello.status"'.`,
      `9 TS2345 Argument of type '"acme-hello.nope"' is not assignable to parameter of type '"acme-hello.trim"'.`,
      `10 TS2322 Type 'boolean' is not assignable to type 'string'.`,
      `11 TS2345 Argument of type '"attempt.closed"' is not assignable to parameter of type 'never'.`,
      `12 TS2345 Argument of type '"acme-hello.other"' is not assignable to parameter of type '"acme-hello"'.`,
      expect.stringMatching(/^20 TS2345 .*ExtensionDefinition/),
      expect.stringMatching(/^26 TS2353 .*'acme-hello\.extra'/),
      expect.stringMatching(/^29 TS2345 .*ExtensionDefinition/),
      expect.stringMatching(/^35 TS2353 .*'acme-hello\.extra'/),
      expect.stringMatching(/^38 TS2741 Property '"acme-hello"' is missing/),
    ]);
  });
});
