import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverExtensions } from '@lms/extension-host';
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
  it('T-01 собирает ровно ожидаемый набор файлов', async () => {
    const root = await copyProject('hello');
    const result = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    expect(result.id).toBe('acme.hello');
    expect(result.dir).toBe(path.join(root, 'out', 'acme.hello'));
    expect(result.files).toEqual(['extension.json', 'main.mjs', 'view.mjs']);
  });

  it('T-02 main.mjs импортируется и экспортирует activate; корень обнаруживается', async () => {
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

  it('T-03 по умолчанию пишет в <root>/dist-ext/<id>', async () => {
    const root = await copyProject('hello');
    const { dir } = await buildExtension({ root });
    expect(dir).toBe(path.join(root, 'dist-ext', 'acme.hello'));
  });

  it('T-04 копирует исходные байты манифеста', async () => {
    const root = await copyProject('hello');
    const { dir } = await buildExtension({
      root,
      outDir: path.join(root, 'o'),
    });
    const built = await readFile(path.join(dir, 'extension.json'));
    const source = await readFile(path.join(root, 'extension.json'));
    expect(built.equals(source)).toBe(true);
  });

  it('T-05 второй бандл и внешние зависимости', async () => {
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
    expect(main).toContain('lms-fixture-external');
    expect(main).toContain('bundled-helper');
    const worker = await readFile(path.join(dir, 'worker.mjs'), 'utf8');
    expect(worker).toContain('bundled-helper');
    expect(worker).not.toContain('lms-fixture-external');
  });

  it('T-06 неверный манифест — BuildError с текстом приложения', async () => {
    const root = await copyProject('bad-manifest');
    const error = await buildExtension({ root }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).name).toBe('BuildError');
    expect((error as BuildError).message).toContain('invalid extension id');
  });

  it('T-07 нет src/main.ts — ошибка называет файл', async () => {
    const root = await copyProject('no-main-source');
    const error = await buildExtension({ root }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).message).toContain("'src/main.ts'");
  });

  it('T-08 отсутствует манифест — понятная ошибка', async () => {
    const root = await makeTemp();
    const error = await buildExtension({ root }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).message).toContain('extension.json');
  });

  it('T-09 схема-файл из манифеста вне schema/ копируется', async () => {
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

describe('расширения без кода', () => {
  it('тема без каталога src: только манифест, validate проходит', async () => {
    const root = await copyProject('theme-only');
    const { dir, files } = await buildExtension({ root });
    expect(files).toEqual(['extension.json']);
    expect(await validateExtension(dir)).toEqual({ ok: true, problems: [] });
  });

  it('рендерер содержимого: только браузерный бандл markdown.mjs', async () => {
    const root = await copyProject('markdown-only');
    const { dir, files } = await buildExtension({ root });
    expect(files).toEqual(['extension.json', 'markdown.mjs']);
    expect(await validateExtension(dir)).toEqual({ ok: true, problems: [] });
  });

  it('нет src/markdown.ts — ошибка называет файл', async () => {
    const root = await copyProject('markdown-only');
    await rm(path.join(root, 'src'), { recursive: true });
    await expect(buildExtension({ root })).rejects.toThrow(/src\/markdown\.ts/);
  });
});

describe('validateExtension', () => {
  it('T-10 собранный каталог валиден', async () => {
    const root = await copyProject('hello');
    const { dir } = await buildExtension({ root });
    expect(await validateExtension(dir)).toEqual({ ok: true, problems: [] });
  });

  it('T-11 нет main.mjs — проблема называет файл', async () => {
    const root = await copyProject('hello');
    const { dir } = await buildExtension({ root });
    await rm(path.join(dir, 'main.mjs'));
    const result = await validateExtension(dir);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('main.mjs');
  });

  it('T-12 каталог без манифеста', async () => {
    const result = await validateExtension(await makeTemp());
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('extension.json');
  });
});
