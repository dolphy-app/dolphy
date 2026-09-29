import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeFolderSyncPort } from '../../src/node/folder-sync-port.ts';
import { useTmpDirs } from '../helpers/tmp.ts';

const tmp = useTmpDirs();

const setup = async () => {
  const root = await tmp.make();
  const dataDir = join(root, 'data');
  const shared = join(root, 'shared');
  await mkdir(dataDir);
  await mkdir(shared);
  const warnings: object[] = [];
  const logger = {
    debug: () => {},
    info: () => {},
    warn: (fields: object) => warnings.push(fields),
    error: () => {},
  };
  return {
    root,
    dataDir,
    shared,
    warnings,
    port: createNodeFolderSyncPort({ dataDir }, { logger }),
  };
};

const reasonOf = async (promise: Promise<unknown>) => {
  const error = (await promise.then(
    () => null,
    (caught: unknown) => caught,
  )) as { code?: string; details?: { reason?: string } } | null;
  expect(error?.code).toBe('INVALID_ARGUMENT');
  return error?.details?.reason;
};

describe('createNodeFolderSyncPort', () => {
  it('round-trips the folder and leaves no temp files', async () => {
    const { port, shared, dataDir } = await setup();
    expect(await port.load()).toBeNull();
    await port.save(shared);
    expect(await port.load()).toBe(shared);
    expect(
      JSON.parse(await readFile(join(dataDir, 'settings/sync.json'), 'utf8')),
    ).toEqual({ dir: shared });
    expect(await readdir(join(dataDir, 'settings'))).toEqual(['sync.json']);
  });

  it('rejects missing paths and files', async () => {
    const { port, root } = await setup();
    expect(await reasonOf(port.save(join(root, 'nope')))).toBe('not-found');
    const file = join(root, 'file.txt');
    await writeFile(file, 'x');
    expect(await reasonOf(port.save(file))).toBe('not-a-directory');
    expect(await port.load()).toBeNull();
  });

  it('rejects dataDir, its subdirectories and symlinks to them', async () => {
    const { port, dataDir, root } = await setup();
    expect(await reasonOf(port.save(dataDir))).toBe('is-data-dir');
    const inner = join(dataDir, 'inner');
    await mkdir(inner);
    expect(await reasonOf(port.save(inner))).toBe('inside-data-dir');
    const link = join(root, 'link');
    await symlink(dataDir, link);
    expect(await reasonOf(port.save(link))).toBe('is-data-dir');
  });

  it('keeps the previous folder when a save is rejected', async () => {
    const { port, shared, dataDir } = await setup();
    await port.save(shared);
    await reasonOf(port.save(dataDir));
    expect(await port.load()).toBe(shared);
  });

  it('ignores a corrupt sync.json and logs it', async () => {
    const { port, dataDir, warnings } = await setup();
    await mkdir(join(dataDir, 'settings'));
    await writeFile(join(dataDir, 'settings/sync.json'), '{oops');
    expect(await port.load()).toBeNull();
    expect(warnings).toHaveLength(1);
    await writeFile(join(dataDir, 'settings/sync.json'), '{"dir":5}');
    expect(await port.load()).toBeNull();
  });
});
