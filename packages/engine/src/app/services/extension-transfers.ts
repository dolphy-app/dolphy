import {
  MAX_EXTENSION_TRANSFER_BYTES,
  isEffectiveExtensionState,
} from '@dolphy-app/engine-contract';
import type {
  CommitImportResultDto,
  Diagnostic,
  ExporterContributionDto,
  ExportFileDto,
  ExportRequestDto,
  ExtensionTransferFailureReason,
  ExtensionsService,
  ImporterContributionDto,
  ImportPreviewDto,
  LibraryInfo,
  LibraryService,
} from '@dolphy-app/engine-contract';
import { compile } from '../../authoring/compile.ts';
import { isExtensionId } from '../../domain/extension-settings.ts';
import { ExtensionTransferError } from '../../ports/extension-transfers.ts';
import type {
  TransferExportInput,
  TransferImportInput,
} from '../../ports/extension-transfers.ts';
import type { SnapshotRoot } from '../../ports/repositories.ts';
import {
  CourseSnapshotTooLargeError,
  readCourseSnapshot,
} from '../course-snapshot.ts';
import type { EngineContext } from '../context.ts';
import { EngineError } from '../errors.ts';
import { createExpiringMap } from '../expiring-map.ts';
import { importDirectoryName } from '../import-name.ts';

/** Ожидающих импортов не больше (R5: «до 4»); старейший вытесняется вместе со своим временным каталогом. */
export const MAX_PENDING_IMPORTS = 4;
/** Срок ожидающего импорта до решения пользователя. */
export const PENDING_IMPORT_TTL_MS = 10 * 60 * 1000;
/** Сколько диагностик попадает в сводку и в `details` отказа. */
export const MAX_IMPORT_DIAGNOSTICS = 50;

/** Импортированные курсы лежат в `<libraryRoot>/imported/<имя>`. */
const ROOT: SnapshotRoot = 'imported';

const MAX_FILE_NAME_CHARS = 255;

/**
 * Причины, в которых виновато расширение (как у команд): считаются в здоровье
 * расширения. `host-down`, `replaced` и `disabled` — не его вина.
 */
const FAULTS: ReadonlySet<string> = new Set([
  'handler-failed',
  'timeout',
  'invalid-result',
]);

type Kind = 'import' | 'export';

type TransferMethods = Pick<
  ExtensionsService,
  'runImporter' | 'commitImport' | 'discardImport' | 'runExporter'
>;

export interface ExtensionTransfersService {
  /** Методы сервиса `extensions` (контракт). */
  readonly methods: TransferMethods;
  /** Закрытие движка: удаляет временные каталоги ожидающих импортов. */
  dispose(): Promise<void>;
}

export interface ExtensionTransfersDeps {
  library: Pick<LibraryService, 'reload' | 'getDiagnostics'>;
}

type TransfersContext = Pick<
  EngineContext,
  | 'extensionRegistry'
  | 'extensionPolicy'
  | 'extensionHealth'
  | 'extensionTransfers'
  | 'snapshotInstaller'
  | 'courseSource'
  | 'settings'
  | 'library'
  | 'exerciseTypes'
  | 'ids'
  | 'clock'
  | 'logger'
  | 'state'
>;

/** Импорт, проверенный компилятором и ждущий решения пользователя. */
interface PendingImport {
  opId: string;
  /** Имя каталога в `imported/`. */
  dir: string;
  extensionId: string;
  importerId: string;
  courseIds: string[];
}

const invalid = (field: string, message: string, reason?: string) =>
  new EngineError('INVALID_ARGUMENT', {
    message,
    details: { field, ...(reason !== undefined && { reason }) },
  });

const requireText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value === '' || value.length > 128) {
    throw invalid(field, `${field} must be a non-empty string`);
  }
  return value;
};

/** Размер текста в UTF-8; кодирует только в спорной зоне, где знаков меньше потолка, а байт может быть больше. */
const utf8Size = (text: string): number => {
  if (text.length > MAX_EXTENSION_TRANSFER_BYTES) return text.length;
  if (text.length * 3 <= MAX_EXTENSION_TRANSFER_BYTES) return text.length * 3;
  return new TextEncoder().encode(text).byteLength;
};

/** Файл импорта: имя без каталога, содержимое строкой или байтами ровно по `input` импортёра. */
const checkFile = (
  file: unknown,
  importer: ImporterContributionDto,
): TransferImportInput => {
  if (typeof file !== 'object' || file === null) {
    throw invalid('file', 'file must be an object', 'shape');
  }
  const name = 'name' in file ? file.name : undefined;
  if (
    typeof name !== 'string' ||
    name === '' ||
    name.length > MAX_FILE_NAME_CHARS ||
    // eslint-disable-next-line no-control-regex
    /[/\\\u0000-\u001f\u007f]/.test(name) ||
    name === '.' ||
    name === '..'
  ) {
    throw invalid(
      'file',
      'file name must be a name without a directory',
      'name',
    );
  }
  const text = 'text' in file ? file.text : undefined;
  const bytes = 'bytes' in file ? file.bytes : undefined;
  if (
    typeof text === 'string' &&
    bytes === undefined &&
    importer.input === 'text'
  ) {
    return { name, text };
  }
  if (
    bytes instanceof Uint8Array &&
    text === undefined &&
    importer.input === 'bytes'
  ) {
    return { name, bytes };
  }
  throw invalid(
    'file',
    `importer '${importer.id}' takes ${importer.input} input`,
    'input-kind',
  );
};

const importSize = (input: TransferImportInput): number =>
  'text' in input ? utf8Size(input.text) : input.bytes.byteLength;

/** Ошибки без `info`: сначала ошибки, затем предупреждения; пути — от каталога курса. */
const previewDiagnostics = (
  diagnostics: readonly Diagnostic[],
  dir: string,
): Diagnostic[] => {
  const prefix = `${dir}/`;
  const relative = (diagnostic: Diagnostic): Diagnostic =>
    diagnostic.path?.startsWith(prefix)
      ? { ...diagnostic, path: diagnostic.path.slice(prefix.length) }
      : diagnostic;
  return [
    ...diagnostics.filter(({ severity }) => severity === 'error'),
    ...diagnostics.filter(({ severity }) => severity === 'warning'),
  ]
    .slice(0, MAX_IMPORT_DIAGNOSTICS)
    .map(relative);
};

/**
 * Импорт и экспорт расширений (`extensions.runImporter`, `commitImport`,
 * `discardImport`, `runExporter`). Расширение возвращает только строки; на
 * диск пишет движок: присланное дерево сначала проверяется компилятором курсов
 * во временном каталоге (`.staging`, невидимом сканеру), и лишь по решению
 * пользователя `commitImport` подменяет `imported/<имя>` и перезагружает
 * библиотеку, откатывая каталог при отказе (как `repositories`).
 */
export const createExtensionTransfers = (
  ctx: TransfersContext,
  { library }: ExtensionTransfersDeps,
): ExtensionTransfersService => {
  const installer = ctx.snapshotInstaller;

  /** Идущие очистки: `dispose` дожидается их, чтобы каталоги не пережили процесс. */
  const cleanups = new Set<Promise<void>>();
  const cleanup = (opId: string): Promise<void> => {
    const done: Promise<void> = installer
      .finish(opId)
      .catch((error: unknown) => {
        ctx.logger.warn({ error, opId }, 'cannot clean up import directories');
      })
      .finally(() => void cleanups.delete(done));
    cleanups.add(done);
    return done;
  };

  const pending = createExpiringMap<PendingImport>({
    capacity: MAX_PENDING_IMPORTS,
    ttlMs: PENDING_IMPORT_TTL_MS,
    clock: ctx.clock,
    // истёкший или вытесненный импорт не должен оставлять каталог на диске
    onDrop: (_id, entry) => void cleanup(entry.opId),
  });

  const failed = (
    kind: Kind,
    extensionId: string,
    id: string,
    reason: ExtensionTransferFailureReason,
    message: string,
    extra: Record<string, unknown> = {},
    cause?: unknown,
  ): EngineError =>
    new EngineError('EXTENSION_TRANSFER_FAILED', {
      message,
      details: { extensionId, id, kind, reason, ...extra },
      ...(cause !== undefined && { cause }),
    });

  /** Объявленная запись включённого расширения; иначе `unknown-*` или `disabled`. */
  const requireEntry = <
    T extends ImporterContributionDto | ExporterContributionDto,
  >(
    kind: Kind,
    extensionId: string,
    id: string,
  ): T => {
    const unknown = kind === 'import' ? 'unknown-importer' : 'unknown-exporter';
    const info = ctx.extensionRegistry
      .list()
      .find(
        (item) =>
          item.id === extensionId && isEffectiveExtensionState(item.state),
      );
    if (info === undefined) {
      throw failed(
        kind,
        extensionId,
        id,
        unknown,
        `Extension not found: ${extensionId}`,
      );
    }
    if (
      info.state === 'disabled' ||
      !ctx.extensionPolicy.isEnabled(extensionId)
    ) {
      throw failed(
        kind,
        extensionId,
        id,
        'disabled',
        `Extension '${extensionId}' is disabled`,
      );
    }
    const contributions = ctx.extensionRegistry.contributions();
    const entries: readonly (
      ImporterContributionDto | ExporterContributionDto
    )[] = kind === 'import' ? contributions.importers : contributions.exporters;
    const entry = entries.find(
      (item) => item.extensionId === extensionId && item.id === id,
    );
    if (entry === undefined) {
      throw failed(
        kind,
        extensionId,
        id,
        unknown,
        `${kind === 'import' ? 'Importer' : 'Exporter'} '${id}' is not declared by '${extensionId}'`,
      );
    }
    return entry as T;
  };

  /** Сбой порта → ошибка движка; вина расширения записывается в его здоровье. */
  const portFailure = (
    error: unknown,
    kind: Kind,
    extensionId: string,
    id: string,
  ): unknown => {
    if (!(error instanceof ExtensionTransferError)) return error;
    if (FAULTS.has(error.cause)) {
      ctx.extensionHealth.recordFailure(
        extensionId,
        error.cause,
        error.message,
      );
    }
    return failed(kind, extensionId, id, error.cause, error.message, {}, error);
  };

  const requireOpen = (): void => {
    if (ctx.state.closed) throw new EngineError('ENGINE_CLOSED');
  };

  /**
   * Дерево → `.staging/<opId>/<dir>` → компилятор курсов. Ошибки или ни одного
   * курса — временный каталог удаляется сразу, ожидающего импорта нет.
   */
  const stage = async (
    importer: ImporterContributionDto,
    fileName: string,
    files: Record<string, string>,
  ): Promise<ImportPreviewDto> => {
    const { extensionId } = importer;
    const dir = importDirectoryName(extensionId, fileName);
    const opId = ctx.ids.next().toLowerCase();
    let kept = false;
    try {
      const replaces = await installer.exists(ROOT, dir);
      await installer.begin(ROOT, dir, opId);
      await installer.writeStaging(dir, opId, files);
      const result = await compile(installer.stagingSource(opId), {
        scan: { ignoredPaths: [] },
        // те же проверки, что у загрузки библиотеки: сводка предсказывает `reload`
        checks: { exerciseTypes: ctx.exerciseTypes },
        emit: 'always',
      });
      requireOpen();
      const { artifact, summary } = result;
      const counts = {
        courses: artifact?.courses.length ?? 0,
        lessons: artifact?.lessons.length ?? 0,
        exercises: artifact?.exercises.length ?? 0,
      };
      const importable =
        artifact !== null && summary.errors === 0 && counts.courses > 0;
      let importId: string | null = null;
      if (importable) {
        pending.set(opId, {
          opId,
          dir,
          extensionId,
          importerId: importer.id,
          courseIds: artifact.courses.map(({ m }) => m.id),
        });
        kept = true;
        importId = opId;
      }
      return {
        importId,
        extensionId,
        importerId: importer.id,
        path: installer.snapshotPath(ROOT, dir),
        replaces,
        files: Object.keys(files).length,
        counts,
        summary,
        diagnostics: previewDiagnostics(result.diagnostics, dir),
      };
    } finally {
      if (!kept) await cleanup(opId);
    }
  };

  const runImporter: ExtensionsService['runImporter'] = async (
    extensionId,
    importerId,
    file,
  ) => {
    if (!isExtensionId(extensionId)) {
      throw invalid(
        'extensionId',
        `Invalid extension id: ${String(extensionId)}`,
      );
    }
    requireText(importerId, 'importerId');
    const importer = requireEntry<ImporterContributionDto>(
      'import',
      extensionId,
      importerId,
    );
    const input = checkFile(file, importer);
    if (importSize(input) > MAX_EXTENSION_TRANSFER_BYTES) {
      throw failed(
        'import',
        extensionId,
        importerId,
        'too-large',
        `File is longer than ${MAX_EXTENSION_TRANSFER_BYTES} bytes`,
        { limit: MAX_EXTENSION_TRANSFER_BYTES },
      );
    }
    let files: Record<string, string>;
    try {
      ({ files } = await ctx.extensionTransfers.runImporter(
        extensionId,
        importerId,
        input,
      ));
    } catch (error) {
      throw portFailure(error, 'import', extensionId, importerId);
    }
    requireOpen();
    return stage(importer, input.name, files);
  };

  /** Причина отказа перезагрузки: диагностики отклонённой версии (до отката: следующий `reload` их сбросит). */
  const reloadRejection = async (
    pendingImport: PendingImport,
    info: LibraryInfo,
  ): Promise<EngineError> => {
    const page = await library.getDiagnostics({
      minSeverity: 'error',
      limit: MAX_IMPORT_DIAGNOSTICS,
    });
    return failed(
      'import',
      pendingImport.extensionId,
      pendingImport.importerId,
      'reload-rejected',
      'Library reload rejected the imported course',
      { summary: info.diagnostics, diagnostics: page.items },
    );
  };

  /** Возвращает прежний каталог и прежнюю библиотеку; сбой отката только логируется. */
  const restore = async (dir: string, opId: string): Promise<void> => {
    try {
      await installer.rollback(ROOT, dir, opId);
      await library.reload();
    } catch (error) {
      ctx.logger.error({ error, dir }, 'import rollback failed');
    }
  };

  const commitImport: ExtensionsService['commitImport'] = async (
    importId,
  ): Promise<CommitImportResultDto> => {
    requireText(importId, 'importId');
    const entry = pending.get(importId);
    if (entry === undefined) {
      throw new EngineError('NOT_FOUND', { details: { importId } });
    }
    // с этого места импорт принадлежит команде: ни истечение, ни вытеснение его не тронут
    pending.delete(importId);
    const { dir, opId } = entry;
    try {
      requireOpen();
      const replaced = await installer.exists(ROOT, dir);
      let installed = false;
      try {
        await installer.install(ROOT, dir, opId);
        installed = true;
        const info = await library.reload();
        if (info.state === 'invalid' || info.diagnostics.errors > 0) {
          throw await reloadRejection(entry, info);
        }
      } catch (error) {
        if (installed) await restore(dir, opId);
        throw error;
      }
      return {
        path: installer.snapshotPath(ROOT, dir),
        replaced,
        courseIds: entry.courseIds,
      };
    } finally {
      await cleanup(opId);
    }
  };

  const discardImport: ExtensionsService['discardImport'] = async (
    importId,
  ) => {
    requireText(importId, 'importId');
    const entry = pending.get(importId);
    if (entry === undefined) return false;
    pending.delete(importId);
    await cleanup(entry.opId);
    return true;
  };

  /** Снимок курса и вид входа по запросу; область запроса должна совпасть с областью экспортёра. */
  const exportInput = async (
    exporter: ExporterContributionDto,
    request: ExportRequestDto,
  ): Promise<TransferExportInput> => {
    const scope =
      typeof request === 'object' && request !== null && 'scope' in request
        ? request.scope
        : undefined;
    if (scope !== exporter.scope) {
      throw invalid(
        'request',
        `exporter '${exporter.id}' takes the ${exporter.scope} scope`,
        'scope',
      );
    }
    if (request.scope === 'progress') return { scope: 'progress' };
    const { courseId } = request;
    if (typeof courseId !== 'string' || courseId === '') {
      throw invalid(
        'request',
        'courseId must be a non-empty string',
        'courseId',
      );
    }
    const course = ctx.library.require().getCourse(courseId);
    if (course === undefined) {
      throw new EngineError('NOT_FOUND', { details: { courseId } });
    }
    const { ignored_paths: ignoredPaths } =
      await ctx.settings.loadPreferences();
    let files: Record<string, string> | null;
    try {
      files = await readCourseSnapshot(
        ctx.courseSource,
        courseId,
        ignoredPaths,
      );
    } catch (error) {
      if (!(error instanceof CourseSnapshotTooLargeError)) throw error;
      throw failed(
        'export',
        exporter.extensionId,
        exporter.id,
        'too-large',
        error.message,
        { courseId },
        error,
      );
    }
    if (files === null) {
      throw new EngineError('NOT_FOUND', { details: { courseId } });
    }
    return { scope: 'course', courseId, title: course.name, files };
  };

  const runExporter: ExtensionsService['runExporter'] = async (
    extensionId,
    exporterId,
    request,
  ): Promise<ExportFileDto> => {
    if (!isExtensionId(extensionId)) {
      throw invalid(
        'extensionId',
        `Invalid extension id: ${String(extensionId)}`,
      );
    }
    requireText(exporterId, 'exporterId');
    const exporter = requireEntry<ExporterContributionDto>(
      'export',
      extensionId,
      exporterId,
    );
    const input = await exportInput(exporter, request);
    try {
      return await ctx.extensionTransfers.runExporter(
        extensionId,
        exporterId,
        input,
      );
    } catch (error) {
      throw portFailure(error, 'export', extensionId, exporterId);
    }
  };

  return {
    methods: { runImporter, commitImport, discardImport, runExporter },
    dispose: async () => {
      pending.clear();
      await Promise.all(cleanups);
    },
  };
};
