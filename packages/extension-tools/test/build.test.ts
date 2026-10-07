import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BuildError, buildExtension, validateExtension } from '../src/index.ts';
import { copyProject, makeTemp } from './helpers.ts';

const readBuiltManifest = async (dir: string) =>
  JSON.parse(await readFile(path.join(dir, 'extension.json'), 'utf8')) as {
    main: string | null;
    client: string | null;
  };

describe('buildExtension', () => {
  it('builds main.mjs from server and client.mjs from client', async () => {
    const root = await copyProject('hello');
    const result = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    expect(result.id).toBe('acme.hello');
    expect(result.dir).toBe(path.join(root, 'out', 'acme.hello'));
    expect(result.files).toEqual(['client.mjs', 'extension.json', 'main.mjs']);
  });

  it('writes main and client of the built manifest by the exports', async () => {
    const both = await buildExtension({ root: await copyProject('hello') });
    expect(await readBuiltManifest(both.dir)).toMatchObject({
      main: './main.mjs',
      client: './client.mjs',
    });
    const clientOnly = await buildExtension({
      root: await copyProject('theme-only'),
    });
    expect(clientOnly.files).toEqual(['client.mjs', 'extension.json']);
    expect(await readBuiltManifest(clientOnly.dir)).toMatchObject({
      main: null,
      client: './client.mjs',
    });
  });

  it('keeps the other manifest fields of the source', async () => {
    const root = await copyProject('with-metadata');
    const { dir } = await buildExtension({ root });
    expect(await readBuiltManifest(dir)).toMatchObject({
      id: 'acme.meta',
      name: 'Meta',
      author: 'octo-cat',
      platforms: ['darwin', 'linux', 'win32'],
      minAppVersion: '1.0.0',
    });
  });

  it('main.mjs exports the server entry by name', async () => {
    const root = await copyProject('hello');
    const { dir } = await buildExtension({ root });
    const module = (await import(
      pathToFileURL(path.join(dir, 'main.mjs')).href
    )) as { server: unknown; default?: unknown };
    expect(typeof module.server).toBe('function');
    expect(module.default).toBeUndefined();
  });

  it('a normal build writes no source maps', async () => {
    for (const name of ['hello', 'commands-panel', 'with-worker']) {
      const root = await copyProject(name);
      const { dir, files } = await buildExtension({ root });
      const scripts = files.filter((file) => file.endsWith('.mjs'));
      expect(scripts.length).toBeGreaterThan(0);
      for (const file of scripts) {
        const text = await readFile(path.join(dir, file), 'utf8');
        expect(text).not.toContain('sourceMappingURL');
      }
    }
  });

  it('writes to <root>/dist-ext/<id> by default', async () => {
    const root = await copyProject('hello');
    const { dir } = await buildExtension({ root });
    expect(dir).toBe(path.join(root, 'dist-ext', 'acme.hello'));
  });

  it('builds worker entries and keeps config externals out of the bundle', async () => {
    const root = await copyProject('with-worker');
    const { dir, files } = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    expect(files).toEqual([
      'client.mjs',
      'extension.json',
      'main.mjs',
      'worker.mjs',
    ]);
    const main = await readFile(path.join(dir, 'main.mjs'), 'utf8');
    expect(main).toContain('dolphy-fixture-external');
    expect(main).toContain('bundled-helper');
    const worker = await readFile(path.join(dir, 'worker.mjs'), 'utf8');
    expect(worker).toContain('bundled-helper');
    expect(worker).not.toContain('dolphy-fixture-external');
  });

  it('an invalid manifest is a BuildError with the app’s text', async () => {
    const root = await copyProject('bad-manifest');
    const error = await buildExtension({ root }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).message).toContain('invalid extension id');
  });

  it('no src/index.ts: the error names the file', async () => {
    const root = await copyProject('no-entry');
    const error = await buildExtension({ root }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).message).toContain("'src/index.ts'");
  });

  it('a missing manifest is a clear error', async () => {
    const root = await makeTemp();
    const error = await buildExtension({ root }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).message).toContain('extension.json');
  });
});

describe('validateExtension', () => {
  it('the built directory is valid', async () => {
    for (const name of ['hello', 'theme-only', 'commands-panel']) {
      const { dir } = await buildExtension({ root: await copyProject(name) });
      expect(await validateExtension(dir)).toEqual({ ok: true, problems: [] });
    }
  });

  it('a part named by the manifest but missing on disk is a problem naming the file', async () => {
    const root = await copyProject('hello');
    const { dir } = await buildExtension({ root });
    await rm(path.join(dir, 'main.mjs'));
    const result = await validateExtension(dir);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('main.mjs');
  });

  it('a directory without a manifest', async () => {
    const result = await validateExtension(await makeTemp());
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('extension.json');
  });
});
