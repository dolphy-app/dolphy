/**
 * The guide in `packages/extension-sdk/docs`: every `ts`/`json`/`js` block is
 * an example file that builds, validates, type-checks and passes its tests,
 * or a marked fragment. The recipes for the generator's templates equal the
 * generator's output byte for byte.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverExtensions } from '@dolphy-app/extension-host';
import { loadCommands } from '@dolphy-app/extension-sdk/testing';
import { buildExtension, validateExtension } from '@dolphy-app/extension-tools';
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
  'recipe-settings.md',
  'recipe-theme.md',
  'recipe-ui-kit.md',
  'recipe-when-dependencies.md',
];

type Mode =
  'build-no-code-and-tests' | 'build-with-code-and-tests' | 'no-build';

interface Example {
  mode: Mode;
  /** The files equal the output of `renderProject` for this template. */
  template?: TemplateName;
}

/** Document → label of its examples → how it is checked. */
const EXAMPLES: Readonly<Record<string, Record<string, Example>>> = {
  'quick-start.md': {
    'quick start': { mode: 'build-with-code-and-tests', template: 'blank' },
  },
  'recipe-exercise-type.md': {
    exercise: { mode: 'build-with-code-and-tests', template: 'exercise' },
  },
  'recipe-theme.md': {
    theme: { mode: 'build-no-code-and-tests', template: 'theme' },
  },
  'recipe-command-panel.md': {
    'command-panel': {
      mode: 'build-with-code-and-tests',
      template: 'command-panel',
    },
  },
  'recipe-event-storage.md': {
    events: { mode: 'build-with-code-and-tests', template: 'events' },
  },
  'recipe-import-export.md': {
    'import-export': { mode: 'build-with-code-and-tests' },
  },
  'recipe-settings.md': {
    settings: { mode: 'build-with-code-and-tests' },
  },
  'recipe-ui-kit.md': {
    'ui-kit': { mode: 'build-with-code-and-tests' },
  },
  'recipe-when-dependencies.md': {
    'when-dependencies': { mode: 'build-with-code-and-tests' },
  },
  'no-build.md': { 'no build': { mode: 'no-build' } },
  'debugging.md': {},
};

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
    expect([...examples.keys()].sort()).toEqual(
      Object.keys(EXAMPLES[name] ?? {}).sort(),
    );
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
  Object.entries(labels)
    .filter(([, example]) => example.mode !== 'no-build')
    .map(([label, example]) => ({ name, label, ...example })),
);

describe.each(checkedExamples)(
  '$name: $label',
  ({ name, label, mode, template }) => {
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
      const withCode = mode === 'build-with-code-and-tests';
      expect(fileNames(files)).toContain('extension.json');
      expect(fileNames(files).includes('src/index.ts')).toBe(withCode);
      expect(fileNames(files).some((file) => file.startsWith('test/'))).toBe(
        true,
      );

      const root = await writeExampleProject(files);
      const built = await buildExtension({ root });
      expect(built.files.some((file) => file.endsWith('.mjs'))).toBe(withCode);
      await expect(validateExtension(built.dir)).resolves.toEqual({
        ok: true,
        problems: [],
        warnings: [],
      });

      // the ids written by the build must accept the example as written
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
    collectBlocks(docs.get('no-build.md') ?? '').examples.get('no build') ?? [];

  it('shows a manifest and a module, no package.json and no TypeScript', () => {
    expect(fileNames(files)).toEqual(['extension.json', 'main.mjs']);
  });

  it('the directory validates, is discovered and the module answers its command', async () => {
    const root = await makeTemp();
    const dir = path.join(root, 'acme.plain');
    await writeExampleProjectFiles(dir, files);

    await expect(validateExtension(dir)).resolves.toEqual({
      ok: true,
      problems: [],
      warnings: [],
    });

    const { extensions, diagnostics } = await discoverExtensions({
      roots: [{ dir: root, origin: 'dev' }],
      logger: silentLogger,
    });
    expect(diagnostics).toEqual([]);
    expect(extensions.map((extension) => extension.id)).toEqual(['acme.plain']);
    expect(extensions[0]?.commands.map((command) => command.id)).toEqual([
      'acme.plain.hello',
    ]);

    const module = (await import(
      pathToFileURL(path.join(dir, 'main.mjs')).href
    )) as { default: Parameters<typeof loadCommands>[0] };
    const commands = await loadCommands(module.default, {
      declaredCommands: ['acme.plain.hello'],
    });
    await expect(commands.run('acme.plain.hello')).resolves.toMatchObject({
      kind: 'notify',
      text: expect.stringMatching(/^Hello from .+!$/),
    });
    await commands.dispose();
  });
});
