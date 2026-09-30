import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout } from 'node:timers/promises';
import { join } from 'node:path';
import type { CourseSource } from '@dolphy-app/engine';
import { createMemoryCourseSource, buildLibrary } from '@dolphy-app/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeFsCourseSource } from '../../src/node/index.ts';

type Files = Readonly<Record<string, string>>;

interface Harness {
  name: string;
  make(files: Files): Promise<CourseSource>;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const makeTmp = async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'engine-src-')));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

const writeFiles = async (root: string, files: Files) => {
  for (const [path, text] of Object.entries(files)) {
    const abs = join(root, path);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, text);
  }
};

const memory: Harness = {
  name: 'memory',
  make: async (files) =>
    createMemoryCourseSource(buildLibrary({ courses: [] }), files),
};

const nodeFs: Harness = {
  name: 'nodeFs',
  make: async (files) => {
    const root = await makeTmp();
    await writeFiles(root, files);
    return createNodeFsCourseSource(root);
  },
};

const FILES: Files = {
  'a.txt': 'alpha',
  'B.txt': 'bravo',
  _x: 'underscore',
  'é.txt': 'accent',
  'z/inner.txt': 'Ответ ✓',
  '.hidden/config': 'dot dir',
  'unicode.md': '\uFEFFпривет\r\nмир',
};

describe.each([memory, nodeFs])('CourseSource contract: $name', (harness) => {
  it('list: сортировка по коду символов, точечные каталоги, виды записей', async () => {
    const source = await harness.make(FILES);
    expect(await source.list('')).toEqual([
      { name: '.hidden', kind: 'directory' },
      { name: 'B.txt', kind: 'file' },
      { name: '_x', kind: 'file' },
      { name: 'a.txt', kind: 'file' },
      { name: 'unicode.md', kind: 'file' },
      { name: 'z', kind: 'directory' },
      { name: 'é.txt', kind: 'file' },
    ]);
    expect(await source.list('.hidden')).toEqual([
      { name: 'config', kind: 'file' },
    ]);
  });

  it('list: нет каталога — отказ', async () => {
    const source = await harness.make(FILES);
    await expect(source.list('nope')).rejects.toThrow();
  });

  it('readText: текст как есть, BOM и CRLF сохраняются; нет файла — отказ', async () => {
    const source = await harness.make(FILES);
    expect(await source.readText('z/inner.txt')).toBe('Ответ ✓');
    expect(await source.readText('unicode.md')).toBe('\uFEFFпривет\r\nмир');
    await expect(source.readText('nope.txt')).rejects.toThrow();
  });

  it('readBytes: байты UTF-8; нет файла — отказ', async () => {
    const source = await harness.make(FILES);
    const bytes = await source.readBytes('z/inner.txt');
    expect([...bytes]).toEqual([...new TextEncoder().encode('Ответ ✓')]);
    await expect(source.readBytes('nope.txt')).rejects.toThrow();
  });

  it('stat: файл (размер в байтах), каталог, корень, нет пути', async () => {
    const source = await harness.make(FILES);
    expect(await source.stat('z/inner.txt')).toMatchObject({
      kind: 'file',
      bytes: 14, // 5 кириллических × 2 + пробел + ✓ (3 байта)
    });
    expect(await source.stat('z')).toMatchObject({ kind: 'directory' });
    expect(await source.stat('')).toMatchObject({ kind: 'directory' });
    expect(await source.stat('nope')).toBeNull();
    expect(await source.stat('a.txt/inner')).toBeNull();
  });

  it('артефакт: нет — null; запись и перезапись', async () => {
    const source = await harness.make(FILES);
    expect(await source.readArtifact()).toBeNull();
    await source.writeArtifact('{"v":1}');
    expect(await source.readArtifact()).toBe('{"v":1}');
    await source.writeArtifact('{"v":2}');
    expect(await source.readArtifact()).toBe('{"v":2}');
  });
});

describe('CourseSource contract: nodeFs', () => {
  it('readBytes: не-UTF-8 байты возвращаются как есть', async () => {
    const root = await makeTmp();
    const raw = Uint8Array.of(0xff, 0xfe, 0x00, 0xc3, 0x28, 0x80);
    await writeFile(join(root, 'bin.dat'), raw);
    const bytes = await createNodeFsCourseSource(root).readBytes('bin.dat');
    expect([...bytes]).toEqual([...raw]);
  });

  it('list: пустой каталог виден как каталог и сам пуст', async () => {
    const root = await makeTmp();
    await mkdir(join(root, 'empty'));
    const source = createNodeFsCourseSource(root);
    expect(await source.list('')).toEqual([
      { name: 'empty', kind: 'directory' },
    ]);
    expect(await source.list('empty')).toEqual([]);
  });

  it('stat: mtimeMs, ctimeMs и ino берутся у файла', async () => {
    const root = await makeTmp();
    await writeFile(join(root, 'f.txt'), 'x');
    const expected = statSync(join(root, 'f.txt'));
    const got = await createNodeFsCourseSource(root).stat('f.txt');
    expect(got).toEqual({
      kind: 'file',
      bytes: 1,
      mtimeMs: expected.mtimeMs,
      ctimeMs: expected.ctimeMs,
      ino: expected.ino,
    });
  });

  it('симлинк на файл внутри корня: запись помечена, за корень не выходит', async () => {
    const root = await makeTmp();
    await writeFile(join(root, 'real.txt'), 'data');
    await symlink('real.txt', join(root, 'link.txt'));
    const source = createNodeFsCourseSource(root);
    expect(await source.list('')).toEqual([
      { name: 'link.txt', kind: 'file', symlink: true },
      { name: 'real.txt', kind: 'file' },
    ]);
    const stat = await source.stat('link.txt');
    expect(stat).toMatchObject({ kind: 'file', bytes: 4 });
    expect(stat?.outsideRoot).toBeUndefined();
    expect(stat?.realPath).toBe(join(root, 'real.txt'));
    expect(await source.readText('link.txt')).toBe('data');
  });

  it('симлинк на файл вне корня: outsideRoot и realPath цели', async () => {
    const outer = await makeTmp();
    const root = join(outer, 'lib');
    await mkdir(root);
    await writeFile(join(outer, 'secret.txt'), 'secret');
    await symlink('../secret.txt', join(root, 'link.txt'));
    const stat = await createNodeFsCourseSource(root).stat('link.txt');
    expect(stat).toMatchObject({
      kind: 'file',
      outsideRoot: true,
      realPath: join(outer, 'secret.txt'),
    });
  });

  it('симлинк-каталог вне корня: outsideRoot и у файлов под ним', async () => {
    const outer = await makeTmp();
    const root = join(outer, 'lib');
    await mkdir(root);
    await mkdir(join(outer, 'other/deep'), { recursive: true });
    await writeFile(join(outer, 'other/deep/f.txt'), 'x');
    await symlink('../other', join(root, 'out'));
    const source = createNodeFsCourseSource(root);
    expect(await source.list('')).toEqual([
      { name: 'out', kind: 'directory', symlink: true },
    ]);
    expect(await source.stat('out')).toMatchObject({ outsideRoot: true });
    expect(await source.stat('out/deep')).toMatchObject({
      kind: 'directory',
      outsideRoot: true,
      realPath: join(outer, 'other/deep'),
    });
    expect(await source.stat('out/deep/f.txt')).toMatchObject({
      kind: 'file',
      outsideRoot: true,
    });
  });

  it('корень сам симлинк: файлы внутри не считаются внешними', async () => {
    const outer = await makeTmp();
    await mkdir(join(outer, 'real/sub'), { recursive: true });
    await writeFile(join(outer, 'real/sub/f.txt'), 'x');
    await symlink('real', join(outer, 'rootlink'));
    const source = createNodeFsCourseSource(join(outer, 'rootlink'));
    const stat = await source.stat('sub/f.txt');
    expect(stat).toMatchObject({ kind: 'file' });
    expect(stat?.outsideRoot).toBeUndefined();
    expect(stat?.realPath).toBeUndefined();
  });

  it('висячая ссылка и петля ссылок: в list не попадают, stat = null', async () => {
    const root = await makeTmp();
    await symlink('nowhere', join(root, 'dangling'));
    await symlink('loop-b', join(root, 'loop-a'));
    await symlink('loop-a', join(root, 'loop-b'));
    await writeFile(join(root, 'ok.txt'), 'x');
    const source = createNodeFsCourseSource(root);
    expect(await source.list('')).toEqual([{ name: 'ok.txt', kind: 'file' }]);
    expect(await source.stat('dangling')).toBeNull();
    expect(await source.stat('loop-a')).toBeNull();
  });

  it('writeArtifact атомарен: нет временных файлов, параллельные записи целы', async () => {
    const root = await makeTmp();
    const source = createNodeFsCourseSource(root);
    const texts = Array.from({ length: 8 }, (_, i) => `{"v":${i}}`.repeat(500));
    await Promise.all(texts.map((text) => source.writeArtifact(text)));
    const stored = await source.readArtifact();
    expect(texts).toContain(stored);
    expect(await readdir(join(root, '.engine'))).toEqual(['compiled.json']);
    expect(await readFile(join(root, '.engine/compiled.json'), 'utf8')).toBe(
      stored,
    );
  });

  it('подмена каталога симлинком наружу видна долгоживущему источнику', async () => {
    const outer = await makeTmp();
    const root = join(outer, 'lib');
    await mkdir(join(root, 'dir'), { recursive: true });
    await writeFile(join(root, 'dir/f.txt'), 'inside');
    await mkdir(join(outer, 'other'));
    await writeFile(join(outer, 'other/f.txt'), 'outside');
    const source = createNodeFsCourseSource(root);
    expect((await source.stat('dir/f.txt'))?.outsideRoot).toBeUndefined();
    await rm(join(root, 'dir'), { recursive: true });
    await symlink(join(outer, 'other'), join(root, 'dir'));
    // кэш реальных путей короткоживущий: ждём его срока
    await setTimeout(150);
    expect((await source.stat('dir/f.txt'))?.outsideRoot).toBe(true);
  });

  it('выход за корень отвергается до обращения к ФС', async () => {
    const outer = await makeTmp();
    const root = join(outer, 'lib');
    await mkdir(root);
    await writeFile(join(outer, 'x.txt'), 'outside');
    const source = createNodeFsCourseSource(root);
    await expect(source.readText('../x.txt')).rejects.toThrow(/escapes/);
    await expect(source.readBytes('a/../../x.txt')).rejects.toThrow(/escapes/);
    await expect(source.stat('../x.txt')).rejects.toThrow(/escapes/);
    await expect(source.list('..')).rejects.toThrow(/escapes/);
    await expect(source.readText(join(outer, 'x.txt'))).rejects.toThrow(
      /escapes/,
    );
  });
});
