/**
 * The guide in `packages/extension-sdk/docs`: every `ts`/`json`/`js` block is
 * an example file that builds, validates, type-checks and passes its tests,
 * or a marked fragment. The recipes for the generator's templates equal the
 * generator's output byte for byte.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverExtensions } from '@dolphy-app/extension-host';
import type { ClientEntry, ServerEntry } from '@dolphy-app/extension-sdk';
import {
  createTestClient,
  createTestServer,
} from '@dolphy-app/extension-sdk/testing';
import {
  HOST_GLOBAL,
  buildExtension,
  validateExtension,
} from '@dolphy-app/extension-tools';
import { describe, expect, it } from 'vitest';
import { renderProject } from '../src/index.ts';
import type { TemplateName } from '../src/index.ts';
import {
  collectBlocks,
  silentLogger,
  tsc,
  vitest,
  writeExampleProject,
} from './docs-blocks.ts';
import type { ExampleFile } from './docs-blocks.ts';
import { REPO_ROOT, makeTemp } from './helpers.ts';

const DOCS_DIR = path.join(REPO_ROOT, 'packages/extension-sdk/docs');

/** The files R3 lists; the directory holds nothing else. */
const DOC_FILES = [
  'debugging.md',
  'no-build.md',
  'quick-start.md',
  'recipe-command-panel.md',
  'recipe-event-storage.md',
  'recipe-exercise-type.md',
  'recipe-import-export.md',
  'recipe-rpc-and-app.md',
  'recipe-settings.md',
  'recipe-theme.md',
  'recipe-when-dependencies.md',
];

interface Example {
  /** The files equal the output of `renderProject` for this template. */
  template?: TemplateName;
  /** The entry files the build writes: `server` is `main.mjs`, `client` is `client.mjs`. */
  built: readonly string[];
}

/** Document → label of its examples → how it is checked. */
const EXAMPLES: Readonly<Record<string, Record<string, Example>>> = {
  'quick-start.md': {
    'quick start': { template: 'blank', built: ['main.mjs'] },
  },
  'recipe-exercise-type.md': {
    exercise: { template: 'exercise', built: ['client.mjs', 'main.mjs'] },
  },
  'recipe-theme.md': {
    theme: { template: 'theme', built: ['client.mjs'] },
  },
  'recipe-command-panel.md': {
    'command-panel': {
      template: 'command-panel',
      built: ['client.mjs', 'main.mjs'],
    },
  },
  'recipe-event-storage.md': {
    events: { template: 'events', built: ['client.mjs', 'main.mjs'] },
  },
  'recipe-import-export.md': {
    'import-export': { built: ['main.mjs'] },
  },
  'recipe-rpc-and-app.md': {
    'rpc-and-app': { built: ['client.mjs', 'main.mjs'] },
  },
  'recipe-settings.md': {
    settings: { built: ['main.mjs'] },
  },
  'recipe-when-dependencies.md': {
    'when-dependencies': { built: ['client.mjs', 'main.mjs'] },
  },
  'no-build.md': {},
  'debugging.md': {},
};

/** The example of `no-build.md` is not a project: it has its own checks. */
const NO_BUILD_LABEL = 'no build';

const docs = new Map<string, string>(
  await Promise.all(
    DOC_FILES.map(
      async (name) =>
        [name, await readFile(path.join(DOCS_DIR, name), 'utf8')] as const,
    ),
  ),
);

/** Files every generated project has; the rest is the template's own. */
const SHARED_FILES = new Set([
  'package.json',
  'tsconfig.json',
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  '.gitignore',
  '.github/workflows/ci.yml',
]);

const templateFiles = (template: TemplateName): Map<string, string> =>
  new Map(
    [
      ...renderProject({
        id: 'acme.hello',
        template,
        dependencies: { api: '^0.0.0', sdk: '^0.0.0', tools: '^0.0.0' },
      }),
    ].filter(([file]) => !SHARED_FILES.has(file)),
  );

describe('the docs directory', () => {
  it('holds exactly the files of the guide', async () => {
    expect((await readdir(DOCS_DIR)).sort()).toEqual(DOC_FILES);
  });

  it('the package README links every file of the guide', async () => {
    const readme = await readFile(
      path.join(REPO_ROOT, 'packages/extension-sdk/README.md'),
      'utf8',
    );
    for (const name of DOC_FILES) {
      expect(readme, name).toContain(`docs/${name}`);
    }
  });

  it('the guide files link only to each other', () => {
    for (const [name, text] of docs) {
      for (const [, target] of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
        if (target === undefined || /^[a-z]+:/.test(target)) continue;
        expect(DOC_FILES, `${name} links ${target}`).toContain(target);
      }
    }
  });
});

describe('the code blocks of the guide', () => {
  it.each(DOC_FILES)('%s: every ts/json/js block is marked', (name) => {
    const { unmarked } = collectBlocks(docs.get(name) ?? '');
    expect(unmarked).toEqual([]);
  });

  it.each(DOC_FILES)('%s: the example labels match the table', (name) => {
    const { examples } = collectBlocks(docs.get(name) ?? '');
    const labels = Object.keys(EXAMPLES[name] ?? {});
    if (name === 'no-build.md') labels.push(NO_BUILD_LABEL);
    expect([...examples.keys()].sort()).toEqual(labels.sort());
  });

  it('a block without a marker fails the check; a marker or a fragment comment passes', () => {
    const block = (before: string) =>
      `# Doc\n\n${before}\n\n\`\`\`ts\nexport const x = 1;\n\`\`\`\n`;
    expect(collectBlocks(block('Some text:')).unmarked).toEqual([
      'line 5: ```ts block has no marker',
    ]);
    expect(collectBlocks(block('<!-- fragment -->')).unmarked).toEqual([]);
    const marked = collectBlocks(block('File `src/index.ts` (demo):'));
    expect(marked.unmarked).toEqual([]);
    expect(marked.examples.get('demo')).toEqual([
      { file: 'src/index.ts', lang: 'ts', content: 'export const x = 1;\n' },
    ]);
    expect(collectBlocks('Text:\n\n```sh\npnpm test\n```\n').unmarked).toEqual(
      [],
    );
  });
});

const fileNames = (files: readonly ExampleFile[]): string[] =>
  files.map(({ file }) => file);

const checkedExamples = Object.entries(EXAMPLES).flatMap(([name, labels]) =>
  Object.entries(labels).map(([label, example]) => ({
    name,
    label,
    ...example,
  })),
);

describe.each(checkedExamples)(
  '$name: $label',
  ({ name, label, template, built: entries }) => {
    const files = collectBlocks(docs.get(name) ?? '').examples.get(label) ?? [];

    if (template !== undefined) {
      it(`the files equal the output of the ${template} template`, () => {
        const expected = templateFiles(template);
        expect(fileNames(files).sort()).toEqual([...expected.keys()].sort());
        for (const { file, content } of files) {
          expect(content, file).toBe(expected.get(file));
        }
      });
    }

    it('builds, passes validate, type-checks and passes its tests', async () => {
      expect(fileNames(files)).toContain('extension.json');
      expect(fileNames(files)).toContain('src/index.ts');
      expect(fileNames(files).some((file) => file.startsWith('test/'))).toBe(
        true,
      );

      const root = await writeExampleProject(files);
      const built = await buildExtension({ root });
      expect(
        built.files.filter((file) => file.endsWith('.mjs')).sort(),
      ).toEqual(entries);
      await expect(validateExtension(built.dir)).resolves.toEqual({
        ok: true,
        problems: [],
      });

      const typechecked = await tsc(root);
      expect(typechecked.code, typechecked.output).toBe(0);

      const tested = await vitest(root);
      expect(tested.output).toContain('Tests');
      expect(tested.code, tested.output).toBe(0);
    });
  },
);

const writeExampleProjectFiles = async (
  dir: string,
  files: readonly ExampleFile[],
): Promise<void> => {
  await mkdir(dir, { recursive: true });
  for (const { file, content } of files) {
    await writeFile(path.join(dir, file), content);
  }
};

describe('no-build.md', () => {
  const files =
    collectBlocks(docs.get('no-build.md') ?? '').examples.get(NO_BUILD_LABEL) ??
    [];

  it('shows a manifest and two modules, no package.json and no TypeScript', () => {
    expect(fileNames(files)).toEqual([
      'extension.json',
      'main.mjs',
      'client.mjs',
    ]);
  });

  it('the directory validates, is discovered, and the modules register', async () => {
    const root = await makeTemp();
    const dir = path.join(root, 'acme.plain');
    await writeExampleProjectFiles(dir, files);

    await expect(validateExtension(dir)).resolves.toEqual({
      ok: true,
      problems: [],
    });

    const { extensions, diagnostics } = await discoverExtensions({
      roots: [{ dir: root, origin: 'dev' }],
      logger: silentLogger,
    });
    expect(diagnostics).toEqual([]);
    expect(
      extensions.map(({ id, mainPath, clientPath }) => ({
        id,
        mainPath,
        clientPath,
      })),
    ).toEqual([
      {
        id: 'acme.plain',
        mainPath: path.join(dir, 'main.mjs'),
        clientPath: path.join(dir, 'client.mjs'),
      },
    ]);

    // the server module is a server entry
    const { server } = (await import(
      pathToFileURL(path.join(dir, 'main.mjs')).href
    )) as { server: ServerEntry };
    const running = await createTestServer(server, {
      extensionId: 'acme.plain',
    });
    expect(running.registration.commands.map(({ id }) => id)).toEqual([
      'acme.plain.hello',
      'acme.plain.open',
    ]);
    await expect(running.commands.run('acme.plain.hello')).resolves.toEqual({
      kind: 'notify',
      text: 'Hello from acme.plain!',
    });
    await expect(running.commands.run('acme.plain.open')).resolves.toEqual({
      kind: 'openPanel',
      panelId: 'acme.plain.view',
    });
    await running.dispose();

    // the client module reads Vue from the app's loader and is a client entry
    const sdkRequire = createRequire(
      path.join(REPO_ROOT, 'packages/extension-sdk/package.json'),
    );
    const vue = (await import(sdkRequire.resolve('vue'))) as object;
    Object.assign(globalThis, { [HOST_GLOBAL]: { require: async () => vue } });
    try {
      const { client } = (await import(
        pathToFileURL(path.join(dir, 'client.mjs')).href
      )) as { client: ClientEntry };
      const added = await createTestClient(client, {
        extensionId: 'acme.plain',
      });
      expect(added.panels.map(({ id }) => id)).toEqual(['acme.plain.view']);
      await added.dispose();
    } finally {
      Reflect.deleteProperty(globalThis, HOST_GLOBAL);
    }
  });
});
