import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverExtensions } from '@dolphy-app/extension-host';
import { buildExtension, validateExtension } from '@dolphy-app/extension-tools';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_NAMES, generateExtension } from '../src/index.ts';
import {
  linkToolchain,
  runNode,
  silentLogger,
  tsc,
  vitest,
} from './docs-blocks.ts';
import { REPO_ROOT, makeTemp } from './helpers.ts';

const generate = async (name: string, template?: string) => {
  const root = await makeTemp();
  const generated = await generateExtension({
    dir: path.join(root, name),
    localRoot: REPO_ROOT,
    ...(template === undefined ? {} : { template }),
  });
  await linkToolchain(generated.dir);
  return generated;
};

const toolsCli = path.join(
  REPO_ROOT,
  'packages/extension-tools/src/cli/main.ts',
);

const BUILT_FILES: Record<string, string[]> = {
  exercise: ['extension.json', 'main.mjs', 'view.mjs'],
  theme: ['extension.json'],
  'command-panel': ['extension.json', 'main.mjs', 'panel.mjs'],
  events: ['extension.json', 'main.mjs', 'panel.mjs'],
  blank: ['extension.json', 'main.mjs'],
};

describe.each(TEMPLATE_NAMES)('generated project: %s', (template) => {
  it('builds, passes validate and lint, is discovered, type-checks and passes its own tests', async () => {
    const { dir, id } = await generate('acme-hello', template);

    const built = await buildExtension({ root: dir });
    expect(built.files).toEqual(BUILT_FILES[template]);
    expect(built.dir).toBe(path.join(dir, 'dist-ext', id));
    const builtManifest = JSON.parse(
      await readFile(path.join(built.dir, 'extension.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(builtManifest['$schema']).toEqual(expect.any(String));
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
    if (template === 'exercise') {
      const view = await readFile(path.join(built.dir, 'view.mjs'), 'utf8');
      expect(view).toContain(extensions[0]?.exerciseTypes[0]?.element);
    }

    // no findings at all: a fresh project is clean for the catalog review
    const linted = await runNode(
      ['--disable-warning=ExperimentalWarning', toolsCli, 'lint', dir],
      dir,
    );
    expect(linted.output).toBe('');
    expect(linted.code).toBe(0);

    const typechecked = await tsc(dir);
    expect(typechecked.code, typechecked.output).toBe(0);

    const { code, output } = await vitest(dir);
    expect(output).toContain('Tests');
    expect(code, output).toBe(0);
  });
});

describe('generated project (exercise): type errors', () => {
  it('after the build tsc accepts the project with id types from extension.json', async () => {
    const { dir } = await generate('acme-hello');
    await buildExtension({ root: dir });
    const ids = await readFile(path.join(dir, '.dolphy/ids.d.ts'), 'utf8');
    expect(ids).toContain("commands: 'acme-hello.status'");
    const { code, output } = await tsc(dir);
    expect(code, output).toBe(0);
  });

  it('tsc rejects wrong ids and entries that diverge from the manifest', async () => {
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
