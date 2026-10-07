import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildError, buildExtension } from '../src/index.ts';
import { copyProject } from './helpers.ts';

const read = (dir: string, file: string): Promise<string> =>
  readFile(path.join(dir, file), 'utf8');

const buildSurfaces = async () => {
  const root = await copyProject('surfaces');
  const result = await buildExtension({ root, outDir: path.join(root, 'out') });
  return { root, ...result };
};

/** The client file reads `vue` from the app: here the loader gives the test's own instance. */
const importFile = (dir: string, file: string): Promise<unknown> => {
  vi.stubGlobal('__dolphy', {
    require: (name: string) => import(name) as Promise<unknown>,
  });
  return import(pathToFileURL(path.join(dir, file)).href) as Promise<unknown>;
};

const edit = async (
  file: string,
  change: (text: string) => string,
): Promise<void> => {
  await writeFile(file, change(await readFile(file, 'utf8')));
};

const failure = async (root: string): Promise<string> => {
  const error = await buildExtension({ root }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BuildError);
  return (error as BuildError).message;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shims: output files', () => {
  it('there are exactly two files of code, no shared chunks', async () => {
    const { files } = await buildSurfaces();
    expect(files).toEqual(['client.mjs', 'extension.json', 'main.mjs']);
  });

  it('server code is only in main.mjs, client code only in client.mjs', async () => {
    const { dir } = await buildSurfaces();
    const main = await read(dir, 'main.mjs');
    const client = await read(dir, 'client.mjs');
    expect(main).toContain('SERVER_ONLY_MARKER');
    expect(main).toContain('child_process');
    for (const marker of [
      'VIEW_ONE_MARKER',
      'VIEW_TWO_MARKER',
      'PANEL_FIRST_MARKER',
      'INJECTION_CARD_MARKER',
      'ALPHA_MARKER',
    ]) {
      expect(main, marker).not.toContain(marker);
      expect(client, marker).toContain(marker);
    }
    expect(client).not.toContain('SERVER_ONLY_MARKER');
    expect(client).not.toContain('child_process');
  });

  it('main.mjs exports server and client.mjs exports client, nothing else', async () => {
    const { dir } = await buildSurfaces();
    const main = (await importFile(dir, 'main.mjs')) as { server: unknown };
    const client = (await importFile(dir, 'client.mjs')) as {
      client: (context: unknown) => void;
    };
    expect(Object.keys(main)).toEqual(['server']);
    expect(typeof main.server).toBe('function');
    expect(Object.keys(client)).toEqual(['client']);
    const calls: string[] = [];
    client.client({
      addAnswerView: (id: string) => calls.push(`view:${id}`),
      addPanel: ({ id }: { id: string }) => calls.push(`panel:${id}`),
      addInjection: ({ id }: { id: string }) => calls.push(`injection:${id}`),
      addMarkdownRenderer: (language: string) => calls.push(`md:${language}`),
    });
    expect(calls).toEqual([
      'view:acme.surfaces.one',
      'view:acme.surfaces.two',
      'panel:acme.surfaces.first',
      'injection:acme.surfaces.plan',
      'md:alpha',
    ]);
  });

  it('client.mjs takes vue from the app and does not carry it', async () => {
    const root = await copyProject('hello');
    const { dir } = await buildExtension({ root });
    const code = await read(dir, 'client.mjs');
    expect(code).toContain('globalThis.__dolphy.require("vue")');
    expect(code).not.toMatch(/from\s*["']vue/);
    expect(code).not.toContain('createVNode');
    expect(Buffer.byteLength(code)).toBeLessThan(2 * 1024);
  });

  it('vue, vuetify and their style sheets stay out of main.mjs and the client takes them from the app', async () => {
    const root = await copyProject('widget-host');
    await edit(
      path.join(root, 'src', 'index.ts'),
      (text) => `${text}\nexport const server = () => {};\n`,
    );
    const { dir, files } = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    expect(files).toEqual(['client.mjs', 'extension.json', 'main.mjs']);
    expect(await read(dir, 'main.mjs')).not.toMatch(/vue|vuetify/);
    const client = await read(dir, 'client.mjs');
    expect(client).toContain('WIDGET_ALERT');
    expect(client).toContain(
      'globalThis.__dolphy.require("vuetify/components")',
    );
    expect(client).not.toMatch(/from\s*["'](vue|vuetify)/);
    expect(client).not.toContain('vuetify/styles');
    expect(Buffer.byteLength(client)).toBeLessThan(5 * 1024);
  });

  it('a client part alone builds a single file; a server part alone too', async () => {
    const { files: clientFiles } = await buildExtension({
      root: await copyProject('markdown-only'),
    });
    expect(clientFiles).toEqual(['client.mjs', 'extension.json']);
    const root = await copyProject('hello');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace('export const client', 'const client'),
    );
    const { files } = await buildExtension({ root });
    expect(files).toEqual(['extension.json', 'main.mjs']);
  });

  it('server and client found through relative re-exports', async () => {
    const root = await copyProject('surfaces');
    const source = await read(root, 'src/index.ts');
    await writeFile(path.join(root, 'src', 'parts.ts'), source);
    await writeFile(
      path.join(root, 'src', 'index.ts'),
      "export { server, client } from './parts.ts';\n",
    );
    const { dir } = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    expect(await read(dir, 'main.mjs')).toContain('SERVER_ONLY_MARKER');
    expect(await read(dir, 'client.mjs')).toContain('VIEW_ONE_MARKER');
  });
});

describe('src/index.ts and the exports', () => {
  it('neither server nor client — an error naming the file', async () => {
    const root = await copyProject('hello');
    await writeFile(path.join(root, 'src', 'index.ts'), 'export {};\n');
    expect(await failure(root)).toContain(
      "src/index.ts exports neither 'server' nor 'client'",
    );
  });

  it('a source that does not parse is reported with the file', async () => {
    const root = await copyProject('hello');
    await edit(
      path.join(root, 'src', 'index.ts'),
      (text) => `${text}\nexport const = ;`,
    );
    expect(await failure(root)).toContain('src/index.ts cannot be read');
  });

  it('a bundling error names the output file and its export', async () => {
    const root = await copyProject('hello');
    await edit(
      path.join(root, 'src', 'index.ts'),
      (text) => `import './missing.ts';\n${text}`,
    );
    expect(await failure(root)).toContain(
      'failed to bundle main.mjs (server from src/index.ts)',
    );
  });
});

describe('boundaries between the parts', () => {
  it('node:* used by the client — an error with the file and module', async () => {
    const root = await copyProject('hello');
    await edit(
      path.join(root, 'src', 'index.ts'),
      (text) =>
        `import { readFileSync } from 'node:fs';\n${text.replace("h('input')", "(readFileSync('x'), h('input'))")}`,
    );
    const message = await failure(root);
    expect(message).toContain('client.mjs imports');
    expect(message).toContain("'node:fs'");
  });

  it('a built-in module without the prefix too', async () => {
    const root = await copyProject('hello');
    await edit(
      path.join(root, 'src', 'index.ts'),
      (text) =>
        `import { join } from 'path';\n${text.replace("h('input')", "(join('x'), h('input'))")}`,
    );
    expect(await failure(root)).toContain("'path'");
  });

  it('a package from the config’s external that the client needs — an error', async () => {
    const root = await copyProject('with-worker');
    await edit(
      path.join(root, 'src', 'index.ts'),
      (text) =>
        `import external from 'dolphy-fixture-external';\n${text.replace("'worker view'", 'String(external)')}`,
    );
    const message = await failure(root);
    expect(message).toContain('client.mjs imports');
    expect(message).toContain("'dolphy-fixture-external'");
  });

  it('vue used by the server — an error with the file and module', async () => {
    const root = await copyProject('hello');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace(
        'project: () => ({}),',
        'project: () => ({ view: String(input) }),',
      ),
    );
    const message = await failure(root);
    expect(message).toContain('main.mjs imports');
    expect(message).toContain("'vue'");
  });

  it('node:* in server code is fine while the client does not use it', async () => {
    const { files } = await buildSurfaces();
    expect(files).toContain('client.mjs');
  });
});
