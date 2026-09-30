import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDirectorySwap } from '../../src/node/index.ts';
import { useTmpDirs } from '../helpers/tmp.ts';

const tmp = useTmpDirs();

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const setup = async () => {
  const root = await tmp.make();
  const targetRoot = join(root, 'ext');
  const stagingRoot = join(targetRoot, '.staging');
  const trashRoot = join(targetRoot, '.trash');
  const swap = createDirectorySwap({ targetRoot, stagingRoot, trashRoot });
  const put = async (dir: string, content: string) => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'f.txt'), content);
  };
  const read = (dir: string) => readFile(join(dir, 'f.txt'), 'utf8');
  return { swap, put, read, targetRoot, stagingRoot, trashRoot };
};

describe('createDirectorySwap', () => {
  it('replaces an existing directory and keeps the old one in trash until discard', async () => {
    const { swap, put, read, trashRoot } = await setup();
    await put(swap.targetDir('a'), 'old');
    await put(swap.stagingDir('a', 'op1'), 'new');

    await swap.install('a', 'op1');

    expect(await read(swap.targetDir('a'))).toBe('new');
    expect(await read(join(trashRoot, 'op1', 'a'))).toBe('old');
    await swap.discard('op1');
    expect(await exists(join(trashRoot, 'op1'))).toBe(false);
    expect(await exists(swap.stagingDir('a', 'op1'))).toBe(false);
  });

  it('installs without a previous directory and rollback removes it', async () => {
    const { swap, put, read } = await setup();
    await put(swap.stagingDir('a', 'op1'), 'new');

    await swap.install('a', 'op1');
    expect(await read(swap.targetDir('a'))).toBe('new');
    expect(await swap.exists('a')).toBe(true);

    await swap.rollback('a', 'op1');
    expect(await swap.exists('a')).toBe(false);
  });

  it('rollback puts the previous directory back', async () => {
    const { swap, put, read } = await setup();
    await put(swap.targetDir('a'), 'old');
    await put(swap.stagingDir('a', 'op1'), 'new');
    await swap.install('a', 'op1');

    await swap.rollback('a', 'op1');

    expect(await read(swap.targetDir('a'))).toBe('old');
  });

  it('restores the old directory when the second rename fails', async () => {
    const { swap, put, read } = await setup();
    await put(swap.targetDir('a'), 'old');
    // staging отсутствует: второй rename упадёт

    await expect(swap.install('a', 'op1')).rejects.toThrow();

    expect(await read(swap.targetDir('a'))).toBe('old');
  });

  it('recover restores the trashed directory after a crash between renames', async () => {
    const { swap, put, read, stagingRoot, trashRoot } = await setup();
    await put(join(trashRoot, 'op1', 'a'), 'old');
    await put(swap.stagingDir('a', 'op1'), 'new');
    expect(await swap.exists('a')).toBe(false);

    await swap.recover();

    expect(await read(swap.targetDir('a'))).toBe('old');
    expect(await exists(stagingRoot)).toBe(false);
    expect(await exists(trashRoot)).toBe(false);
  });

  it('recover drops the trash when the target exists', async () => {
    const { swap, put, read, trashRoot } = await setup();
    await put(swap.targetDir('a'), 'new');
    await put(join(trashRoot, 'op1', 'a'), 'old');

    await swap.recover();

    expect(await read(swap.targetDir('a'))).toBe('new');
    expect(await exists(trashRoot)).toBe(false);
  });

  it('rejects unsafe names and operation ids', async () => {
    const { swap } = await setup();
    expect(() => swap.targetDir('..')).toThrow(/Unsafe/);
    expect(() => swap.targetDir('a/b')).toThrow(/Unsafe/);
    expect(() => swap.stagingDir('a', '.')).toThrow(/Unsafe/);
    await expect(swap.discard('../x')).rejects.toThrow(/Unsafe/);
  });
});
