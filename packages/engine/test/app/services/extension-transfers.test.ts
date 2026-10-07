import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_EXTENSION_TRANSFER_BYTES } from '@dolphy-app/engine-contract';
import type {
  ExporterContributionDto,
  ExtensionInfoDto,
  ImporterContributionDto,
} from '@dolphy-app/engine-contract';
import {
  buildLibrary,
  createFakeExtensionRegistry,
  createFakeExtensionTransfers,
  renderLibrary,
} from '@dolphy-app/testkit';
import type { CourseLibrary } from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import {
  EngineError,
  MAX_PENDING_IMPORTS,
  PENDING_IMPORT_TTL_MS,
} from '../../../src/app/index.ts';
import { createNodeFsCourseSource } from '../../../src/node/index.ts';
import { ExtensionTransferError } from '../../../src/ports/extension-transfers.ts';
import type {
  TransferExportInput,
  TransferImportInput,
} from '../../../src/ports/extension-transfers.ts';
import { createTestEngine } from '../../helpers/engine.ts';
import { useTmpDirs, writeFiles } from '../../helpers/tmp.ts';

const tmp = useTmpDirs();

const ID = 'acme.csv';
const IMPORTER = `${ID}.import`;
const BYTES_IMPORTER = `${ID}.import-bytes`;
const EXPORTER = `${ID}.export`;
const PROGRESS_EXPORTER = `${ID}.progress`;

const info = (): ExtensionInfoDto => ({
  id: ID,
  version: '1.0.0',
  origin: 'user',
  state: 'loaded',
  contributes: {
    exerciseTypes: [],
    themes: [],
    markdownRenderers: [],
    gradePolicies: [],
    settings: [],
    events: [],
    commands: [],
    widgets: [],
    schedules: [],
    panels: [],
    importers: [IMPORTER, BYTES_IMPORTER],
    exporters: [EXPORTER, PROGRESS_EXPORTER],
  },
  diagnostics: [],
  toggleable: true,
  name: null,
  description: null,
  author: null,
  dependencies: [],
  installed: null,
  icon: null,
  titles: {},
  messages: {},
  tags: [],
  removable: true,
  revoked: null,
  deprecated: null,
});

const importer = (
  id: string,
  input: 'text' | 'bytes',
): ImporterContributionDto => ({
  id,
  extensionId: ID,
  title: id,
  accept: ['.csv'],
  input,
});

const exporter = (
  id: string,
  scope: 'course' | 'progress',
): ExporterContributionDto => ({ id, extensionId: ID, title: id, scope });

const course = (id: string, lessons = 1): CourseLibrary =>
  buildLibrary({
    courses: [
      {
        id,
        lessons: Array.from({ length: lessons }, (_, i) => ({
          id: `l${i}`,
          exercises: 2,
        })),
      },
    ],
  });

const filesOf = (library: CourseLibrary): Record<string, string> =>
  Object.fromEntries(renderLibrary(library));

/** Каталоги библиотеки без служебных (`.engine`, `.staging`, `.trash`). */
const visible = async (libraryRoot: string) =>
  (await readdir(libraryRoot)).filter((name) => !name.startsWith('.'));

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

interface Handlers {
  importer?: (input: TransferImportInput) => Record<string, string>;
  exporter?: (input: TransferExportInput) => {
    filename: string;
    text: string;
  };
}

/** Библиотека на диске с курсом `base`; поверх — настоящий движок и порт импорта со скриптованными обработчиками. */
const open = async (handlers: Handlers = {}) => {
  const root = await tmp.make();
  const libraryRoot = join(root, 'library');
  const dataDir = join(root, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFiles(libraryRoot, filesOf(course('base')));
  const transfers = createFakeExtensionTransfers({
    importers: {
      [`${ID}/${IMPORTER}`]: (input) => ({
        files: handlers.importer?.(input) ?? filesOf(course('sheet')),
      }),
      [`${ID}/${BYTES_IMPORTER}`]: (input) => ({
        files: handlers.importer?.(input) ?? filesOf(course('sheet')),
      }),
    },
    exporters: {
      [`${ID}/${EXPORTER}`]: (input) =>
        handlers.exporter?.(input) ?? { filename: 'out.txt', text: 'ok' },
      [`${ID}/${PROGRESS_EXPORTER}`]: (input) =>
        handlers.exporter?.(input) ?? { filename: 'progress.csv', text: 'a,b' },
    },
  });
  const t = await createTestEngine({
    library: createNodeFsCourseSource(libraryRoot),
    config: { libraryRoot, dataDir },
    extensionTransfers: transfers,
    extensionRegistry: createFakeExtensionRegistry([info()], {
      exerciseTypes: [],
      themes: [],
      markdownRenderers: [],
      gradePolicies: [],
      settings: [],
      commands: [],
      widgets: [],
      schedules: [],
      panels: [],
      importers: [
        importer(IMPORTER, 'text'),
        importer(BYTES_IMPORTER, 'bytes'),
      ],
      exporters: [
        exporter(EXPORTER, 'course'),
        exporter(PROGRESS_EXPORTER, 'progress'),
      ],
      messages: {},
    }),
  });
  const courseIds = async () =>
    (await t.engine.library.listCourses()).items.map(({ id }) => id).sort();
  return { ...t, transfers, libraryRoot, dataDir, courseIds };
};

const failure = async (promise: Promise<unknown>): Promise<EngineError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EngineError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
};

const FILE = { name: 'My Sheet.csv', text: 'a,b\n1,2' };

describe('extensions.runImporter', () => {
  it('checks the tree with the course compiler and leaves the library untouched until commit', async () => {
    const t = await open();
    const preview = await t.engine.extensions.runImporter(ID, IMPORTER, FILE);
    expect(preview).toMatchObject({
      extensionId: ID,
      importerId: IMPORTER,
      path: 'imported/acme.csv-my-sheet',
      replaces: false,
      counts: { courses: 1, lessons: 1, exercises: 2 },
      summary: { errors: 0 },
      diagnostics: [],
    });
    expect(preview.importId).toEqual(expect.any(String));
    expect(preview.files).toBeGreaterThan(3);
    expect(t.transfers.calls).toEqual([
      { kind: 'import', extensionId: ID, id: IMPORTER, input: FILE },
    ]);
    expect(await t.courseIds()).toEqual(['base']);
    expect(await exists(join(t.libraryRoot, 'imported'))).toBe(false);
  });

  it('hands bytes to a bytes importer and refuses a text file for it', async () => {
    const t = await open();
    const bytes = new Uint8Array([1, 2, 3]);
    await t.engine.extensions.runImporter(ID, BYTES_IMPORTER, {
      name: 'x.csv',
      bytes,
    });
    expect(t.transfers.calls[0]).toMatchObject({ input: { bytes } });
    const wrong = await failure(
      t.engine.extensions.runImporter(ID, BYTES_IMPORTER, FILE),
    );
    expect(wrong).toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { field: 'file', reason: 'input-kind' },
    });
    const wrongText = await failure(
      t.engine.extensions.runImporter(ID, IMPORTER, {
        name: 'x.csv',
        bytes,
      }),
    );
    expect(wrongText).toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(t.transfers.calls).toHaveLength(1);
  });

  it('reports errors with paths from the course directory and leaves nothing on disk', async () => {
    const t = await open({
      importer: () => ({
        ...filesOf(course('sheet')),
        'broken/course_manifest.json': '{ not json',
      }),
    });
    const preview = await t.engine.extensions.runImporter(ID, IMPORTER, FILE);
    expect(preview.importId).toBeNull();
    expect(preview.summary.errors).toBeGreaterThan(0);
    expect(preview.diagnostics[0]).toMatchObject({
      severity: 'error',
      path: 'broken/course_manifest.json',
    });
    expect(
      preview.diagnostics.every(({ path }) => !path?.startsWith('acme')),
    ).toBe(true);
    expect(await visible(t.libraryRoot)).toEqual(['base']);
    expect(await t.courseIds()).toEqual(['base']);
  });

  it('caps diagnostics at 50, errors before warnings, and counts them all in the summary', async () => {
    const files = filesOf(course('sheet'));
    for (let i = 0; i < 60; i++) {
      files[`bad${String(i).padStart(2, '0')}/course_manifest.json`] = '{';
    }
    files['warn/course_manifest.json'] = JSON.stringify({
      id: 'w',
      name: 'w',
      dependencies: [],
      encompassed: [],
      superseded: [],
      description: null,
      authors: null,
      metadata: null,
      course_material: null,
      course_instructions: null,
      generator_config: null,
      unknown: 1,
    });
    const t = await open({ importer: () => files });
    const preview = await t.engine.extensions.runImporter(ID, IMPORTER, FILE);
    expect(preview.diagnostics).toHaveLength(50);
    expect(preview.summary.errors).toBeGreaterThanOrEqual(60);
    expect(
      preview.diagnostics.every(({ severity }) => severity === 'error'),
    ).toBe(true);
  });

  it('treats a tree without courses as nothing to import', async () => {
    const t = await open({ importer: () => ({ 'notes.txt': 'hello' }) });
    const preview = await t.engine.extensions.runImporter(ID, IMPORTER, FILE);
    expect(preview).toMatchObject({
      importId: null,
      counts: { courses: 0, lessons: 0, exercises: 0 },
      diagnostics: [],
    });
    expect(await visible(t.libraryRoot)).toEqual(['base']);
  });

  it('names the directory in latin letters and says whether it replaces an earlier import', async () => {
    const t = await open();
    const first = await t.engine.extensions.runImporter(ID, IMPORTER, {
      name: 'Курс по SQL.csv',
      text: 'x',
    });
    expect(first).toMatchObject({
      path: 'imported/acme.csv-kurs-po-sql',
      replaces: false,
    });
    await t.engine.extensions.commitImport(first.importId as string);
    const again = await t.engine.extensions.runImporter(ID, IMPORTER, {
      name: 'Курс по SQL.csv',
      text: 'y',
    });
    expect(again).toMatchObject({
      path: 'imported/acme.csv-kurs-po-sql',
      replaces: true,
    });
  });

  it('refuses a file name with a path, an oversized file and unknown or disabled importers without calling the extension', async () => {
    const t = await open();
    const call = (id: string, file: Record<string, unknown>, ext = ID) =>
      failure(
        t.engine.extensions.runImporter(
          ext,
          id,
          file as unknown as Parameters<
            typeof t.engine.extensions.runImporter
          >[2],
        ),
      );
    expect(await call(IMPORTER, { name: '../x.csv', text: '' })).toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { field: 'file', reason: 'name' },
    });
    expect(await call(IMPORTER, { name: 'a/b.csv', text: '' })).toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    const big = await call(IMPORTER, {
      name: 'big.csv',
      text: 'a'.repeat(MAX_EXTENSION_TRANSFER_BYTES + 1),
    });
    expect(big).toMatchObject({
      code: 'EXTENSION_TRANSFER_FAILED',
      retryable: false,
      details: {
        extensionId: ID,
        id: IMPORTER,
        kind: 'import',
        reason: 'too-large',
      },
    });
    // 3 байта на знак: знаков меньше потолка, байт больше
    const wide = await call(IMPORTER, {
      name: 'wide.csv',
      text: '€'.repeat(MAX_EXTENSION_TRANSFER_BYTES / 3 + 1),
    });
    expect(wide).toMatchObject({ details: { reason: 'too-large' } });
    expect(
      await call('acme.csv.nope', { name: 'a.csv', text: '' }),
    ).toMatchObject({ details: { reason: 'unknown-importer' } });
    expect(
      await call(IMPORTER, { name: 'a.csv', text: '' }, 'other.ext'),
    ).toMatchObject({ details: { reason: 'unknown-importer' } });
    expect(t.transfers.calls).toEqual([]);
  });

  it('refuses a disabled extension', async () => {
    const t = await open();
    await t.engine.extensions.setEnabled(ID, false);
    const error = await failure(
      t.engine.extensions.runImporter(ID, IMPORTER, FILE),
    );
    expect(error).toMatchObject({
      code: 'EXTENSION_TRANSFER_FAILED',
      details: { reason: 'disabled', kind: 'import' },
    });
    expect(t.transfers.calls).toEqual([]);
  });

  it.each([
    ['handler-failed', false, 1],
    ['timeout', true, 1],
    ['invalid-result', false, 1],
    ['host-down', true, 0],
    ['replaced', false, 0],
  ] as const)(
    'maps the port failure %s (retryable %s, counted failures %s) and writes nothing',
    async (cause, retryable, failures) => {
      const t = await open({
        importer: () => {
          throw new ExtensionTransferError(
            cause,
            ID,
            IMPORTER,
            'import',
            `${cause} msg`,
          );
        },
      });
      const error = await failure(
        t.engine.extensions.runImporter(ID, IMPORTER, FILE),
      );
      expect(error).toMatchObject({
        code: 'EXTENSION_TRANSFER_FAILED',
        message: `${cause} msg`,
        retryable,
        details: {
          extensionId: ID,
          id: IMPORTER,
          kind: 'import',
          reason: cause,
        },
      });
      expect(t.deps.extensionHealth.get(ID).failures).toBe(failures);
      expect(await visible(t.libraryRoot)).toEqual(['base']);
    },
  );
});

describe('extensions.commitImport', () => {
  it('puts the course into the library without a restart, replaces it on a repeated import and keeps events', async () => {
    const t = await open();
    const first = await t.engine.extensions.runImporter(ID, IMPORTER, FILE);
    const committed = await t.engine.extensions.commitImport(
      first.importId as string,
    );
    expect(committed).toEqual({
      path: 'imported/acme.csv-my-sheet',
      replaced: false,
      courseIds: ['sheet'],
    });
    expect(await t.courseIds()).toEqual(['base', 'sheet']);
    expect(
      await exists(
        join(
          t.libraryRoot,
          'imported/acme.csv-my-sheet/sheet/course_manifest.json',
        ),
      ),
    ).toBe(true);
    expect(t.events.some(({ type }) => type === 'library-reloaded')).toBe(true);
    // ни `.staging`, ни `.trash` после успеха
    expect(await visible(t.libraryRoot)).toEqual(['base', 'imported']);

    const second = await t.engine.extensions.runImporter(ID, IMPORTER, {
      ...FILE,
      text: 'again',
    });
    expect(second.replaces).toBe(true);
    const replaced = await t.engine.extensions.commitImport(
      second.importId as string,
    );
    expect(replaced.replaced).toBe(true);
    expect(await t.courseIds()).toEqual(['base', 'sheet']);
  });

  it('replaces the previous directory completely, not merging old files into the new one', async () => {
    let lessons = 2;
    const t = await open({
      importer: () => filesOf(course('sheet', lessons)),
    });
    const first = await t.engine.extensions.runImporter(ID, IMPORTER, FILE);
    await t.engine.extensions.commitImport(first.importId as string);
    expect((await t.engine.library.listLessons('sheet')).items).toHaveLength(2);
    lessons = 1;
    const second = await t.engine.extensions.runImporter(ID, IMPORTER, FILE);
    await t.engine.extensions.commitImport(second.importId as string);
    expect((await t.engine.library.listLessons('sheet')).items).toHaveLength(1);
  });

  it('survives an engine restart: the course is an ordinary library directory', async () => {
    const t = await open();
    const preview = await t.engine.extensions.runImporter(ID, IMPORTER, FILE);
    await t.engine.extensions.commitImport(preview.importId as string);
    await t.engine.close();
    const reopened = await createTestEngine({
      library: createNodeFsCourseSource(t.libraryRoot),
      config: { libraryRoot: t.libraryRoot, dataDir: t.dataDir },
    });
    expect(
      (await reopened.engine.library.listCourses()).items
        .map(({ id }) => id)
        .sort(),
    ).toEqual(['base', 'sheet']);
  });

  it('rolls a first import back when the reload rejects it (duplicate course id)', async () => {
    const t = await open({ importer: () => filesOf(course('base', 2)) });
    const preview = await t.engine.extensions.runImporter(ID, IMPORTER, FILE);
    // дерево само по себе верно: конфликт с `base` виден только перезагрузке
    expect(preview.importId).not.toBeNull();
    const error = await failure(
      t.engine.extensions.commitImport(preview.importId as string),
    );
    expect(error).toMatchObject({
      code: 'EXTENSION_TRANSFER_FAILED',
      details: {
        extensionId: ID,
        id: IMPORTER,
        kind: 'import',
        reason: 'reload-rejected',
      },
    });
    const { diagnostics, summary } = error.details as {
      diagnostics: Array<{ code: string }>;
      summary: { errors: number };
    };
    expect(summary.errors).toBeGreaterThan(0);
    expect(diagnostics.map(({ code }) => code)).toContain('E_ID_DUPLICATE');
    // откат первого импорта оставляет разве что пустой корень `imported`
    expect(await readdir(join(t.libraryRoot, 'imported'))).toEqual([]);
    expect(await t.courseIds()).toEqual(['base']);
    expect((await t.engine.library.getInfo()).state).toBe('ready');
    // повторно применить отвергнутый импорт нельзя
    await expect(
      t.engine.extensions.commitImport(preview.importId as string),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('restores the previous import when the replacement is rejected', async () => {
    let id = 'sheet';
    const t = await open({ importer: () => filesOf(course(id)) });
    const first = await t.engine.extensions.runImporter(ID, IMPORTER, FILE);
    await t.engine.extensions.commitImport(first.importId as string);
    id = 'base';
    const second = await t.engine.extensions.runImporter(ID, IMPORTER, FILE);
    await expect(
      t.engine.extensions.commitImport(second.importId as string),
    ).rejects.toMatchObject({ details: { reason: 'reload-rejected' } });
    expect(await t.courseIds()).toEqual(['base', 'sheet']);
    expect(
      await readFile(
        join(
          t.libraryRoot,
          'imported/acme.csv-my-sheet/sheet/course_manifest.json',
        ),
        'utf8',
      ),
    ).toContain('"sheet"');
    expect(await visible(t.libraryRoot)).toEqual(['base', 'imported']);
  });

  it('answers NOT_FOUND for an unknown, applied or expired import', async () => {
    const t = await open();
    await expect(
      t.engine.extensions.commitImport('missing'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: { importId: 'missing' },
    });
    const done = await t.engine.extensions.runImporter(ID, IMPORTER, FILE);
    await t.engine.extensions.commitImport(done.importId as string);
    await expect(
      t.engine.extensions.commitImport(done.importId as string),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const stale = await t.engine.extensions.runImporter(ID, IMPORTER, {
      name: 'late.csv',
      text: 'x',
    });
    t.clock.advance(PENDING_IMPORT_TTL_MS);
    await expect(
      t.engine.extensions.commitImport(stale.importId as string),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await visible(t.libraryRoot)).toEqual(['base', 'imported']);
  });
});

describe('pending imports', () => {
  const staged = async (libraryRoot: string) =>
    readdir(join(libraryRoot, '.staging')).catch(() => [] as string[]);

  it('discardImport removes the temporary directory and is idempotent', async () => {
    const t = await open();
    const preview = await t.engine.extensions.runImporter(ID, IMPORTER, FILE);
    expect(await staged(t.libraryRoot)).toEqual([preview.importId]);
    expect(
      await t.engine.extensions.discardImport(preview.importId as string),
    ).toBe(true);
    expect(await staged(t.libraryRoot)).toEqual([]);
    expect(
      await t.engine.extensions.discardImport(preview.importId as string),
    ).toBe(false);
    await expect(
      t.engine.extensions.commitImport(preview.importId as string),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await t.courseIds()).toEqual(['base']);
  });

  it('keeps at most four and drops the oldest with its directory', async () => {
    const t = await open();
    const ids: string[] = [];
    for (let i = 0; i <= MAX_PENDING_IMPORTS; i++) {
      const preview = await t.engine.extensions.runImporter(ID, IMPORTER, {
        name: `f${i}.csv`,
        text: 'x',
      });
      ids.push(preview.importId as string);
    }
    // очистка вытесненного идёт без ожидания: даём ей завершиться через очередь команд
    await t.engine.extensions.list();
    await expect.poll(() => staged(t.libraryRoot)).toEqual(ids.slice(1).sort());
    await expect(
      t.engine.extensions.commitImport(ids[0] as string),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await t.engine.extensions.commitImport(ids[1] as string);
  });

  it('close removes the directories of pending imports', async () => {
    const t = await open();
    await t.engine.extensions.runImporter(ID, IMPORTER, FILE);
    await t.engine.extensions.runImporter(ID, IMPORTER, {
      ...FILE,
      name: 'b.csv',
    });
    expect(await staged(t.libraryRoot)).toHaveLength(2);
    await t.engine.close();
    expect(await staged(t.libraryRoot)).toEqual([]);
  });

  it('a slow importer does not block queued commands', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = await open();
    // обработчик ждёт ворота: порт — единственное место, где импорт «думает»
    const slow = t.transfers.runImporter.bind(t.transfers);
    t.transfers.runImporter = async (...args) => {
      await gate;
      return slow(...args);
    };
    const running = t.engine.extensions.runImporter(ID, IMPORTER, FILE);
    await expect(t.engine.library.getInfo()).resolves.toMatchObject({
      state: 'ready',
    });
    release();
    const preview = await running;
    expect(preview.importId).not.toBeNull();
  });
});

describe('extensions.runExporter', () => {
  it('hands the text files of the course directory with paths relative to it', async () => {
    const seen: TransferExportInput[] = [];
    const t = await open({
      exporter: (input) => {
        seen.push(input);
        return { filename: 'course.json', text: '{}' };
      },
    });
    await writeFiles(t.libraryRoot, {
      'base/notes/readme.md': 'привет',
      'base/.hidden': 'secret',
      'base/.git/config': 'secret',
      'base/image.png': 'x\u0000binary',
      'other/readme.md': 'foreign',
    });
    // не UTF-8: в снимок не входит
    await writeFile(
      join(t.libraryRoot, 'base/blob.bin'),
      new Uint8Array([0xff, 0xfe, 0x41]),
    );
    const result = await t.engine.extensions.runExporter(ID, EXPORTER, {
      scope: 'course',
      courseId: 'base',
    });
    expect(result).toEqual({ filename: 'course.json', text: '{}' });
    expect(seen).toHaveLength(1);
    const input = seen[0];
    expect(input).toMatchObject({ scope: 'course', courseId: 'base' });
    if (input?.scope !== 'course') throw new Error('course input expected');
    expect(input.title).toEqual(expect.any(String));
    expect(Object.keys(input.files).sort()).toEqual(
      [
        'course_manifest.json',
        ...[...renderLibrary(course('base')).keys()]
          .filter((path) => path !== 'base/course_manifest.json')
          .map((path) => path.slice('base/'.length)),
        'notes/readme.md',
      ].sort(),
    );
    expect(input.files['notes/readme.md']).toBe('привет');
  });

  it('passes a progress request through and checks the scope against the exporter', async () => {
    const seen: TransferExportInput[] = [];
    const t = await open({
      exporter: (input) => {
        seen.push(input);
        return { filename: 'p.csv', text: 'x' };
      },
    });
    await t.engine.extensions.runExporter(ID, PROGRESS_EXPORTER, {
      scope: 'progress',
    });
    expect(seen).toEqual([{ scope: 'progress' }]);
    const mismatch = await failure(
      t.engine.extensions.runExporter(ID, PROGRESS_EXPORTER, {
        scope: 'course',
        courseId: 'base',
      }),
    );
    expect(mismatch).toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { field: 'request', reason: 'scope' },
    });
    const other = await failure(
      t.engine.extensions.runExporter(ID, EXPORTER, { scope: 'progress' }),
    );
    expect(other).toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(seen).toHaveLength(1);
  });

  it('answers NOT_FOUND for a course that is not in the library', async () => {
    const t = await open();
    await expect(
      t.engine.extensions.runExporter(ID, EXPORTER, {
        scope: 'course',
        courseId: 'ghost',
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: { courseId: 'ghost' },
    });
    expect(t.transfers.calls).toEqual([]);
  });

  it('refuses a course snapshot over the limit without calling the extension', async () => {
    const t = await open();
    await writeFiles(t.libraryRoot, {
      'base/big-1.txt': 'a'.repeat(MAX_EXTENSION_TRANSFER_BYTES / 2),
      'base/big-2.txt': 'a'.repeat(MAX_EXTENSION_TRANSFER_BYTES / 2),
    });
    const error = await failure(
      t.engine.extensions.runExporter(ID, EXPORTER, {
        scope: 'course',
        courseId: 'base',
      }),
    );
    expect(error).toMatchObject({
      code: 'EXTENSION_TRANSFER_FAILED',
      details: {
        extensionId: ID,
        id: EXPORTER,
        kind: 'export',
        reason: 'too-large',
        courseId: 'base',
      },
    });
    expect(t.transfers.calls).toEqual([]);
  });

  it('maps port failures to EXTENSION_TRANSFER_FAILED with kind export', async () => {
    const t = await open({
      exporter: () => {
        throw new ExtensionTransferError(
          'timeout',
          ID,
          PROGRESS_EXPORTER,
          'export',
          'too slow',
        );
      },
    });
    const error = await failure(
      t.engine.extensions.runExporter(ID, PROGRESS_EXPORTER, {
        scope: 'progress',
      }),
    );
    expect(error).toMatchObject({
      code: 'EXTENSION_TRANSFER_FAILED',
      retryable: true,
      details: {
        extensionId: ID,
        id: PROGRESS_EXPORTER,
        kind: 'export',
        reason: 'timeout',
      },
    });
    expect(t.deps.extensionHealth.get(ID).failures).toBe(1);
    const unknown = await failure(
      t.engine.extensions.runExporter('acme.csv', 'acme.csv.ghost', {
        scope: 'progress',
      }),
    );
    expect(unknown).toMatchObject({ details: { reason: 'unknown-exporter' } });
  });
});
