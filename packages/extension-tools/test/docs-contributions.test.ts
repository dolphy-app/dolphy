/**
 * Examples from the sections “Точки вклада”, “Права и изоляция” and “Установка и каталог”
 * of `docs/design/extensions.md` (an internal Russian doc) are machine-checked: the document does not drift from the code.
 *
 * Marker convention: an example is a regular code block whose last non-empty line
 * before the opening fence has the form ``Файл `<path>` (<label>):``. Blocks without such
 * a line (fragments) are not checked. The label groups the files of one example;
 * every label must be in `EXAMPLES` with a check mode, and every `EXAMPLES`
 * entry must appear in the document.
 *
 * - `manifest` — `extension.json` passes `parseManifest`;
 * - `build-no-code` — a project of a single `extension.json` builds and passes
 *   `validateExtension`;
 * - `build-with-code` — a project of `extension.json` and one `src/index.ts` (the ```ts block
 *   with the marker) builds, passes `validateExtension` and `tsc` with the id types
 *   the build wrote to `.dolphy/ids.d.ts`;
 * - `index` — a single `index.v2.json` file
 *   passes `parseIndex` (`@dolphy-app/extension-catalog`).
 *
 * The example “серия дней целиком” is also executed: the built `main.mjs`
 * goes through `loadEvents` and `loadCommands` from the SDK.
 */
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseIndex } from '@dolphy-app/extension-catalog';
import { manifestJsonSchema, parseManifest } from '@dolphy-app/extension-host';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { buildExtension, validateExtension } from '../src/index.ts';
import { makeTemp, runTsc } from './helpers.ts';

type Mode = 'manifest' | 'build-no-code' | 'build-with-code' | 'index';

const EXAMPLES: Readonly<Record<string, Mode>> = {
  'вид задания': 'manifest',
  тема: 'build-no-code',
  'рендерер содержимого': 'build-with-code',
  'правило оценки': 'build-with-code',
  'настройки расширения': 'build-no-code',
  'переводимые подписи': 'build-no-code',
  'подписка на события': 'build-with-code',
  'команды расширения': 'build-with-code',
  'панель расширения': 'build-with-code',
  'виджет расширения': 'build-with-code',
  'серия дней целиком': 'build-with-code',
  'вид задания с правами': 'manifest',
  'расширение для каталога': 'build-no-code',
  'индекс каталога': 'index',
  'панель со стилями и картинкой': 'build-with-code',
};

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const DOC = path.join(REPO_ROOT, 'docs/design/extensions.md');
const SECTIONS = [
  '## Точки вклада',
  '## Права и изоляция',
  '## Установка и каталог',
  '## Как написать расширение',
];
const MARKER = /^Файл `([^`]+)` \(([^)]+)\):$/;

interface ExampleFile {
  file: string;
  lang: string;
  content: string;
}

const sectionOf = (doc: string, section: string): string[] => {
  const lines = doc.split('\n');
  const start = lines.indexOf(section);
  if (start === -1) throw new Error(`no '${section}' section`);
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith('## '),
  );
  return lines.slice(start + 1, end === -1 ? undefined : end);
};

const collect = (lines: string[]): Map<string, ExampleFile[]> => {
  const examples = new Map<string, ExampleFile[]>();
  let previous = '';
  for (let i = 0; i < lines.length; i++) {
    const fence = /^```(\w+)$/.exec(lines[i] ?? '');
    const marker = MARKER.exec(previous);
    if ((lines[i] ?? '').trim() !== '') previous = lines[i] ?? '';
    if (marker === null || fence === null) continue;
    const close = lines.indexOf('```', i + 1);
    if (close === -1) throw new Error('unterminated code fence');
    const [, file, label] = marker as unknown as [string, string, string];
    const files = examples.get(label) ?? [];
    files.push({
      file,
      lang: fence[1] ?? '',
      content: `${lines.slice(i + 1, close).join('\n')}\n`,
    });
    examples.set(label, files);
  }
  return examples;
};

const doc = await readFile(DOC, 'utf8');
const examples = collect(
  SECTIONS.flatMap((section) => sectionOf(doc, section)),
);

const manifestOf = (files: ExampleFile[]): unknown => {
  const manifests = files.filter(({ file }) => file === 'extension.json');
  expect(manifests).toHaveLength(1);
  return JSON.parse(manifests[0]?.content ?? '');
};

/** Project in a temporary directory; the SDK and API are links to repository packages. */
const writeProject = async (
  files: ExampleFile[],
  withCode: boolean,
): Promise<string> => {
  const root = path.join(await makeTemp(), 'project');
  await mkdir(root, { recursive: true });
  for (const { file, content } of files) {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  if (withCode) {
    const modules = path.join(root, 'node_modules', '@dolphy-app');
    await mkdir(modules, { recursive: true });
    for (const name of ['extension-sdk', 'extension-api']) {
      await symlink(
        path.join(REPO_ROOT, 'packages', name),
        path.join(modules, name),
        'dir',
      );
    }
  }
  return root;
};

const TSCONFIG = `${JSON.stringify({
  compilerOptions: {
    target: 'ES2023',
    lib: ['ES2023', 'DOM'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    types: [],
    strict: true,
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ['src', '.dolphy/ids.d.ts'],
})}\n`;

describe('examples of the sections “Точки вклада”, “Права и изоляция”, “Установка и каталог” and “Как написать расширение”', () => {
  it('example labels match the checks table', () => {
    expect([...examples.keys()].sort()).toEqual(Object.keys(EXAMPLES).sort());
  });

  for (const [label, mode] of Object.entries(EXAMPLES)) {
    describe(label, () => {
      if (mode === 'index') {
        it('the index passes parseIndex', () => {
          const files = examples.get(label) ?? [];
          expect(files.map(({ file }) => file)).toEqual(['index.v2.json']);
          const index = parseIndex(JSON.parse(files[0]?.content ?? ''));
          expect(index.extensions.length).toBeGreaterThan(0);
          expect(index.schemaVersion).toBe(2);
          expect(
            index.extensions.every((entry) =>
              entry.versions.some((version) => version.icon !== undefined),
            ),
          ).toBe(true);
        });
        return;
      }

      it('extension.json passes parseManifest', () => {
        const result = parseManifest(manifestOf(examples.get(label) ?? []));
        expect(result).toMatchObject({ ok: true });
      });

      it('extension.json passes extension.schema.json', () => {
        const validate = new Ajv2020({ strict: false }).compile(
          manifestJsonSchema(),
        );
        const manifest = manifestOf(examples.get(label) ?? []);
        expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
      });

      if (mode === 'manifest') return;

      it('the project builds and passes validate', async () => {
        const files = examples.get(label) ?? [];
        const withCode = mode === 'build-with-code';
        if (withCode) {
          expect(
            files
              .filter(
                ({ file, lang }) => lang === 'ts' && !file.endsWith('.d.ts'),
              )
              .map(({ file }) => file),
          ).toEqual(['src/index.ts']);
        } else {
          expect(files.map(({ file }) => file)).toEqual([
            'extension.json',
            ...files
              .map(({ file }) => file)
              .filter((file) => file.startsWith('locales/')),
          ]);
        }
        const root = await writeProject(files, withCode);
        const built = await buildExtension({ root });
        expect(built.files.some((file) => file.endsWith('.mjs'))).toBe(
          withCode,
        );
        await expect(validateExtension(built.dir)).resolves.toEqual({
          ok: true,
          problems: [],
          warnings: [],
        });
        if (withCode) {
          // the ids written by the build must accept the example as written
          await writeFile(path.join(root, 'tsconfig.json'), TSCONFIG);
          const { code, output } = await runTsc(root);
          expect(code, output).toBe(0);
        }
      });
    });
  }
});

describe('the “панель со стилями и картинкой” example', () => {
  it('the style sheet is inlined into the panel and the picture is shipped as a file', async () => {
    const files = examples.get('панель со стилями и картинкой') ?? [];
    const root = await writeProject(files, true);
    const built = await buildExtension({ root });
    expect(built.files).toEqual([
      'assets/mark.svg',
      'extension.json',
      'panel.mjs',
    ]);
    const panel = await readFile(path.join(built.dir, 'panel.mjs'), 'utf8');
    expect(panel).toContain('.badge');
    expect(panel).toContain('assets/mark.svg');
    // the shipped picture is the file of the example, byte for byte
    expect(
      await readFile(path.join(built.dir, 'assets/mark.svg'), 'utf8'),
    ).toBe(files.find(({ file }) => file === 'assets/mark.svg')?.content);
    await expect(validateExtension(built.dir)).resolves.toEqual({
      ok: true,
      problems: [],
      warnings: [],
    });
  });
});

interface Streak {
  days: number;
  last: string;
}

interface SdkTesting {
  createMemoryStorage(): {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  loadEvents(
    module: unknown,
    options: { storage: unknown; declared: string[] },
  ): Promise<{
    emit(name: string, payload: Record<string, unknown>): Promise<void>;
  }>;
  loadCommands(
    module: unknown,
    options: {
      storage: unknown;
      declaredCommands: string[];
      declaredPanels: string[];
    },
  ): Promise<{ run(id: string, args?: unknown): Promise<unknown> }>;
}

interface PanelModule {
  default: {
    mount(
      container: unknown,
      ctx: {
        panelId: string;
        call(id: string): Promise<unknown>;
        onProps(listener: () => void): () => void;
        signal: { addEventListener(type: string, fn: () => void): void };
      },
    ): Promise<void>;
  };
}

describe('the “серия дней целиком” example is executed', () => {
  const attempt = (at: string) => ({
    exerciseId: 'e',
    courseId: 'c',
    lessonId: 'l',
    grade: 4,
    outcome: 'passed',
    source: 'runner',
    at: Date.parse(`${at}T12:00:00Z`),
  });

  it('the event counts the streak, commands and panel read the same data', async () => {
    const files = examples.get('серия дней целиком') ?? [];
    const manifest = manifestOf(files) as {
      contributes: {
        commands: Array<{ id: string; palette?: boolean }>;
        panels: Array<{ id: string }>;
      };
    };
    const root = await writeProject(files, true);
    const built = await buildExtension({ root });
    await expect(validateExtension(built.dir)).resolves.toEqual({
      ok: true,
      problems: [],
      warnings: [],
    });

    const sdk = (await import(
      /* @vite-ignore */ path.join(
        REPO_ROOT,
        'packages/extension-sdk/src/testing.ts',
      )
    )) as SdkTesting;
    const module = (
      await import(/* @vite-ignore */ path.join(built.dir, 'main.mjs'))
    ).default as unknown;
    const storage = sdk.createMemoryStorage();
    const declaredCommands = manifest.contributes.commands.map(({ id }) => id);
    const declaredPanels = manifest.contributes.panels.map(({ id }) => id);
    const events = await sdk.loadEvents(module, {
      storage,
      declared: ['attempt.closed'],
    });
    const commands = await sdk.loadCommands(module, {
      storage,
      declaredCommands,
      declaredPanels,
    });

    // no data: the palette command notifies, the data command returns zeros
    expect(await commands.run('acme.streak.show')).toMatchObject({
      kind: 'notify',
    });
    expect(await commands.run('acme.streak.data')).toEqual({
      kind: 'data',
      value: { days: 0, last: '' },
    });

    await events.emit('attempt.closed', attempt('2026-10-01'));
    await events.emit('attempt.closed', attempt('2026-10-01'));
    await events.emit('attempt.closed', attempt('2026-10-02'));
    expect(await storage.get('streak')).toEqual({
      days: 2,
      last: '2026-10-02',
    });
    // a skipped day restarts the streak; “gave up” leaves the streak alone
    await events.emit('attempt.closed', {
      ...attempt('2026-10-03'),
      outcome: 'gave-up',
    });
    expect((await storage.get('streak')) as Streak).toMatchObject({ days: 2 });
    await events.emit('attempt.closed', attempt('2026-10-05'));
    expect(await storage.get('streak')).toEqual({
      days: 1,
      last: '2026-10-05',
    });

    expect(await commands.run('acme.streak.show')).toEqual({
      kind: 'openPanel',
      panelId: 'acme.streak.view',
      props: { days: 1 },
    });

    // the built panel runs in a frame and renders the data command's response
    const panel = (await import(
      /* @vite-ignore */ path.join(built.dir, 'panel.mjs')
    )) as PanelModule;
    const line = { textContent: '' };
    const container = {
      ownerDocument: { createElement: () => line },
      append: () => undefined,
    };
    await panel.default.mount(container, {
      panelId: 'acme.streak.view',
      call: async (id) => {
        const outcome = (await commands.run(id)) as { value: unknown };
        return outcome.value;
      },
      onProps: () => () => undefined,
      signal: { addEventListener: () => undefined },
    });
    expect(line.textContent).toBe('Серия: 1 дн., последний день 2026-10-05');
    expect(declaredCommands).toEqual(['acme.streak.show', 'acme.streak.data']);
  });
});
