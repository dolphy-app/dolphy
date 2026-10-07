import { describe, expect, it } from 'vitest';
import {
  EXTENSION_TRANSFER_LIMITS,
  defineServer,
  type BytesImportInput,
  type CourseExportInput,
  type ExporterHandler,
  type ImporterHandler,
  type ImporterInputKind,
  type ExporterScope,
  type TextImportInput,
} from '../src/index.ts';
import { createMemoryStats, createTestServer } from '../src/testing.ts';

const MIB = 1024 * 1024;

const importerOf = (
  run: ImporterHandler,
  input: ImporterInputKind = 'text',
  id = 'a.csv',
) =>
  createTestServer(
    defineServer((s) => {
      s.registerImporter({ id, title: id, accept: ['.csv'], input, run });
    }),
  );

const exporterOf = (
  run: ExporterHandler,
  scope: ExporterScope = 'progress',
  id = 'a.out',
) =>
  createTestServer(
    defineServer((s) => {
      s.registerExporter({ id, title: id, scope, run });
    }),
  );

describe('createTestServer: importers', () => {
  it('runs the importer with the text input and returns the files', async () => {
    const server = await importerOf((input) => {
      const { name, text } = input as TextImportInput;
      return { files: { 'course.yaml': `id: ${name}`, 'rows.csv': text } };
    });

    expect(
      await server.importer('a.csv').run({ name: 'x.csv', text: 'a;b' }),
    ).toEqual({ files: { 'course.yaml': 'id: x.csv', 'rows.csv': 'a;b' } });
  });

  it('hands the bytes of a bytes importer over as a Uint8Array', async () => {
    const server = await importerOf(
      (input) => {
        const { bytes } = input as BytesImportInput;
        return {
          files: {
            'size.txt':
              bytes instanceof Uint8Array ? String(bytes.length) : 'not bytes',
          },
        };
      },
      'bytes',
      'a.bin',
    );

    expect(
      await server
        .importer('a.bin')
        .run({ name: 'x', bytes: Uint8Array.of(1, 2, 3) }),
    ).toEqual({ files: { 'size.txt': '3' } });
  });

  it('refuses the wrong input form, as the host does', async () => {
    const text = await importerOf(() => ({ files: {} }));
    const bytes = await importerOf(() => ({ files: {} }), 'bytes', 'a.bin');

    await expect(
      text.importer('a.csv').run({ name: 'x', bytes: Uint8Array.of(1) }),
    ).rejects.toThrow("importer 'a.csv' takes text input");
    await expect(
      bytes.importer('a.bin').run({ name: 'x', text: '' }),
    ).rejects.toThrow("importer 'a.bin' takes bytes input");
  });

  it('refuses a file over the limit and an unregistered importer', async () => {
    const server = await importerOf(
      (input) => ({ files: { 'a.bin': String('bytes' in input) } }),
      'bytes',
    );

    await expect(
      server.importer('a.csv').run({
        name: 'x',
        bytes: new Uint8Array(EXTENSION_TRANSFER_LIMITS.inputBytes + 1),
      }),
    ).rejects.toThrow('longer than');
    expect(() => server.importer('a.other')).toThrow(
      "importer 'a.other' was not registered",
    );
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
    const server = await importerOf(() => result as never);

    const failure = await server
      .importer('a.csv')
      .run({ name: 'x', text: '' })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/^invalid import result: /);
    expect((failure as Error).message).toContain(message);
  });

  it('accepts the boundary: 5000 files and a 2 MiB file', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 5000 }, (_, i) => [`f${i}`, '']),
    );
    const many = await importerOf(() => ({ files }));
    const big = await importerOf(() => ({ files: { a: 'x'.repeat(2 * MIB) } }));

    expect(
      Object.keys(
        (await many.importer('a.csv').run({ name: 'x', text: '' })).files,
      ),
    ).toHaveLength(5000);
    expect(
      (await big.importer('a.csv').run({ name: 'x', text: '' })).files['a']
        ?.length,
    ).toBe(2 * MIB);
  });

  it('the snapshot lists the importer with its accepted extensions and input', async () => {
    const server = await importerOf(() => ({ files: {} }), 'bytes');
    expect(server.registration.importers).toEqual([
      { id: 'a.csv', title: 'a.csv', accept: ['.csv'], input: 'bytes' },
    ]);
  });
});

describe('createTestServer: exporters', () => {
  const course = {
    scope: 'course',
    courseId: 'c1',
    title: 'Course',
    files: { 'course.yaml': 'id: c1' },
  } as const;

  it('runs a course exporter on the snapshot', async () => {
    const server = await exporterOf(
      (input) => ({
        filename: 'course.json',
        text: JSON.stringify(input as CourseExportInput),
      }),
      'course',
    );

    expect(await server.exporter('a.out').run(course)).toEqual({
      filename: 'course.json',
      text: JSON.stringify(course),
    });
  });

  it('runs a progress exporter against the stats of the test', async () => {
    const stats = createMemoryStats({
      attempts: [{ at: new Date(2026, 0, 1, 12), grade: 5 }],
      now: () => new Date(2026, 0, 1, 18).getTime(),
    });
    const server = await createTestServer(
      defineServer((s) => {
        s.registerExporter({
          id: 'a.progress',
          title: 'Progress',
          scope: 'progress',
          run: async () => {
            const { current } = await s.stats.streak();
            return { filename: 'p.txt', text: `streak ${current}` };
          },
        });
      }),
      { stats },
    );

    expect(
      await server.exporter('a.progress').run({ scope: 'progress' }),
    ).toEqual({ filename: 'p.txt', text: 'streak 1' });
  });

  it('returns bytes as they are', async () => {
    const server = await exporterOf(() => ({
      filename: 'a.bin',
      bytes: Uint8Array.of(0, 255),
    }));

    expect(await server.exporter('a.out').run({ scope: 'progress' })).toEqual({
      filename: 'a.bin',
      bytes: Uint8Array.of(0, 255),
    });
  });

  it('refuses the wrong scope and an oversized snapshot', async () => {
    const server = await exporterOf(
      () => ({ filename: 'a', text: '' }),
      'course',
    );

    await expect(
      server.exporter('a.out').run({ scope: 'progress' }),
    ).rejects.toThrow("exporter 'a.out' takes the course scope");
    await expect(
      server.exporter('a.out').run({
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
    const server = await exporterOf(() => result as never);

    await expect(
      server.exporter('a.out').run({ scope: 'progress' }),
    ).rejects.toThrow(/^invalid export result: /);
  });
});
