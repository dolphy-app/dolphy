import { readFile } from 'node:fs/promises';
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
  exercise: ['client.mjs', 'extension.json', 'main.mjs'],
  theme: ['client.mjs', 'extension.json'],
  'command-panel': ['client.mjs', 'extension.json', 'main.mjs'],
  'react-panel': ['client.mjs', 'extension.json', 'main.mjs'],
  events: ['client.mjs', 'extension.json', 'main.mjs'],
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
    expect(builtManifest['main']).toBe(
      BUILT_FILES[template]?.includes('main.mjs') ? './main.mjs' : null,
    );
    expect(builtManifest['client']).toBe(
      BUILT_FILES[template]?.includes('client.mjs') ? './client.mjs' : null,
    );
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
      const client = await readFile(path.join(built.dir, 'client.mjs'), 'utf8');
      // Vue is the app's own: the bundle reads it from the host, it does not carry it
      expect(client).toContain('__dolphy');
      expect(client.length).toBeLessThan(20_000);
      const main = await readFile(path.join(built.dir, 'main.mjs'), 'utf8');
      expect(main).not.toContain('__dolphy');
    }
    if (template === 'command-panel') {
      const client = await readFile(path.join(built.dir, 'client.mjs'), 'utf8');
      // the single-file component: Vue and Vuetify are the host's, the styles go in as a tag
      expect(client).toContain('__dolphy');
      expect(client).toContain('data-dolphy-ext');
      expect(client.length).toBeLessThan(20_000);
    }
    if (template === 'react-panel') {
      const client = await readFile(path.join(built.dir, 'client.mjs'), 'utf8');
      // React is the extension's own: the bundle carries it
      expect(client).toContain('createRoot');
      expect(client.length).toBeGreaterThan(200_000);
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
