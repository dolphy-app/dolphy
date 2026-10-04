import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverExtensions } from '@dolphy-app/extension-host';
import { describe, expect, it } from 'vitest';
import { BuildError, buildExtension, validateExtension } from '../src/index.ts';
import { copyProject, makeTemp } from './helpers.ts';

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe('buildExtension', () => {
  it('T-01 builds exactly the expected set of files', async () => {
    const root = await copyProject('hello');
    const result = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    expect(result.id).toBe('acme.hello');
    expect(result.dir).toBe(path.join(root, 'out', 'acme.hello'));
    expect(result.files).toEqual(['extension.json', 'main.mjs', 'view.mjs']);
  });

  it('writes .dolphy/ids.d.ts into the project, not the built directory', async () => {
    const root = await copyProject('commands-panel');
    const result = await buildExtension({ root });
    expect(result.files).toEqual(['extension.json', 'main.mjs', 'panel.mjs']);
    const ids = await readFile(path.join(root, '.dolphy', 'ids.d.ts'), 'utf8');
    expect(ids).toContain("commands: 'acme.commands-panel.open'");
    await expect(
      readFile(path.join(result.dir, '.dolphy', 'ids.d.ts')),
    ).rejects.toThrow();
  });

  it('T-02 main.mjs imports and exports activate; the root is detected', async () => {
    const root = await copyProject('hello');
    const outDir = path.join(root, 'out');
    const { dir } = await buildExtension({ root, outDir });
    const module = (await import(
      pathToFileURL(path.join(dir, 'main.mjs')).href
    )) as { default: { activate: unknown } };
    expect(typeof module.default.activate).toBe('function');

    const { extensions, diagnostics } = await discoverExtensions({
      roots: [{ dir: outDir, origin: 'user' }],
      logger: silentLogger,
    });
    expect(diagnostics).toEqual([]);
    expect(extensions.map((extension) => extension.id)).toEqual(['acme.hello']);
  });

  it('R8 a normal build writes no source maps', async () => {
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

  it('T-03 writes to <root>/dist-ext/<id>', async () => {
    const root = await copyProject('hello');
    const { dir } = await buildExtension({ root });
    expect(dir).toBe(path.join(root, 'dist-ext', 'acme.hello'));
  });

  it('T-04 copies the manifest’s source bytes', async () => {
    const root = await copyProject('hello');
    const { dir } = await buildExtension({
      root,
      outDir: path.join(root, 'o'),
    });
    const built = await readFile(path.join(dir, 'extension.json'));
    const source = await readFile(path.join(root, 'extension.json'));
    expect(built.equals(source)).toBe(true);
  });

  it('T-05 second bundle and external dependencies', async () => {
    const root = await copyProject('with-worker');
    const { dir, files } = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    expect(files).toEqual([
      'extension.json',
      'main.mjs',
      'schema/answer.json',
      'schema/spec.json',
      'view.mjs',
      'worker.mjs',
    ]);
    const main = await readFile(path.join(dir, 'main.mjs'), 'utf8');
    expect(main).toContain('dolphy-fixture-external');
    expect(main).toContain('bundled-helper');
    const worker = await readFile(path.join(dir, 'worker.mjs'), 'utf8');
    expect(worker).toContain('bundled-helper');
    expect(worker).not.toContain('dolphy-fixture-external');
  });

  it('T-06 invalid manifest — BuildError with the app’s text', async () => {
    const root = await copyProject('bad-manifest');
    const error = await buildExtension({ root }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).name).toBe('BuildError');
    expect((error as BuildError).message).toContain('invalid extension id');
  });

  it('T-07 no src/index.ts — the error names the file', async () => {
    const root = await copyProject('no-entry');
    const error = await buildExtension({ root }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).message).toContain("'src/index.ts'");
  });

  it('T-08 missing manifest — a clear error', async () => {
    const root = await makeTemp();
    const error = await buildExtension({ root }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).message).toContain('extension.json');
  });

  it('T-09 a schema file from the manifest outside schema/ is copied', async () => {
    const root = await copyProject('hello');
    const manifestFile = path.join(root, 'extension.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    manifest.contributes.exerciseTypes[0].answerSchema = './specs/a.json';
    await writeFile(manifestFile, JSON.stringify(manifest));
    await expect(buildExtension({ root })).rejects.toThrow(
      "schema 'specs/a.json' referenced by the manifest is not found",
    );
    await mkdir(path.join(root, 'specs'));
    await writeFile(path.join(root, 'specs', 'a.json'), '{"type":"string"}');
    const { files } = await buildExtension({ root });
    expect(files).toContain('specs/a.json');
  });
});

describe('extensions without code', () => {
  it('theme without a src directory: manifest only, validate passes', async () => {
    const root = await copyProject('theme-only');
    const { dir, files } = await buildExtension({ root });
    expect(files).toEqual(['extension.json']);
    expect(await validateExtension(dir)).toEqual({
      ok: true,
      problems: [],
      warnings: [],
    });
  });

  it('content renderer: only the markdown.mjs browser bundle', async () => {
    const root = await copyProject('markdown-only');
    const { dir, files } = await buildExtension({ root });
    expect(files).toEqual(['extension.json', 'markdown.mjs']);
    expect(await validateExtension(dir)).toEqual({
      ok: true,
      problems: [],
      warnings: [],
    });
  });

  it('no src/index.ts — the error names the file', async () => {
    const root = await copyProject('markdown-only');
    await rm(path.join(root, 'src'), { recursive: true });
    await expect(buildExtension({ root })).rejects.toThrow(/src\/index\.ts/);
  });
});

describe('validateExtension', () => {
  it('T-10 the built directory is valid', async () => {
    const root = await copyProject('hello');
    const { dir } = await buildExtension({ root });
    expect(await validateExtension(dir)).toEqual({
      ok: true,
      problems: [],
      warnings: [],
    });
  });

  it('T-11 no main.mjs — the problem names the file', async () => {
    const root = await copyProject('hello');
    const { dir } = await buildExtension({ root });
    await rm(path.join(dir, 'main.mjs'));
    const result = await validateExtension(dir);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('main.mjs');
  });

  it('T-12 directory without a manifest', async () => {
    const result = await validateExtension(await makeTemp());
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('extension.json');
  });
});
