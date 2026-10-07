import { shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type {
  ContributionsDto,
  ExporterContributionDto,
  ExportFileDto,
  ImporterContributionDto,
  ImportPreviewDto,
} from '@dolphy-app/engine-contract';
import { EngineCallError } from '@dolphy-app/engine-rpc/client';
import type { Platform } from '../shared/bridge.ts';
import { createExtensionTransfers } from '@/features/extension-transfers/model/transfers.ts';
import { syncTransferCommands } from '@/features/extension-transfers/model/registry-adapter.ts';
import { transferEntries } from '@/features/extension-transfers/lib/entries.ts';
import { describeTransferFailure } from '@/features/extension-transfers/lib/failure.ts';
import { NO_CONTRIBUTIONS } from '@/shared/api/engine/contributions.ts';
import { createCommandRegistry } from '@/shared/lib/command-registry.ts';

type Pick = Awaited<ReturnType<Platform['pickFile']>>;

const importer = (
  id: string,
  override: Partial<ImporterContributionDto> = {},
): ImporterContributionDto => ({
  id,
  extensionId: 'acme.csv',
  title: id,
  accept: ['.csv'],
  input: 'text',
  ...override,
});
const exporter = (
  id: string,
  override: Partial<ExporterContributionDto> = {},
): ExporterContributionDto => ({
  id,
  extensionId: 'acme.csv',
  title: id,
  scope: 'course',
  ...override,
});

const PREVIEW: ImportPreviewDto = {
  importId: 'op1',
  extensionId: 'acme.csv',
  importerId: 'csv',
  path: 'imported/acme.csv-words',
  replaces: false,
  files: 3,
  counts: { courses: 1, lessons: 2, exercises: 5 },
  summary: { errors: 0, warnings: 0, infos: 0 },
  diagnostics: [],
};

const transferError = (reason: string, details: object = {}) =>
  new EngineCallError({
    code: 'EXTENSION_TRANSFER_FAILED',
    message: `boom ${reason}`,
    retryable: false,
    details: { reason, ...details },
  });

const setup = (
  initial: Partial<ContributionsDto> = {
    importers: [importer('csv')],
    exporters: [
      exporter('course-csv'),
      exporter('stats', { scope: 'progress' }),
    ],
  },
) => {
  const contributions = shallowRef<ContributionsDto>({
    ...NO_CONTRIBUTIONS,
    ...initial,
  });
  const notices: string[] = [];
  const picked: { value: Pick } = { value: null };
  const engine = {
    runImporter: vi.fn(async () => PREVIEW),
    commitImport: vi.fn(async () => ({
      path: PREVIEW.path,
      replaced: false,
      courseIds: ['words_kb'],
    })),
    discardImport: vi.fn(async () => true),
    runExporter: vi.fn(async (): Promise<ExportFileDto> => ({
      filename: 'out.csv',
      text: 'a,b',
    })),
  };
  const platform = {
    pickFile: vi.fn(async () => picked.value),
    saveFile: vi.fn(async (): Promise<'saved' | 'canceled'> => 'saved'),
  };
  const transfers = createExtensionTransfers({
    engine,
    platform,
    contributions: () => contributions.value,
    notify: (text) => void notices.push(text),
    t: (key, params) => `${key} ${JSON.stringify(params ?? {})}`,
    locale: () => 'en',
  });
  return { transfers, engine, platform, notices, picked, contributions };
};

const bytes = (text: string) => new TextEncoder().encode(text);

describe('импорт', () => {
  it('отмена диалога файла ничего не вызывает и ничего не показывает', async () => {
    const { transfers, engine, notices } = setup();
    await transfers.startImport('acme.csv', 'csv');
    expect(engine.runImporter).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
    expect(transfers.phase.value.kind).toBe('idle');
  });

  it('передаёт диалогу фильтр по accept и название', async () => {
    const { transfers, platform } = setup();
    await transfers.startImport('acme.csv', 'csv');
    expect(platform.pickFile).toHaveBeenCalledWith({
      accept: ['.csv'],
      title: 'csv',
    });
  });

  it.each([
    ['too-large', 'transfers.file.tooLarge'],
    ['unsupported', 'transfers.file.unsupported'],
  ] as const)(
    'файл «%s» — сообщение без вызова расширения',
    async (status, key) => {
      const { transfers, engine, notices, picked } = setup();
      picked.value = { status, name: 'x.csv' };
      await transfers.startImport('acme.csv', 'csv');
      expect(engine.runImporter).not.toHaveBeenCalled();
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain(key);
      expect(transfers.phase.value.kind).toBe('idle');
    },
  );

  it('текстовый импортёр не получает файл не в UTF-8', async () => {
    const { transfers, engine, notices, picked } = setup();
    picked.value = {
      status: 'picked',
      name: 'a.csv',
      bytes: new Uint8Array([0xff, 0xfe, 0x41]),
    };
    await transfers.startImport('acme.csv', 'csv');
    expect(engine.runImporter).not.toHaveBeenCalled();
    expect(notices[0]).toContain('transfers.file.notUtf8');
  });

  it('текстовый импортёр получает строку, байтовый — байты', async () => {
    const text = setup();
    text.picked.value = {
      status: 'picked',
      name: 'a.csv',
      bytes: bytes('привет'),
    };
    await text.transfers.startImport('acme.csv', 'csv');
    expect(text.engine.runImporter).toHaveBeenCalledWith('acme.csv', 'csv', {
      name: 'a.csv',
      text: 'привет',
    });

    const binary = setup({ importers: [importer('csv', { input: 'bytes' })] });
    const raw = new Uint8Array([0xff, 0x00]);
    binary.picked.value = { status: 'picked', name: 'a.csv', bytes: raw };
    await binary.transfers.startImport('acme.csv', 'csv');
    expect(binary.engine.runImporter).toHaveBeenCalledWith('acme.csv', 'csv', {
      name: 'a.csv',
      bytes: raw,
    });
  });

  it('показывает сводку и записывает по «Импортировать»', async () => {
    const { transfers, engine, notices, picked } = setup();
    picked.value = { status: 'picked', name: 'a.csv', bytes: bytes('x') };
    await transfers.startImport('acme.csv', 'csv');
    expect(transfers.phase.value).toMatchObject({
      kind: 'preview',
      fileName: 'a.csv',
      preview: PREVIEW,
    });
    await transfers.commitImport();
    expect(engine.commitImport).toHaveBeenCalledWith('op1');
    expect(transfers.phase.value.kind).toBe('idle');
    expect(notices[0]).toContain('transfers.import.done');
  });

  it('«Отмена» отменяет ожидающий импорт и закрывает сводку', async () => {
    const { transfers, engine, picked } = setup();
    picked.value = { status: 'picked', name: 'a.csv', bytes: bytes('x') };
    await transfers.startImport('acme.csv', 'csv');
    await transfers.cancelImport();
    expect(engine.discardImport).toHaveBeenCalledWith('op1');
    expect(engine.commitImport).not.toHaveBeenCalled();
    expect(transfers.phase.value.kind).toBe('idle');
  });

  it('сводка с ошибками (importId: null) не записывается и не отменяется на движке', async () => {
    const { transfers, engine, picked } = setup();
    picked.value = { status: 'picked', name: 'a.csv', bytes: bytes('x') };
    engine.runImporter.mockResolvedValueOnce({
      ...PREVIEW,
      importId: null,
      summary: { errors: 2, warnings: 0, infos: 0 },
    });
    await transfers.startImport('acme.csv', 'csv');
    await transfers.commitImport();
    expect(engine.commitImport).not.toHaveBeenCalled();
    await transfers.cancelImport();
    expect(engine.discardImport).not.toHaveBeenCalled();
    expect(transfers.phase.value.kind).toBe('idle');
  });

  it('отказ перезагрузки остаётся в сводке с диагностиками, повторно не записывается', async () => {
    const { transfers, engine, picked } = setup();
    picked.value = { status: 'picked', name: 'a.csv', bytes: bytes('x') };
    await transfers.startImport('acme.csv', 'csv');
    const diagnostics = [
      { code: 'E_DUP', severity: 'error', message: 'duplicate id' },
    ];
    engine.commitImport.mockRejectedValueOnce(
      transferError('reload-rejected', {
        diagnostics,
        summary: { errors: 1, warnings: 0, infos: 0 },
      }),
    );
    await transfers.commitImport();
    const phase = transfers.phase.value;
    expect(phase.kind).toBe('preview');
    if (phase.kind !== 'preview') return;
    expect(phase.committing).toBe(false);
    expect(phase.failure).toMatchObject({
      kind: 'reloadRejected',
      diagnostics,
    });
  });

  it('сбой расширения при разборе файла — сообщение по причине, окно свободно', async () => {
    const { transfers, engine, notices, picked } = setup();
    picked.value = { status: 'picked', name: 'a.csv', bytes: bytes('x') };
    engine.runImporter.mockRejectedValueOnce(transferError('timeout'));
    await transfers.startImport('acme.csv', 'csv');
    expect(notices).toEqual(['transfers.failure.timeout {}']);
    expect(transfers.phase.value.kind).toBe('idle');
  });

  it('импортёр, исчезнувший из вкладов, не запускается', async () => {
    const { transfers, platform, notices, contributions } = setup();
    contributions.value = { ...contributions.value, importers: [] };
    await transfers.startImport('acme.csv', 'csv');
    expect(platform.pickFile).not.toHaveBeenCalled();
    expect(notices).toEqual(['transfers.failure.changed {}']);
  });

  it('пока идёт одно действие, второе не начинается', async () => {
    const { transfers, platform, picked } = setup();
    picked.value = { status: 'picked', name: 'a.csv', bytes: bytes('x') };
    await transfers.startImport('acme.csv', 'csv');
    await transfers.startImport('acme.csv', 'csv');
    expect(platform.pickFile).toHaveBeenCalledTimes(1);
  });
});

describe('экспорт', () => {
  it('курс: сначала выбор курса, потом экспорт и диалог сохранения с именем расширения', async () => {
    const { transfers, engine, platform, notices } = setup();
    await transfers.startExport('acme.csv', 'course-csv');
    expect(transfers.phase.value.kind).toBe('choose-course');
    expect(engine.runExporter).not.toHaveBeenCalled();
    await transfers.exportCourse('alpha_kb');
    expect(engine.runExporter).toHaveBeenCalledWith('acme.csv', 'course-csv', {
      scope: 'course',
      courseId: 'alpha_kb',
    });
    expect(platform.saveFile).toHaveBeenCalledWith({
      suggestedName: 'out.csv',
      bytes: bytes('a,b'),
    });
    expect(notices[0]).toContain('transfers.export.saved');
    expect(transfers.phase.value.kind).toBe('idle');
  });

  it('прогресс экспортируется сразу, без выбора курса', async () => {
    const { transfers, engine } = setup();
    await transfers.startExport('acme.csv', 'stats');
    expect(engine.runExporter).toHaveBeenCalledWith('acme.csv', 'stats', {
      scope: 'progress',
    });
  });

  it('байты результата уходят в диалог как есть', async () => {
    const { transfers, engine, platform } = setup();
    const raw = new Uint8Array([1, 2, 3]);
    engine.runExporter.mockResolvedValueOnce({ filename: 'x.bin', bytes: raw });
    await transfers.startExport('acme.csv', 'stats');
    expect(platform.saveFile).toHaveBeenCalledWith({
      suggestedName: 'x.bin',
      bytes: raw,
    });
  });

  it('отказ от сохранения молчит', async () => {
    const { transfers, platform, notices } = setup();
    platform.saveFile.mockResolvedValueOnce('canceled');
    await transfers.startExport('acme.csv', 'stats');
    expect(notices).toEqual([]);
    expect(transfers.phase.value.kind).toBe('idle');
  });

  it('сбой записи файла — сообщение', async () => {
    const { transfers, platform, notices } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    platform.saveFile.mockRejectedValueOnce(new Error('EACCES'));
    await transfers.startExport('acme.csv', 'stats');
    expect(notices).toEqual(['transfers.export.saveFailed {}']);
  });

  it('сбой экспортёра не доходит до диалога сохранения', async () => {
    const { transfers, engine, platform, notices } = setup();
    engine.runExporter.mockRejectedValueOnce(transferError('handler-failed'));
    await transfers.startExport('acme.csv', 'stats');
    expect(platform.saveFile).not.toHaveBeenCalled();
    expect(notices[0]).toContain('transfers.failure.failedWith');
  });

  it('отмена выбора курса закрывает диалог', async () => {
    const { transfers } = setup();
    await transfers.startExport('acme.csv', 'course-csv');
    transfers.cancelExport();
    expect(transfers.phase.value.kind).toBe('idle');
  });
});

describe('описание сбоя', () => {
  it.each([
    ['timeout', 'timeout'],
    ['host-down', 'hostDown'],
    ['invalid-result', 'invalidResult'],
    ['disabled', 'changed'],
    ['replaced', 'changed'],
    ['unknown-importer', 'changed'],
    ['too-large', 'tooLarge'],
    ['handler-failed', 'failed'],
  ])('%s → %s', (reason, kind) => {
    expect(describeTransferFailure(transferError(reason), 'import').kind).toBe(
      kind,
    );
  });

  it('NOT_FOUND: у импорта — устарел, у экспорта — курса нет', () => {
    const error = new EngineCallError({
      code: 'NOT_FOUND',
      message: 'x',
      retryable: false,
    });
    expect(describeTransferFailure(error, 'import').kind).toBe('importExpired');
    expect(describeTransferFailure(error, 'export').kind).toBe('courseGone');
  });

  it('чужая ошибка — failed с её текстом', () => {
    expect(describeTransferFailure(new Error('oops'), 'export')).toMatchObject({
      kind: 'failed',
      message: 'oops',
    });
  });
});

describe('команды палитры', () => {
  const build = (initial: Partial<ContributionsDto>) => {
    const contributions = shallowRef<ContributionsDto>({
      ...NO_CONTRIBUTIONS,
      ...initial,
    });
    const registry = createCommandRegistry();
    const transfers = {
      startImport: vi.fn(async () => undefined),
      startExport: vi.fn(async () => undefined),
    };
    syncTransferCommands(
      registry,
      () => contributions.value,
      transfers,
      (key, params) => `${key}|${String(params?.['title'] ?? '')}`,
      () => 'ru',
    );
    return { contributions, registry, transfers };
  };

  it('по команде на импортёр и экспортёр; запись снимается без перезагрузки', async () => {
    const { contributions, registry, transfers } = build({
      importers: [importer('csv', { title: 'Из CSV' })],
      exporters: [exporter('out', { title: 'В CSV' })],
    });
    const commands = registry.list.value;
    expect(
      commands.map(({ key, title, category, caption }) => [
        key,
        title,
        category,
        caption,
      ]),
    ).toEqual([
      [
        'extension:acme.csv:import:csv',
        'transfers.command.import|Из CSV',
        'transfers.category|',
        'acme.csv',
      ],
      [
        'extension:acme.csv:export:out',
        'transfers.command.export|В CSV',
        'transfers.category|',
        'acme.csv',
      ],
    ]);
    await commands[0]?.run();
    await commands[1]?.run();
    expect(transfers.startImport).toHaveBeenCalledWith('acme.csv', 'csv');
    expect(transfers.startExport).toHaveBeenCalledWith('acme.csv', 'out');

    contributions.value = { ...contributions.value, importers: [] };
    expect(registry.list.value.map(({ key }) => key)).toEqual([
      'extension:acme.csv:export:out',
    ]);
  });

  it('сортирует записи по id расширения, затем по порядку вклада', () => {
    const { importers } = transferEntries({
      importers: [
        importer('b', { extensionId: 'z.ext' }),
        importer('a2', { extensionId: 'a.ext' }),
        importer('a1', { extensionId: 'a.ext' }),
      ],
      exporters: [],
    });
    expect(importers.map(({ id }) => id)).toEqual(['a2', 'a1', 'b']);
  });
});
