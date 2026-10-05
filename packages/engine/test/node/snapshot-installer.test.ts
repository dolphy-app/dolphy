import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeSnapshotInstaller } from '../../src/node/index.ts';
import { useTmpDirs, writeFiles } from '../helpers/tmp.ts';

const tmp = useTmpDirs();

const setup = async () => {
  const root = await tmp.make();
  const libraryRoot = join(root, 'library');
  const dataDir = join(root, 'data');
  await mkdir(libraryRoot);
  await mkdir(dataDir);
  return {
    libraryRoot,
    dataDir,
    installer: createNodeSnapshotInstaller({ libraryRoot, dataDir }),
  };
};

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe('createNodeSnapshotInstaller', () => {
  it('begin creates empty operation dirs next to the library and in dataDir', async () => {
    const { installer, libraryRoot, dataDir } = await setup();
    const dirs = await installer.begin('repositories', 'acme', 'op1');
    expect(dirs).toEqual({
      stagingDir: join(libraryRoot, '.staging', 'op1', 'acme'),
      tmpDir: join(dataDir, 'git-tmp', 'op1'),
    });
    expect(await readdir(dirs.stagingDir)).toEqual([]);
    expect(await readdir(dirs.tmpDir)).toEqual([]);
    expect(installer.snapshotPath('repositories', 'acme-sql')).toBe(
      'repositories/acme-sql',
    );
  });

  it('install puts the staging tree under repositories/<id>; finish removes the operation dirs', async () => {
    const { installer, libraryRoot, dataDir } = await setup();
    const { stagingDir } = await installer.begin('repositories', 'acme', 'op1');
    await writeFiles(stagingDir, { 'course/a.txt': 'one' });
    expect(await installer.exists('repositories', 'acme')).toBe(false);
    await installer.install('repositories', 'acme', 'op1');
    expect(await installer.exists('repositories', 'acme')).toBe(true);
    expect(
      await readFile(
        join(libraryRoot, 'repositories/acme/course/a.txt'),
        'utf8',
      ),
    ).toBe('one');
    expect(await exists(stagingDir)).toBe(false);
    await installer.finish('op1');
    expect(await exists(join(libraryRoot, '.trash', 'op1'))).toBe(false);
    expect(await exists(join(dataDir, 'git-tmp', 'op1'))).toBe(false);
  });

  it('install replaces an existing snapshot and rollback brings the old one back', async () => {
    const { installer, libraryRoot } = await setup();
    const first = await installer.begin('repositories', 'acme', 'op1');
    await writeFiles(first.stagingDir, { 'v.txt': 'old' });
    await installer.install('repositories', 'acme', 'op1');
    await installer.finish('op1');

    const second = await installer.begin('repositories', 'acme', 'op2');
    await writeFiles(second.stagingDir, { 'v.txt': 'new' });
    await installer.install('repositories', 'acme', 'op2');
    const target = join(libraryRoot, 'repositories/acme/v.txt');
    expect(await readFile(target, 'utf8')).toBe('new');
    expect(
      await readFile(
        join(libraryRoot, '.trash/repositories/op2/acme/v.txt'),
        'utf8',
      ),
    ).toBe('old');

    await installer.rollback('repositories', 'acme', 'op2');
    expect(await readFile(target, 'utf8')).toBe('old');
    await installer.finish('op2');
    expect(await exists(join(libraryRoot, '.trash', 'op2'))).toBe(false);
  });

  it('rollback of a first install leaves no snapshot', async () => {
    const { installer } = await setup();
    const { stagingDir } = await installer.begin('repositories', 'acme', 'op1');
    await writeFiles(stagingDir, { 'v.txt': 'new' });
    await installer.install('repositories', 'acme', 'op1');
    await installer.rollback('repositories', 'acme', 'op1');
    expect(await installer.exists('repositories', 'acme')).toBe(false);
  });

  it('stagingSource shows the snapshot as a child dir of the operation root', async () => {
    const { installer } = await setup();
    const { stagingDir } = await installer.begin('repositories', 'acme', 'op1');
    await writeFiles(stagingDir, { 'course_manifest.json': '{}', 'c/x': '1' });
    const source = installer.stagingSource('op1');
    expect((await source.list('')).map(({ name }) => name)).toEqual(['acme']);
    expect(await source.readText('acme/course_manifest.json')).toBe('{}');
  });

  it('remove deletes the snapshot and tolerates a missing one', async () => {
    const { installer } = await setup();
    const { stagingDir } = await installer.begin('repositories', 'acme', 'op1');
    await writeFiles(stagingDir, { 'v.txt': 'x' });
    await installer.install('repositories', 'acme', 'op1');
    await installer.remove('repositories', 'acme');
    expect(await installer.exists('repositories', 'acme')).toBe(false);
    await expect(
      installer.remove('repositories', 'acme'),
    ).resolves.toBeUndefined();
  });

  it('rejects ids and operation ids that could escape the library', async () => {
    const { installer } = await setup();
    for (const bad of ['', '..', '.', 'a/b', '../x', 'A', 'a b']) {
      await expect(installer.begin('repositories', bad, 'op1')).rejects.toThrow(
        'Unsafe',
      );
      await expect(installer.begin('repositories', 'ok', bad)).rejects.toThrow(
        'Unsafe',
      );
      await expect(installer.exists('repositories', bad)).rejects.toThrow(
        'Unsafe',
      );
      await expect(installer.remove('repositories', bad)).rejects.toThrow(
        'Unsafe',
      );
      expect(() => installer.snapshotPath('repositories', bad)).toThrow(
        'Unsafe',
      );
      expect(() => installer.stagingSource(bad)).toThrow('Unsafe');
    }
    await expect(
      installer.install('repositories', 'ok', '../x'),
    ).rejects.toThrow('Unsafe');
    await expect(installer.finish('../x')).rejects.toThrow('Unsafe');
  });

  it('recover clears leftovers, lists snapshot dirs and finishes an interrupted swap', async () => {
    const { installer, libraryRoot, dataDir } = await setup();
    await writeFiles(libraryRoot, {
      '.staging/op1/a.txt': 'partial',
      'repositories/kept/v.txt': 'kept',
      // подмена прервана между двумя rename: снимка на месте нет, старый в .trash
      '.trash/repositories/op2/lost/v.txt': 'old',
      // подмена завершена, .trash не успели убрать: на месте новый снимок
      'repositories/swapped/v.txt': 'new',
      '.trash/repositories/op3/swapped/v.txt': 'old',
    });
    await writeFiles(dataDir, { 'git-tmp/op1/pack': 'x' });

    expect(await installer.recover()).toEqual({
      repositories: ['kept', 'lost', 'swapped'],
      imported: [],
    });
    expect(
      await readFile(join(libraryRoot, 'repositories/lost/v.txt'), 'utf8'),
    ).toBe('old');
    expect(
      await readFile(join(libraryRoot, 'repositories/swapped/v.txt'), 'utf8'),
    ).toBe('new');
    for (const path of [
      join(libraryRoot, '.staging'),
      join(libraryRoot, '.trash'),
      join(dataDir, 'git-tmp'),
    ]) {
      expect(await exists(path)).toBe(false);
    }
  });

  it('recover on a fresh profile returns no snapshots', async () => {
    const { installer } = await setup();
    expect(await installer.recover()).toEqual({
      repositories: [],
      imported: [],
    });
  });

  it('the imported root swaps, rolls back and recovers independently of repositories', async () => {
    const { installer, libraryRoot } = await setup();
    expect(installer.snapshotPath('imported', 'acme-csv')).toBe(
      'imported/acme-csv',
    );
    const first = await installer.begin('imported', 'acme-csv', 'op1');
    await writeFiles(first.stagingDir, { 'v.txt': 'old' });
    await installer.install('imported', 'acme-csv', 'op1');
    await installer.finish('op1');
    expect(await installer.exists('imported', 'acme-csv')).toBe(true);
    expect(await installer.exists('repositories', 'acme-csv')).toBe(false);

    const second = await installer.begin('imported', 'acme-csv', 'op2');
    await writeFiles(second.stagingDir, { 'v.txt': 'new' });
    await installer.install('imported', 'acme-csv', 'op2');
    const target = join(libraryRoot, 'imported/acme-csv/v.txt');
    expect(await readFile(target, 'utf8')).toBe('new');
    await installer.rollback('imported', 'acme-csv', 'op2');
    expect(await readFile(target, 'utf8')).toBe('old');
    await installer.finish('op2');

    // прерванная подмена: прежний каталог в корзине корня `imported`, возвращается именно туда
    await writeFiles(libraryRoot, {
      '.trash/imported/op3/lost/v.txt': 'trashed',
      'repositories/kept/v.txt': 'kept',
    });
    expect(await installer.recover()).toEqual({
      repositories: ['kept'],
      imported: ['acme-csv', 'lost'],
    });
    expect(
      await readFile(join(libraryRoot, 'imported/lost/v.txt'), 'utf8'),
    ).toBe('trashed');
  });

  it('writeStaging writes nested files into the staging directory of the operation', async () => {
    const { installer, libraryRoot } = await setup();
    await installer.begin('imported', 'acme-csv', 'op1');
    await installer.writeStaging('acme-csv', 'op1', {
      'course_manifest.json': '{}',
      'lessons/one/lesson.md': 'тело',
    });
    const staging = join(libraryRoot, '.staging/op1/acme-csv');
    expect(await readFile(join(staging, 'course_manifest.json'), 'utf8')).toBe(
      '{}',
    );
    expect(await readFile(join(staging, 'lessons/one/lesson.md'), 'utf8')).toBe(
      'тело',
    );
  });

  it('writeStaging refuses paths that leave the directory or collide, writing nothing', async () => {
    const { installer, libraryRoot } = await setup();
    await installer.begin('imported', 'acme-csv', 'op1');
    for (const path of [
      '../x',
      'a/../../x',
      '/abs',
      '',
      '.git/config',
      'a//b',
      'a\\b',
      'a\u0000b',
    ]) {
      await expect(
        installer.writeStaging('acme-csv', 'op1', { ok: '1', [path]: 'x' }),
      ).rejects.toThrow('Unsafe file path');
    }
    await expect(
      installer.writeStaging('acme-csv', 'op1', { 'A.md': '1', 'a.md': '2' }),
    ).rejects.toThrow('Duplicate file path');
    expect(await readdir(join(libraryRoot, '.staging/op1/acme-csv'))).toEqual(
      [],
    );
    expect(await exists(join(libraryRoot, '.staging/op1/x'))).toBe(false);
  });
});
