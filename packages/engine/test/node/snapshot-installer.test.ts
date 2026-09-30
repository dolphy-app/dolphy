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
    const dirs = await installer.begin('op1');
    expect(dirs).toEqual({
      stagingDir: join(libraryRoot, '.staging', 'op1'),
      tmpDir: join(dataDir, 'git-tmp', 'op1'),
    });
    expect(await readdir(dirs.stagingDir)).toEqual([]);
    expect(await readdir(dirs.tmpDir)).toEqual([]);
    expect(installer.snapshotPath('acme-sql')).toBe('repositories/acme-sql');
  });

  it('install puts the staging tree under repositories/<id>; finish removes the operation dirs', async () => {
    const { installer, libraryRoot, dataDir } = await setup();
    const { stagingDir } = await installer.begin('op1');
    await writeFiles(stagingDir, { 'course/a.txt': 'one' });
    expect(await installer.exists('acme')).toBe(false);
    await installer.install('acme', 'op1');
    expect(await installer.exists('acme')).toBe(true);
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
    const first = await installer.begin('op1');
    await writeFiles(first.stagingDir, { 'v.txt': 'old' });
    await installer.install('acme', 'op1');
    await installer.finish('op1');

    const second = await installer.begin('op2');
    await writeFiles(second.stagingDir, { 'v.txt': 'new' });
    await installer.install('acme', 'op2');
    const target = join(libraryRoot, 'repositories/acme/v.txt');
    expect(await readFile(target, 'utf8')).toBe('new');
    expect(
      await readFile(join(libraryRoot, '.trash/op2/acme/v.txt'), 'utf8'),
    ).toBe('old');

    await installer.rollback('acme', 'op2');
    expect(await readFile(target, 'utf8')).toBe('old');
    await installer.finish('op2');
    expect(await exists(join(libraryRoot, '.trash', 'op2'))).toBe(false);
  });

  it('rollback of a first install leaves no snapshot', async () => {
    const { installer } = await setup();
    const { stagingDir } = await installer.begin('op1');
    await writeFiles(stagingDir, { 'v.txt': 'new' });
    await installer.install('acme', 'op1');
    await installer.rollback('acme', 'op1');
    expect(await installer.exists('acme')).toBe(false);
  });

  it('stagingSource reads the operation dir as a course source', async () => {
    const { installer } = await setup();
    const { stagingDir } = await installer.begin('op1');
    await writeFiles(stagingDir, { 'c/course_manifest.json': '{}' });
    const source = installer.stagingSource('op1');
    expect((await source.list('')).map(({ name }) => name)).toEqual(['c']);
    expect(await source.readText('c/course_manifest.json')).toBe('{}');
  });

  it('remove deletes the snapshot and tolerates a missing one', async () => {
    const { installer } = await setup();
    const { stagingDir } = await installer.begin('op1');
    await writeFiles(stagingDir, { 'v.txt': 'x' });
    await installer.install('acme', 'op1');
    await installer.remove('acme');
    expect(await installer.exists('acme')).toBe(false);
    await expect(installer.remove('acme')).resolves.toBeUndefined();
  });

  it('rejects ids and operation ids that could escape the library', async () => {
    const { installer } = await setup();
    for (const bad of ['', '..', '.', 'a/b', '../x', 'A', 'a b']) {
      await expect(installer.begin(bad)).rejects.toThrow('Unsafe');
      await expect(installer.exists(bad)).rejects.toThrow('Unsafe');
      await expect(installer.remove(bad)).rejects.toThrow('Unsafe');
      expect(() => installer.snapshotPath(bad)).toThrow('Unsafe');
      expect(() => installer.stagingSource(bad)).toThrow('Unsafe');
    }
    await expect(installer.install('ok', '../x')).rejects.toThrow('Unsafe');
    await expect(installer.finish('../x')).rejects.toThrow('Unsafe');
  });

  it('recover clears leftovers, lists snapshot dirs and finishes an interrupted swap', async () => {
    const { installer, libraryRoot, dataDir } = await setup();
    await writeFiles(libraryRoot, {
      '.staging/op1/a.txt': 'partial',
      'repositories/kept/v.txt': 'kept',
      // подмена прервана между двумя rename: снимка на месте нет, старый в .trash
      '.trash/op2/lost/v.txt': 'old',
      // подмена завершена, .trash не успели убрать: на месте новый снимок
      'repositories/swapped/v.txt': 'new',
      '.trash/op3/swapped/v.txt': 'old',
    });
    await writeFiles(dataDir, { 'git-tmp/op1/pack': 'x' });

    expect(await installer.recover()).toEqual(['kept', 'lost', 'swapped']);
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
    expect(await installer.recover()).toEqual([]);
  });
});
