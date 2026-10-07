import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatDiagnostic, parseManifest } from '@dolphy-app/extension-host';
import { describe, expect, it } from 'vitest';
import {
  GenerateError,
  TEMPLATE_NAMES,
  deriveExtensionId,
  generateExtension,
  renderProject,
} from '../src/index.ts';
import { REPO_ROOT, makeTemp } from './helpers.ts';

const readJson = async (file: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;

describe('deriveExtensionId', () => {
  it.each([
    ['acme-hello', 'acme-hello'],
    ['AcmeHello', 'acme-hello'],
    ['acme_hello', 'acme-hello'],
    ['acme.hello', 'acme-hello'],
    ['  My Ext!! ', 'my-ext'],
  ])('%s → %s', (name, id) => {
    expect(deriveExtensionId(name)).toBe(id);
  });
});

describe('generateExtension', () => {
  it('creates exactly the declared set of files', async () => {
    const root = await makeTemp();
    const result = await generateExtension({
      dir: path.join(root, 'acme-hello'),
    });
    expect(result.id).toBe('acme-hello');
    expect(result.files).toEqual([
      '.github/workflows/ci.yml',
      '.gitignore',
      'AGENTS.md',
      'CLAUDE.md',
      'README.md',
      'extension.json',
      'package.json',
      'src/index.ts',
      'test/index.test.ts',
      'tsconfig.json',
    ]);
  });

  it.each([
    ['exercise', ['src/index.ts', 'test/index.test.ts']],
    ['theme', ['test/theme.test.ts']],
    ['command-panel', ['src/index.ts', 'test/index.test.ts']],
    ['events', ['src/index.ts', 'test/index.test.ts']],
    ['blank', ['src/index.ts', 'test/index.test.ts']],
  ])(
    'template %s has its own files; the shared ones are always there',
    async (template, own) => {
      const root = await makeTemp();
      const { files } = await generateExtension({
        dir: path.join(root, 'x'),
        template,
      });
      expect(files).toEqual(
        [
          '.github/workflows/ci.yml',
          '.gitignore',
          'AGENTS.md',
          'CLAUDE.md',
          'README.md',
          'extension.json',
          'package.json',
          'tsconfig.json',
          ...own,
        ].sort(),
      );
    },
  );

  it('an unknown template names the available ones and writes nothing', async () => {
    const root = await makeTemp();
    const dir = path.join(root, 'x');
    const error = await generateExtension({ dir, template: 'fancy' }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: 'invalid-template' });
    expect((error as Error).message).toContain(
      'exercise, theme, command-panel, events, blank',
    );
    await expect(readFile(path.join(dir, 'package.json'))).rejects.toThrow();
  });

  it('without a template the output is the exercise template', async () => {
    const input = {
      id: 'acme.hello',
      dependencies: { api: '^0.0.0', sdk: '^0.0.0', tools: '^0.0.0' },
    };
    expect(renderProject(input)).toEqual(
      renderProject({ ...input, template: 'exercise' }),
    );
  });

  it('default id is kebab-case of the directory, --id overrides', async () => {
    const root = await makeTemp();
    const derived = await generateExtension({
      dir: path.join(root, 'MyExt_One'),
    });
    expect(derived.id).toBe('my-ext-one');
    const explicit = await generateExtension({
      dir: path.join(root, 'plain'),
      id: 'acme.hello',
    });
    expect(explicit.id).toBe('acme.hello');
  });

  it.each([['123'], ['---'], ['Acme.Hello'], ['a'.repeat(65)]])(
    'rejects invalid id %s',
    async (id) => {
      const root = await makeTemp();
      const dir = path.join(root, 'ok');
      await expect(generateExtension({ dir, id })).rejects.toMatchObject({
        code: 'invalid-id',
      });
    },
  );

  it('rejects a directory whose name yields no id', async () => {
    const root = await makeTemp();
    await expect(
      generateExtension({ dir: path.join(root, '2024') }),
    ).rejects.toBeInstanceOf(GenerateError);
  });

  it('refuses a non-empty directory and leaves it untouched', async () => {
    const root = await makeTemp();
    const dir = path.join(root, 'acme-hello');
    await mkdir(dir);
    await writeFile(path.join(dir, 'keep.txt'), 'x');
    await expect(generateExtension({ dir })).rejects.toMatchObject({
      code: 'target-not-empty',
    });
    await expect(readFile(path.join(dir, 'keep.txt'), 'utf8')).resolves.toBe(
      'x',
    );
    await expect(readFile(path.join(dir, 'package.json'))).rejects.toThrow();
  });

  it('accepts an existing empty directory', async () => {
    const root = await makeTemp();
    const dir = path.join(root, 'acme-hello');
    await mkdir(dir);
    const result = await generateExtension({ dir });
    expect(result.dir).toBe(dir);
  });

  it('without --local dependencies are placeholders', async () => {
    const root = await makeTemp();
    const { dir, isLocal } = await generateExtension({
      dir: path.join(root, 'acme-hello'),
    });
    const pkg = await readJson(path.join(dir, 'package.json'));
    expect(isLocal).toBe(false);
    expect(pkg['devDependencies']).toMatchObject({
      '@dolphy-app/extension-api': '^0.0.0',
      '@dolphy-app/extension-sdk': '^0.0.0',
      '@dolphy-app/extension-tools': '^0.0.0',
    });
  });

  it('--local writes link: to the repository packages', async () => {
    const root = await makeTemp();
    const { dir, isLocal } = await generateExtension({
      dir: path.join(root, 'acme-hello'),
      localRoot: REPO_ROOT,
    });
    const pkg = await readJson(path.join(dir, 'package.json'));
    expect(isLocal).toBe(true);
    expect(pkg['devDependencies']).toMatchObject({
      '@dolphy-app/extension-api': `link:${REPO_ROOT}/packages/extension-api`,
      '@dolphy-app/extension-sdk': `link:${REPO_ROOT}/packages/extension-sdk`,
      '@dolphy-app/extension-tools': `link:${REPO_ROOT}/packages/extension-tools`,
    });
  });

  it('with a known package version dependencies get its caret range', async () => {
    const root = await makeTemp();
    const { dir, isPublished } = await generateExtension({
      dir: path.join(root, 'acme-hello'),
      packageVersion: '1.2.3',
    });
    const pkg = await readJson(path.join(dir, 'package.json'));
    expect(isPublished).toBe(true);
    expect(pkg['devDependencies']).toMatchObject({
      '@dolphy-app/extension-api': '^1.2.3',
      '@dolphy-app/extension-sdk': '^1.2.3',
      '@dolphy-app/extension-tools': '^1.2.3',
    });
  });

  it('project gets no .npmrc or token section: packages are on npmjs', async () => {
    const root = await makeTemp();
    for (const options of [
      { packageVersion: '1.2.3' },
      { localRoot: REPO_ROOT },
    ]) {
      const { dir, files } = await generateExtension({
        dir: path.join(root, options.localRoot === undefined ? 'npm' : 'local'),
        ...options,
      });
      expect(files).not.toContain('.npmrc');
      const readme = await readFile(path.join(dir, 'README.md'), 'utf8');
      expect(readme).not.toContain('Installing dependencies');
      expect(readme).not.toContain('_authToken');
    }
  });

  it('README describes installation from the catalog, by hand and in development', async () => {
    const root = await makeTemp();
    const { dir } = await generateExtension({
      dir: path.join(root, 'acme-hello'),
      packageVersion: '1.2.3',
    });
    const readme = await readFile(path.join(dir, 'README.md'), 'utf8');
    expect(readme).not.toContain('There is no installation from the app yet');
    expect(readme).toContain('Settings → Extensions → Catalog');
    expect(readme).toContain('<userData>/extensions/');
    expect(readme).toContain('DOLPHY_DEV_EXTENSIONS');
  });

  it('--local not at the repository root errors before writing files', async () => {
    const root = await makeTemp();
    const dir = path.join(root, 'acme-hello');
    await expect(
      generateExtension({ dir, localRoot: root }),
    ).rejects.toMatchObject({ code: 'invalid-local' });
    await expect(readFile(path.join(dir, 'package.json'))).rejects.toThrow();
  });

  it('package.json scripts reference the extension id', async () => {
    const root = await makeTemp();
    const { dir } = await generateExtension({
      dir: path.join(root, 'x'),
      id: 'acme.hello',
    });
    const pkg = await readJson(path.join(dir, 'package.json'));
    expect(pkg['scripts']).toEqual({
      build: 'dolphy-ext build',
      dev: 'dolphy-ext build --watch',
      types: 'dolphy-ext types',
      typecheck: 'dolphy-ext types && tsc',
      validate: 'dolphy-ext validate dist-ext/acme.hello',
      lint: 'dolphy-ext lint',
      test: 'vitest run',
    });
    await expect(
      readJson(path.join(dir, 'tsconfig.json')),
    ).resolves.toMatchObject({
      compilerOptions: { strict: true, noEmit: true },
    });
  });

  it('manifest declares $schema pointing at the installed extension-api package, which is a devDependency', async () => {
    const root = await makeTemp();
    const { dir } = await generateExtension({ dir: path.join(root, 'x') });
    const manifest = await readJson(path.join(dir, 'extension.json'));
    const pkg = await readJson(path.join(dir, 'package.json'));
    expect(manifest['$schema']).toBe(
      './node_modules/@dolphy-app/extension-api/dist/extension.schema.json',
    );
    expect(pkg['devDependencies']).toHaveProperty('@dolphy-app/extension-api');
  });

  it('manifest passes parseManifest; code is bound to the id type from the manifest', async () => {
    const root = await makeTemp();
    const { dir, id } = await generateExtension({
      dir: path.join(root, 'x'),
      id: 'acme.hello',
    });
    const parsed = parseManifest(
      await readJson(path.join(dir, 'extension.json')),
    );
    if (!parsed.ok) throw new Error(formatDiagnostic(parsed.diagnostic));
    const [type] = parsed.manifest.contributes.exerciseTypes;
    expect(type?.id).toBe(id);
    const index = await readFile(path.join(dir, 'src/index.ts'), 'utf8');
    expect(index).toContain(`'${id}': defineExerciseType`);
    expect(index).toContain(`'${id}': defineAnswerView`);
    expect(index).not.toContain('defineAnswerElement');
  });

  it("the project depends on the app's own vue and vuetify, not on a UI kit", async () => {
    const root = await makeTemp();
    const { dir } = await generateExtension({
      dir: path.join(root, 'acme-hello'),
    });
    const pkg = await readJson(path.join(dir, 'package.json'));
    expect(pkg['devDependencies']).toMatchObject({
      vue: '^3.5.35',
      vuetify: '^4.0.1',
    });
    expect(pkg['devDependencies']).not.toHaveProperty(
      '@dolphy-app/extension-ui',
    );
  });
});

const SCRIPT_FREE_COMMANDS = new Set(['install']);

/** `pnpm <name>` words from backticked spans of a markdown file. */
const pnpmCommands = (markdown: string): string[] =>
  [...markdown.matchAll(/`pnpm ([a-z:-]+)[^`]*`/g)].map(
    (match) => match[1] as string,
  );

describe.each(TEMPLATE_NAMES)('project instructions and CI: %s', (template) => {
  const make = async () => {
    const root = await makeTemp();
    const { dir } = await generateExtension({
      dir: path.join(root, 'x'),
      id: 'acme.hello',
      template,
    });
    const pkg = await readJson(path.join(dir, 'package.json'));
    return { dir, scripts: pkg['scripts'] as Record<string, string> };
  };

  it('CLAUDE.md is a one-line pointer to AGENTS.md', async () => {
    const { dir } = await make();
    await expect(readFile(path.join(dir, 'CLAUDE.md'), 'utf8')).resolves.toBe(
      '@AGENTS.md\n',
    );
  });

  it('every pnpm command in AGENTS.md is a script of the project', async () => {
    const { dir, scripts } = await make();
    const agents = await readFile(path.join(dir, 'AGENTS.md'), 'utf8');
    const commands = pnpmCommands(agents);
    expect(commands.length).toBeGreaterThan(5);
    for (const command of commands) {
      expect(
        SCRIPT_FREE_COMMANDS.has(command) || command in scripts,
        `pnpm ${command}`,
      ).toBe(true);
    }
    // the validation set a pull request needs is spelled out
    for (const required of ['build', 'validate', 'lint', 'typecheck', 'test']) {
      expect(commands).toContain(required);
    }
  });

  it('AGENTS.md names the extension id and the guide', async () => {
    const { dir } = await make();
    const agents = await readFile(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('acme.hello');
    expect(agents).toContain(
      'node_modules/@dolphy-app/extension-sdk/docs/quick-start.md',
    );
  });

  it('the guide path named in AGENTS.md exists in the SDK package', async () => {
    const { dir } = await make();
    const agents = await readFile(path.join(dir, 'AGENTS.md'), 'utf8');
    const named = [
      ...agents.matchAll(
        /node_modules\/@dolphy-app\/extension-sdk\/(docs\/[\w.-]+\.md)/g,
      ),
    ].map(([, relative]) => relative as string);
    expect(named).toContain('docs/quick-start.md');
    for (const relative of named) {
      const guide = await readFile(
        path.join(REPO_ROOT, 'packages/extension-sdk', relative),
        'utf8',
      );
      expect(guide.length, relative).toBeGreaterThan(0);
    }
  });

  it('ci.yml runs on push and pull request and runs the check scripts in order', async () => {
    const { dir, scripts } = await make();
    const ci = await readFile(
      path.join(dir, '.github/workflows/ci.yml'),
      'utf8',
    );
    expect(ci).toMatch(/^on:\n {2}push:\n {2}pull_request:\n/m);
    const runs = [...ci.matchAll(/^\s+- run: pnpm (.+)$/gm)].map(
      (match) => match[1] as string,
    );
    expect(runs).toEqual([
      'install --no-frozen-lockfile',
      'build',
      'validate',
      'lint',
      'typecheck',
      'test',
    ]);
    for (const run of runs.slice(1)) expect(scripts).toHaveProperty(run);
  });
});
