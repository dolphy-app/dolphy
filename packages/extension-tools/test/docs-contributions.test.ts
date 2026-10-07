/**
 * Examples from the sections “Регистрация вкладов”, “Установка и каталог” and
 * “Как написать расширение” of `docs/design/extensions.md` (an internal
 * Russian doc) are machine-checked: the document does not drift from the code.
 *
 * Marker convention: an example is a regular code block whose last non-empty line
 * before the opening fence has the form ``Файл `<path>` (<label>):``. Blocks without such
 * a line (fragments) are not checked. The label groups the files of one example;
 * every label must be in `EXAMPLES` with a check mode, and every `EXAMPLES`
 * entry must appear in the document.
 *
 * - `manifest` — `extension.json` passes `parseManifest`;
 * - `build` — a project of `extension.json` and the code files (`src/index.ts`
 *   exports the listed entries) builds into the listed files, passes
 *   `validateExtension` and `tsc`, and the built entries register with the
 *   ids of the extension on the SDK's `createTestServer` / `createTestClient`;
 * - `index` — a single `index.v2.json` file
 *   passes `parseIndex` (`@dolphy-app/extension-catalog`).
 *
 * The examples “серия дней целиком”, “импортёр CSV” and “экспортёр курса” are also
 * executed: the built `main.mjs` and `client.mjs` run on the SDK's test server
 * and client; the imported course goes through the course compiler.
 */
import { compile } from '@dolphy-app/engine/authoring';
import { createNodeFsCourseSource } from '@dolphy-app/engine/node';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseWhen } from '@dolphy-app/extension-api';
import { parseIndex } from '@dolphy-app/extension-catalog';
import { manifestJsonSchema, parseManifest } from '@dolphy-app/extension-host';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it, vi } from 'vitest';
import { buildExtension, validateExtension } from '../src/index.ts';
import { makeTemp, runTsc } from './helpers.ts';

type Entry = 'server' | 'client';

type Mode =
  | { kind: 'manifest' }
  | { kind: 'build'; entries: readonly Entry[] }
  | { kind: 'index' };

const manifest: Mode = { kind: 'manifest' };
const server: Mode = { kind: 'build', entries: ['server'] };
const client: Mode = { kind: 'build', entries: ['client'] };
const both: Mode = { kind: 'build', entries: ['server', 'client'] };

const EXAMPLES: Readonly<Record<string, Mode>> = {
  'вид задания': both,
  тема: client,
  'рендерер содержимого': client,
  'правило оценки': server,
  'настройки расширения': server,
  'подписи на двух языках': server,
  'подписка на события': server,
  'хук перед сессией': server,
  'команды расширения': both,
  'панель расширения': both,
  'инъекция расширения': client,
  'прямой доступ и RPC': both,
  'условие видимости': server,
  'расписания расширения': server,
  'серия дней целиком': both,
  'расширение для каталога': client,
  'индекс каталога': { kind: 'index' },
  'панель со стилями и картинкой': client,
  'импортёр CSV': server,
  'экспортёр курса': server,
  зависимости: manifest,
};

const BUILT_FILE: Readonly<Record<Entry, string>> = {
  server: 'main.mjs',
  client: 'client.mjs',
};

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const DOC = path.join(REPO_ROOT, 'docs/design/extensions.md');
const SECTIONS = [
  '## Регистрация вкладов',
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
    const [, file = '', label = ''] = marker;
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

/** The `id` of the extension that an example's `extension.json` declares. */
const idOf = (files: ExampleFile[]): string => {
  const parsed = parseManifest(manifestOf(files));
  if (!parsed.ok) throw new Error('the example manifest is invalid');
  return parsed.manifest.id;
};

/** Project in a temporary directory; the SDK and API are links to repository packages. */
const writeProject = async (files: ExampleFile[]): Promise<string> => {
  const root = path.join(await makeTemp(), 'project');
  await mkdir(root, { recursive: true });
  for (const { file, content } of files) {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const modules = path.join(root, 'node_modules', '@dolphy-app');
  await mkdir(modules, { recursive: true });
  for (const name of ['extension-sdk', 'extension-api']) {
    await symlink(
      path.join(REPO_ROOT, 'packages', name),
      path.join(modules, name),
      'dir',
    );
  }
  // `vue`, `vuetify` and `zod` are the author's own dependencies
  const links: [string, string][] = [
    ['vue', 'packages/extension-sdk/node_modules/vue'],
    ['vuetify', 'packages/ext-choice/node_modules/vuetify'],
    ['zod', 'packages/extension-sdk/node_modules/zod'],
  ];
  for (const [name, source] of links) {
    await symlink(
      path.join(REPO_ROOT, source),
      path.join(root, 'node_modules', name),
      'dir',
    );
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
  include: ['src'],
})}\n`;

/** What the SDK's test harness gives back; the SDK is not a dependency of this package, so only the used part is typed. */
interface RunningServer {
  registration: {
    commands: Array<{ id: string; when: string | null }>;
    importers: Array<{ id: string }>;
    exporters: Array<{ id: string }>;
  };
  commands: { run(id: string, args?: unknown): Promise<unknown> };
  events: {
    emit(name: string, payload: Record<string, unknown>): Promise<void>;
  };
  storage: { get(key: string): Promise<unknown> };
  importer(id: string): {
    run(input: {
      name: string;
      text: string;
    }): Promise<{ files: Record<string, string> }>;
  };
  exporter(id: string): {
    run(input: {
      scope: 'course';
      courseId: string;
      title: string;
      files: Record<string, string>;
    }): Promise<{ filename: string; text?: string }>;
  };
  dispose(): Promise<void>;
}

interface RunningClient {
  panels: ReadonlyArray<{ id: string; when?: string; component: unknown }>;
  injections: readonly unknown[];
  answerViews: ReadonlyMap<string, unknown>;
  markdownRenderers: ReadonlyMap<string, unknown>;
  themes: readonly unknown[];
  commands: readonly unknown[];
  dispose(): Promise<void>;
}

interface SdkTesting {
  createTestServer(
    entry: unknown,
    options: { extensionId: string },
  ): Promise<RunningServer>;
  createTestClient(
    entry: unknown,
    options: { extensionId: string },
  ): Promise<RunningClient>;
}

interface BuiltEntries {
  server?: unknown;
  client?: unknown;
}

const sdkTesting = (await import(
  /* @vite-ignore */ path.join(
    REPO_ROOT,
    'packages/extension-sdk/src/testing.ts',
  )
)) as SdkTesting;

const vue = (await import(
  /* @vite-ignore */ path.join(
    REPO_ROOT,
    'packages/extension-sdk/node_modules/vue/index.js',
  )
)) as typeof import('vue');

/** Imports the built files the way the host and the window do: the client file reads Vue from the app's loader. */
const importBuilt = async (
  dir: string,
  wanted: readonly Entry[],
): Promise<BuiltEntries> => {
  const entries: BuiltEntries = {};
  Object.assign(globalThis, { __dolphy: { require: async () => vue } });
  try {
    for (const entry of wanted) {
      const module = (await import(
        /* @vite-ignore */ path.join(dir, BUILT_FILE[entry])
      )) as Record<Entry, unknown>;
      entries[entry] = module[entry];
    }
  } finally {
    Reflect.deleteProperty(globalThis, '__dolphy');
  }
  return entries;
};

const buildExample = async (label: string) => {
  const files = examples.get(label) ?? [];
  const root = await writeProject(files);
  const built = await buildExtension({ root });
  await expect(validateExtension(built.dir)).resolves.toEqual({
    ok: true,
    problems: [],
  });
  return { files, root, built, extensionId: idOf(files) };
};

describe('examples of the sections “Регистрация вкладов”, “Установка и каталог” and “Как написать расширение”', () => {
  it('example labels match the checks table', () => {
    expect([...examples.keys()].sort()).toEqual(Object.keys(EXAMPLES).sort());
  });

  for (const [label, mode] of Object.entries(EXAMPLES)) {
    describe(label, () => {
      if (mode.kind === 'index') {
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
        const parsed = manifestOf(examples.get(label) ?? []);
        expect(validate(parsed), JSON.stringify(validate.errors)).toBe(true);
      });

      if (mode.kind === 'manifest') return;

      it('the project builds, passes validate and tsc, and registers under the id of the extension', async () => {
        const { files, root, built, extensionId } = await buildExample(label);
        expect(files.map(({ file }) => file)).toContain('src/index.ts');
        expect(built.files.filter((file) => file.endsWith('.mjs'))).toEqual(
          mode.entries.map((entry) => BUILT_FILE[entry]).sort(),
        );

        await writeFile(path.join(root, 'tsconfig.json'), TSCONFIG);
        const { code, output } = await runTsc(root);
        expect(code, output).toBe(0);

        // `createTestServer` / `createTestClient` refuse an id without the prefix
        const entries = await importBuilt(built.dir, mode.entries);
        if (mode.entries.includes('server')) {
          const running = await sdkTesting.createTestServer(entries.server, {
            extensionId,
          });
          for (const { when } of running.registration.commands) {
            if (when !== null) expect(() => parseWhen(when)).not.toThrow();
          }
          await running.dispose();
        }
        if (mode.entries.includes('client')) {
          const running = await sdkTesting.createTestClient(entries.client, {
            extensionId,
          });
          for (const { when } of running.panels) {
            if (when !== undefined) expect(() => parseWhen(when)).not.toThrow();
          }
          expect(
            running.panels.length +
              running.injections.length +
              running.answerViews.size +
              running.markdownRenderers.size +
              running.themes.length +
              running.commands.length,
          ).toBeGreaterThan(0);
          await running.dispose();
        }
      });
    });
  }
});

describe('the “панель со стилями и картинкой” example', () => {
  it('the style sheet is inlined into the panel and the picture is shipped as a file', async () => {
    const { files, built } = await buildExample(
      'панель со стилями и картинкой',
    );
    expect(built.files).toEqual([
      'assets/mark.svg',
      'client.mjs',
      'extension.json',
    ]);
    const panel = await readFile(path.join(built.dir, 'client.mjs'), 'utf8');
    expect(panel).toContain('.badge');
    expect(panel).toContain('assets/mark.svg');
    // the shipped picture is the file of the example, byte for byte
    expect(
      await readFile(path.join(built.dir, 'assets/mark.svg'), 'utf8'),
    ).toBe(files.find(({ file }) => file === 'assets/mark.svg')?.content);
  });
});

/** A text node or an element of the tiny tree the test renderer builds. */
interface TestNode {
  type: 'text' | 'element' | 'comment';
  text: string;
  children: TestNode[];
  parent: TestNode | null;
}

const textOf = (node: TestNode): string =>
  node.type === 'element' ? node.children.map(textOf).join('') : node.text;

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
    const { built, extensionId } = await buildExample('серия дней целиком');
    const entries = await importBuilt(built.dir, ['server', 'client']);
    const running = await sdkTesting.createTestServer(entries.server, {
      extensionId,
    });
    const added = await sdkTesting.createTestClient(entries.client, {
      extensionId,
    });

    // no data: the palette command notifies, the data command returns zeros
    expect(await running.commands.run('acme.streak.show')).toMatchObject({
      kind: 'notify',
    });
    expect(await running.commands.run('acme.streak.data')).toEqual({
      kind: 'data',
      value: { days: 0, last: '' },
    });

    await running.events.emit('attempt.closed', attempt('2026-10-01'));
    await running.events.emit('attempt.closed', attempt('2026-10-01'));
    await running.events.emit('attempt.closed', attempt('2026-10-02'));
    expect(await running.storage.get('streak')).toEqual({
      days: 2,
      last: '2026-10-02',
    });
    // a skipped day restarts the streak; “gave up” leaves the streak alone
    await running.events.emit('attempt.closed', {
      ...attempt('2026-10-03'),
      outcome: 'gave-up',
    });
    expect(await running.storage.get('streak')).toMatchObject({ days: 2 });
    await running.events.emit('attempt.closed', attempt('2026-10-05'));
    expect(await running.storage.get('streak')).toEqual({
      days: 1,
      last: '2026-10-05',
    });

    expect(await running.commands.run('acme.streak.show')).toEqual({
      kind: 'openPanel',
      panelId: 'acme.streak.view',
      props: { days: 1 },
    });

    // the built panel is a Vue component: the client registers it, it reads
    // Vue from the app's loader and draws the data command's response
    const node = (type: TestNode['type'], text = ''): TestNode => ({
      type,
      text,
      children: [],
      parent: null,
    });
    const insert = (
      child: TestNode,
      parent: TestNode,
      anchor?: TestNode | null,
    ) => {
      child.parent = parent;
      const at = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(at === -1 ? parent.children.length : at, 0, child);
    };
    const { createApp } = vue.createRenderer<TestNode, TestNode>({
      createElement: () => node('element'),
      createText: (text) => node('text', text),
      createComment: (text) => node('comment', text),
      setText: (target, text) => void (target.text = text),
      setElementText: (target, text) => {
        target.children = [];
        insert(node('text', text), target);
      },
      insert,
      remove: (child) => {
        const siblings = child.parent?.children ?? [];
        siblings.splice(siblings.indexOf(child), 1);
      },
      parentNode: (child) => child.parent,
      nextSibling: (child) => {
        const siblings = child.parent?.children ?? [];
        return siblings[siblings.indexOf(child) + 1] ?? null;
      },
      patchProp: () => undefined,
    });
    const view = added.panels.find(({ id }) => id === 'acme.streak.view');
    const app = createApp(view?.component as Parameters<typeof createApp>[0]);
    app.provide(Symbol.for('dolphy.extension.panel'), {
      panelId: 'acme.streak.view',
      props: undefined,
      context: { courseId: null },
      call: async (id: string) => {
        const outcome = (await running.commands.run(id)) as { value: unknown };
        return outcome.value;
      },
    });
    const screen = node('element');
    app.mount(screen);
    await vi.waitFor(() => {
      expect(textOf(screen)).toMatch(/1.*2026-10-05/);
    });
    app.unmount();
    await added.dispose();
    await running.dispose();
  });
});

const CSV = 'hola,hello\nadiós,goodbye\n¿cómo estás?,how are you?\n';

/** Compiles a course tree the way the engine does before it writes an import. */
const compileTree = async (files: Record<string, string>) => {
  const dir = path.join(await makeTemp(), 'imported');
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return compile(createNodeFsCourseSource(dir), {
    scan: { ignoredPaths: [] },
    emit: 'always',
  });
};

/** Starts the built `server` of an example on the SDK's test server. */
const startServer = async (label: string): Promise<RunningServer> => {
  const { built, extensionId } = await buildExample(label);
  const entries = await importBuilt(built.dir, ['server']);
  return sdkTesting.createTestServer(entries.server, { extensionId });
};

const only = (items: Array<{ id: string }>): string => {
  expect(items).toHaveLength(1);
  return items[0]?.id ?? '';
};

describe('the “импортёр CSV” and “экспортёр курса” examples are executed', () => {
  it('the importer turns a CSV into a course the compiler accepts', async () => {
    const running = await startServer('импортёр CSV');
    const importer = running.importer(only(running.registration.importers));
    const { files } = await importer.run({
      name: 'Spanish basics.csv',
      text: CSV,
    });
    expect(Object.keys(files)).toContain('spanish-basics/course_manifest.json');
    const result = await compileTree(files);
    expect(result.summary.errors).toBe(0);
    expect({
      courses: result.artifact?.courses.length,
      lessons: result.artifact?.lessons.length,
      exercises: result.artifact?.exercises.length,
    }).toEqual({ courses: 1, lessons: 1, exercises: 3 });

    // a row without an answer is the handler's error, nothing is returned
    await expect(
      importer.run({ name: 'bad.csv', text: 'hola,hello\nadiós\n' }),
    ).rejects.toThrow(/Строка 2/);
    await running.dispose();
  });

  it('the exporter returns the imported cards as the same CSV', async () => {
    const importing = await startServer('импортёр CSV');
    const exporting = await startServer('экспортёр курса');
    const { files } = await importing
      .importer(only(importing.registration.importers))
      .run({ name: 'deck.csv', text: CSV });
    // the snapshot has paths relative to the course directory
    const snapshot = Object.fromEntries(
      Object.entries(files)
        .filter(([file]) => file.startsWith('deck/'))
        .map(([file, content]) => [file.slice('deck/'.length), content]),
    );
    const result = await exporting
      .exporter(only(exporting.registration.exporters))
      .run({
        scope: 'course',
        courseId: 'deck',
        title: 'Deck / Spanish',
        files: snapshot,
      });
    expect(result).toEqual({ filename: 'Deck - Spanish.csv', text: CSV });
    await importing.dispose();
    await exporting.dispose();
  });
});
