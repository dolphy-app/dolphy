import { describe, expect, it } from 'vitest';
import {
  EXTENSION_TRANSFER_LIMITS,
  type BytesImportInput,
  type CourseExportInput,
  type TextImportInput,
  defineExtension,
  inActivate,
  type ExporterHandler,
  type ImporterHandler,
} from '../src/index.ts';
import {
  createMemoryStats,
  loadExporters,
  loadImporters,
} from '../src/testing.ts';

const MIB = 1024 * 1024;

const importersOf = (importers: Record<string, ImporterHandler>) =>
  defineExtension({ importers });

const exportersOf = (exporters: Record<string, ExporterHandler>) =>
  defineExtension({ exporters });

describe('loadImporters', () => {
  it('runs the importer with the text input and returns the files', async () => {
    const loaded = await loadImporters(
      importersOf({
        'a.csv': ({ name, text }: TextImportInput) => ({
          files: { 'course.yaml': `id: ${name}`, 'rows.csv': text },
        }),
      }),
    );

    expect(loaded.ids()).toEqual(['a.csv']);
    expect(await loaded.run('a.csv', { name: 'x.csv', text: 'a;b' })).toEqual({
      files: { 'course.yaml': 'id: x.csv', 'rows.csv': 'a;b' },
    });
  });

  it('hands the bytes of a bytes importer over as a Uint8Array', async () => {
    const loaded = await loadImporters(
      importersOf({
        'a.bin': ({ bytes }: BytesImportInput) => ({
          files: {
            'size.txt':
              bytes instanceof Uint8Array ? String(bytes.length) : 'not bytes',
          },
        }),
      }),
      { declaredImporters: [{ id: 'a.bin', input: 'bytes' }] },
    );

    expect(
      await loaded.run('a.bin', { name: 'x', bytes: Uint8Array.of(1, 2, 3) }),
    ).toEqual({ files: { 'size.txt': '3' } });
  });

  it('refuses the wrong input form for a declared importer, as the host does', async () => {
    const loaded = await loadImporters(
      importersOf({
        'a.csv': () => ({ files: {} }),
        'a.bin': () => ({ files: {} }),
      }),
      {
        declaredImporters: [{ id: 'a.csv' }, { id: 'a.bin', input: 'bytes' }],
      },
    );

    await expect(
      loaded.run('a.csv', { name: 'x', bytes: Uint8Array.of(1) }),
    ).rejects.toThrow("importer 'a.csv' takes text input");
    await expect(loaded.run('a.bin', { name: 'x', text: '' })).rejects.toThrow(
      "importer 'a.bin' takes bytes input",
    );
  });

  it('refuses a file over the limit and an unregistered importer', async () => {
    const loaded = await loadImporters(
      importersOf({ 'a.csv': () => ({ files: {} }) }),
    );

    await expect(
      loaded.run('a.csv', {
        name: 'x',
        bytes: new Uint8Array(EXTENSION_TRANSFER_LIMITS.inputBytes + 1),
      }),
    ).rejects.toThrow('longer than');
    await expect(
      loaded.run('a.other', { name: 'x', text: '' }),
    ).rejects.toThrow("importer 'a.other' was not registered");
  });

  it.each([
    ['a path with ..', { files: { '../x': '1' } }, 'starts with a dot'],
    ['a hidden directory', { files: { '.git/x': '1' } }, 'starts with a dot'],
    [
      'names that differ in case',
      { files: { 'A.md': '1', 'a.md': '2' } },
      'differ only in case',
    ],
    [
      '5001 files',
      {
        files: Object.fromEntries(
          Array.from({ length: 5001 }, (_, i) => [`f${i}`, '']),
        ),
      },
      'more than 5000',
    ],
    [
      'a file of 2 MiB + 1',
      { files: { a: 'x'.repeat(2 * MIB + 1) } },
      'longer than',
    ],
    ['text instead of an object', 'files', 'must be an object'],
  ])('rejects %s with the host message', async (_name, result, message) => {
    const loaded = await loadImporters(
      importersOf({ 'a.csv': () => result as never }),
    );

    const failure = await loaded
      .run('a.csv', { name: 'x', text: '' })
      .catch((error: unknown) => error as Error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/^invalid import result: /);
    expect((failure as Error).message).toContain(message);
  });

  it('accepts the boundary: 5000 files and a 2 MiB file', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 5000 }, (_, i) => [`f${i}`, '']),
    );
    const loaded = await loadImporters(
      importersOf({
        'a.csv': () => ({ files }),
        'a.big': () => ({ files: { a: 'x'.repeat(2 * MIB) } }),
      }),
    );

    expect(
      Object.keys((await loaded.run('a.csv', { name: 'x', text: '' })).files),
    ).toHaveLength(5000);
    expect(
      (await loaded.run('a.big', { name: 'x', text: '' })).files['a']?.length,
    ).toBe(2 * MIB);
  });

  it('refuses an importer the manifest does not declare and a repeated registration', async () => {
    await expect(
      loadImporters(importersOf({ 'a.ghost': () => ({ files: {} }) }), {
        declaredImporters: [{ id: 'a.csv' }],
      }),
    ).rejects.toThrow("importer 'a.ghost' is not declared in the manifest");
    await expect(
      loadImporters(
        defineExtension({
          importers: { 'a.csv': () => ({ files: {} }) },
          activate(ctx) {
            ctx.importers.register('a.csv', () => ({ files: {} }));
          },
        }),
      ),
    ).rejects.toThrow("importer 'a.csv' is already registered");
  });

  it('dispose deactivates the module', async () => {
    let deactivated = false;
    const loaded = await loadImporters(
      defineExtension({
        importers: { 'a.csv': () => ({ files: {} }) },
        deactivate: () => {
          deactivated = true;
        },
      }),
    );

    await loaded.dispose();

    expect(deactivated).toBe(true);
    expect(loaded.ids()).toEqual([]);
  });
});

describe('loadExporters', () => {
  const course = {
    scope: 'course',
    courseId: 'c1',
    title: 'Course',
    files: { 'course.yaml': 'id: c1' },
  } as const;

  it('runs a course exporter on the snapshot', async () => {
    const loaded = await loadExporters(
      exportersOf({
        'a.json': (input: CourseExportInput) => ({
          filename: 'course.json',
          text: JSON.stringify(input),
        }),
      }),
      { declaredExporters: [{ id: 'a.json', scope: 'course' }] },
    );

    expect(await loaded.run('a.json', course)).toEqual({
      filename: 'course.json',
      text: JSON.stringify(course),
    });
  });

  it('runs a progress exporter against the stats of the test', async () => {
    const loaded = await loadExporters(
      defineExtension({
        exporters: { 'a.progress': inActivate },
        activate(ctx) {
          ctx.exporters.register('a.progress', async () => {
            const { current } = await ctx.stats.streak();
            return { filename: 'p.txt', text: `streak ${current}` };
          });
        },
      }),
      {
        stats: createMemoryStats({
          attempts: [{ at: new Date(2026, 0, 1, 12), grade: 5 }],
          now: () => new Date(2026, 0, 1, 18).getTime(),
        }),
      },
    );

    expect(await loaded.run('a.progress', { scope: 'progress' })).toEqual({
      filename: 'p.txt',
      text: 'streak 1',
    });
  });

  it('returns bytes as they are', async () => {
    const loaded = await loadExporters(
      exportersOf({
        'a.bin': () => ({ filename: 'a.bin', bytes: Uint8Array.of(0, 255) }),
      }),
    );

    expect(await loaded.run('a.bin', { scope: 'progress' })).toEqual({
      filename: 'a.bin',
      bytes: Uint8Array.of(0, 255),
    });
  });

  it('refuses the wrong scope for a declared exporter and an oversized snapshot', async () => {
    const loaded = await loadExporters(
      exportersOf({ 'a.json': () => ({ filename: 'a', text: '' }) }),
      { declaredExporters: [{ id: 'a.json', scope: 'course' }] },
    );

    await expect(loaded.run('a.json', { scope: 'progress' })).rejects.toThrow(
      "exporter 'a.json' takes the course scope",
    );
    await expect(
      loaded.run('a.json', {
        ...course,
        files: Object.fromEntries(
          Array.from({ length: 11 }, (_, i) => [`${i}`, 'x'.repeat(2 * MIB)]),
        ),
      }),
    ).rejects.toThrow('course files are longer than');
  });

  it.each([
    ['a name with a separator', { filename: 'a/b', text: '' }],
    ['a name of 121 characters', { filename: 'a'.repeat(121), text: '' }],
    [
      'text and bytes together',
      { filename: 'a', text: '', bytes: Uint8Array.of() },
    ],
    ['neither text nor bytes', { filename: 'a' }],
    ['a 20 MiB + 1 text', { filename: 'a', text: 'x'.repeat(20 * MIB + 1) }],
  ])('rejects %s with the host message', async (_name, result) => {
    const loaded = await loadExporters(
      exportersOf({ 'a.out': () => result as never }),
    );

    await expect(loaded.run('a.out', { scope: 'progress' })).rejects.toThrow(
      /^invalid export result: /,
    );
  });
});
