import { computed, shallowRef } from 'vue';
import type { ComputedRef, InjectionKey, ShallowRef } from 'vue';
import type {
  ContributionsDto,
  ExporterContributionDto,
  ExportFileDto,
  ExtensionsService,
  ImporterContributionDto,
  ImportPreviewDto,
  LocalizedTextDto,
} from '@dolphy-app/engine-contract';
import { MAX_EXTENSION_TRANSFER_BYTES } from '@dolphy-app/engine-contract';
import { resolveLocalizedText } from '@dolphy-app/extension-api';
import type { Platform } from '../../../../shared/bridge.ts';
import { decodeUtf8 } from '../lib/decode.ts';
import { describeTransferFailure } from '../lib/failure.ts';
import type { TransferFailure } from '../lib/failure.ts';

/** Перевод строки окна: ключ и данные; текст расширения подставляется как данные. */
export type Translate = (
  key: string,
  params?: Record<string, unknown>,
) => string;

/** Что сейчас происходит; `idle` — ничего, диалогов нет. */
export type TransferPhase =
  /** Диалог системы, ожидание ответа расширения или запись: окно показывает занятость. */
  | {
      kind: 'working';
      action: 'import' | 'export' | 'save' | 'commit';
      title: string;
    }
  /** Сводка присланного дерева: пользователь решает, импортировать ли. */
  | {
      kind: 'preview';
      importer: ImporterContributionDto;
      fileName: string;
      preview: ImportPreviewDto;
      /** Сбой записи; при окончательном сбое кнопка «Импортировать» недоступна. */
      failure: TransferFailure | null;
      committing: boolean;
    }
  /** Выбор курса для экспорта (`scope: 'course'`). */
  | { kind: 'choose-course'; exporter: ExporterContributionDto }
  | { kind: 'idle' };

export interface ExtensionTransfersDeps {
  engine: Pick<
    ExtensionsService,
    'runImporter' | 'commitImport' | 'discardImport' | 'runExporter'
  >;
  /** Системные диалоги файла (main): путь файла окну и расширению не отдаётся. */
  platform: Pick<Platform, 'pickFile' | 'saveFile'>;
  /** Живые вклады: запись проверяется по ним в момент запуска. */
  contributions: () => Readonly<ContributionsDto>;
  /** Короткое уведомление приложения (готовый текст). */
  notify(text: string): void;
  t: Translate;
  /** Язык окна (`ru`/`en`): подписи расширений; читается реактивно. */
  locale: () => string;
}

export interface ExtensionTransfers {
  readonly phase: Readonly<ShallowRef<TransferPhase>>;
  /** Занято: новый импорт или экспорт не начинается, пока не закончен прежний. */
  readonly busy: ComputedRef<boolean>;
  /** Выбор файла, проверка расширением и показ сводки; отмена диалога ничего не меняет. */
  startImport(extensionId: string, importerId: string): Promise<void>;
  /** Записывает ожидающий импорт в библиотеку. */
  commitImport(): Promise<void>;
  /** Закрывает сводку и отменяет ожидающий импорт (на диске ничего не остаётся). */
  cancelImport(): Promise<void>;
  /** `progress` — сразу экспорт, `course` — сначала выбор курса. */
  startExport(extensionId: string, exporterId: string): Promise<void>;
  /** Экспорт выбранного курса. */
  exportCourse(courseId: string): Promise<void>;
  cancelExport(): void;
}

export const EXTENSION_TRANSFERS_KEY: InjectionKey<ExtensionTransfers> = Symbol(
  'extension-transfers',
);

const MIB = 1024 * 1024;
const IDLE: TransferPhase = { kind: 'idle' };

const failureText = (t: Translate, failure: TransferFailure): string => {
  switch (failure.kind) {
    case 'failed':
      // текст расширения — данные: подставляется как есть
      return failure.message === ''
        ? t('transfers.failure.failed')
        : t('transfers.failure.failedWith', { message: failure.message });
    default:
      return t(`transfers.failure.${failure.kind}`);
  }
};

/** Текст сбоя для уведомления и диалога. */
export const describeFailureText = failureText;

export const createExtensionTransfers = (
  deps: ExtensionTransfersDeps,
): ExtensionTransfers => {
  const { engine, platform, t } = deps;
  const titleOf = (title: LocalizedTextDto) =>
    resolveLocalizedText(title, deps.locale());
  const phase = shallowRef<TransferPhase>(IDLE);
  const busy = computed(() => phase.value.kind !== 'idle');

  const findImporter = (extensionId: string, importerId: string) =>
    deps
      .contributions()
      .importers.find(
        (item) => item.extensionId === extensionId && item.id === importerId,
      );
  const findExporter = (extensionId: string, exporterId: string) =>
    deps
      .contributions()
      .exporters.find(
        (item) => item.extensionId === extensionId && item.id === exporterId,
      );

  const fail = (failure: TransferFailure) =>
    deps.notify(failureText(t, failure));

  const startImport = async (extensionId: string, importerId: string) => {
    if (busy.value) return;
    const importer = findImporter(extensionId, importerId);
    if (importer === undefined) {
      fail({ kind: 'changed', message: '', diagnostics: [], summary: null });
      return;
    }
    const working = (action: 'import'): TransferPhase => ({
      kind: 'working',
      action,
      title: titleOf(importer.title),
    });
    phase.value = working('import');
    try {
      const picked = await platform.pickFile({
        accept: importer.accept,
        title: titleOf(importer.title),
      });
      if (picked === null) return;
      if (picked.status === 'too-large') {
        deps.notify(
          t('transfers.file.tooLarge', {
            name: picked.name,
            size: MAX_EXTENSION_TRANSFER_BYTES / MIB,
          }),
        );
        return;
      }
      if (picked.status === 'unsupported') {
        deps.notify(
          t('transfers.file.unsupported', {
            name: picked.name,
            accept: importer.accept.join(', '),
          }),
        );
        return;
      }
      let file;
      if (importer.input === 'text') {
        const text = decodeUtf8(picked.bytes);
        if (text === null) {
          deps.notify(t('transfers.file.notUtf8', { name: picked.name }));
          return;
        }
        file = { name: picked.name, text };
      } else {
        file = { name: picked.name, bytes: picked.bytes };
      }
      let preview: ImportPreviewDto;
      try {
        preview = await engine.runImporter(extensionId, importerId, file);
      } catch (error) {
        fail(describeTransferFailure(error, 'import'));
        return;
      }
      phase.value = {
        kind: 'preview',
        importer,
        fileName: picked.name,
        preview,
        failure: null,
        committing: false,
      };
    } catch (error) {
      // диалог файла или канал окна отказали: понятное сообщение, а не тишина
      console.error({ error }, 'file picking failed');
      deps.notify(t('transfers.file.pickFailed'));
    } finally {
      if (phase.value.kind === 'working') phase.value = IDLE;
    }
  };

  const commitImport = async () => {
    const current = phase.value;
    if (current.kind !== 'preview' || current.committing) return;
    const { importId } = current.preview;
    if (importId === null) return;
    const { preview, importer, fileName } = current;
    phase.value = { ...current, committing: true, failure: null };
    try {
      const result = await engine.commitImport(importId);
      phase.value = IDLE;
      deps.notify(
        t('transfers.import.done', {
          n: result.courseIds.length,
          path: result.path,
        }),
      );
    } catch (error) {
      phase.value = {
        kind: 'preview',
        importer,
        fileName,
        preview,
        failure: describeTransferFailure(error, 'import'),
        committing: false,
      };
    }
  };

  const cancelImport = async () => {
    const current = phase.value;
    if (current.kind !== 'preview' || current.committing) return;
    phase.value = IDLE;
    const { importId } = current.preview;
    // сбой отмены не мешает закрыть окно: ожидающий импорт истечёт сам
    if (importId !== null)
      await engine.discardImport(importId).catch(() => false);
  };

  const save = async (file: ExportFileDto, title: string) => {
    phase.value = { kind: 'working', action: 'save', title };
    const bytes =
      'bytes' in file ? file.bytes : new TextEncoder().encode(file.text);
    try {
      const outcome = await platform.saveFile({
        suggestedName: file.filename,
        bytes,
      });
      if (outcome === 'saved') {
        deps.notify(t('transfers.export.saved', { name: file.filename }));
      }
    } catch (error) {
      console.error({ error }, 'file saving failed');
      deps.notify(t('transfers.export.saveFailed'));
    }
  };

  const run = async (
    exporter: ExporterContributionDto,
    request: Parameters<ExtensionsService['runExporter']>[2],
  ) => {
    phase.value = {
      kind: 'working',
      action: 'export',
      title: titleOf(exporter.title),
    };
    try {
      let file: ExportFileDto;
      try {
        file = await engine.runExporter(
          exporter.extensionId,
          exporter.id,
          request,
        );
      } catch (error) {
        fail(describeTransferFailure(error, 'export'));
        return;
      }
      await save(file, titleOf(exporter.title));
    } finally {
      phase.value = IDLE;
    }
  };

  const startExport = async (extensionId: string, exporterId: string) => {
    if (busy.value) return;
    const exporter = findExporter(extensionId, exporterId);
    if (exporter === undefined) {
      fail({ kind: 'changed', message: '', diagnostics: [], summary: null });
      return;
    }
    if (exporter.scope === 'progress') {
      await run(exporter, { scope: 'progress' });
      return;
    }
    phase.value = { kind: 'choose-course', exporter };
  };

  const exportCourse = async (courseId: string) => {
    const current = phase.value;
    if (current.kind !== 'choose-course') return;
    await run(current.exporter, { scope: 'course', courseId });
  };

  const cancelExport = () => {
    if (phase.value.kind === 'choose-course') phase.value = IDLE;
  };

  return {
    phase,
    busy,
    startImport,
    commitImport,
    cancelImport,
    startExport,
    exportCourse,
    cancelExport,
  };
};
