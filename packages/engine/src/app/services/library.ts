import type {
  CompileRequest,
  CompileResult,
  Diagnostic,
  DiagnosticSummary,
  LibraryInfo,
  LibraryService,
  Page,
  Severity,
  UnitKind,
  ValidateRequest,
  ValidateResult,
} from '@lms/engine-contract';
import { CONTRACT_VERSION } from '@lms/engine-contract';
import { sortDiagnostics, summarize } from '../../authoring/diagnostics.ts';
import { compile } from '../../authoring/compile.ts';
import type { CompileOptions } from '../../authoring/compile.ts';
import { probeArtifact } from '../../authoring/freshness.ts';
import { encodeArtifact } from '../../authoring/artifact.ts';
import { reloadLibrary } from '../../authoring/library-holder.ts';
import type { LibraryStatus } from '../../authoring/library-holder.ts';
import { readAsset } from '../../authoring/read-asset.ts';
import type { UnitType } from '../../domain/graph.ts';
import type { EngineContext } from '../context.ts';
import {
  toCourseDto,
  toExerciseDto,
  toGraphDto,
  toLessonDto,
  toUnitDto,
} from '../dto.ts';
import { EngineError } from '../errors.ts';
import { findOrphanDiagnostics } from '../orphans.ts';
import { paginate } from '../pagination.ts';
import { checkLibraryRoot, invalidStatus } from '../library-root.ts';

const SEVERITY_RANK: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const UNIT_TYPE_OF: Record<UnitKind, UnitType> = {
  course: 'Course',
  lesson: 'Lesson',
  exercise: 'Exercise',
};

const compare = (a: string, b: string) => Number(a > b) - Number(a < b);

const mapPage = <T, R>(page: Page<T>, map: (item: T) => R): Page<R> => ({
  ...page,
  items: page.items.map(map),
});

const invalidArgument = (message: string, field: string) =>
  new EngineError('INVALID_ARGUMENT', { message, details: { field } });

const filterBySeverity = (
  diagnostics: readonly Diagnostic[],
  minSeverity: Severity | undefined,
): Diagnostic[] => {
  if (minSeverity === undefined) return [...diagnostics];
  if (!Object.hasOwn(SEVERITY_RANK, minSeverity)) {
    throw invalidArgument(`Unknown severity: ${minSeverity}`, 'minSeverity');
  }
  const limit = SEVERITY_RANK[minSeverity];
  return diagnostics.filter(({ severity }) => SEVERITY_RANK[severity] <= limit);
};

/** Разделитель идентификатора снимка и курсора страницы (не base64url). */
const SNAPSHOT_SEPARATOR = '~';

interface ValidationSnapshot {
  id: string;
  diagnostics: Diagnostic[];
  revision: string;
  summary: DiagnosticSummary;
  checksRun: boolean;
}

/** Попытка `reload`, не заменившая библиотеку: её диагностики видны в `getDiagnostics`. */
interface RejectedReload {
  base: LibraryStatus;
  status: LibraryStatus;
}

/**
 * `library.*` (engine-ts-api.md §3): чтения библиотеки идут через
 * `ctx.library`; `validate` и `compile` граф не подменяют, `reload` меняет его
 * атомарно и сбрасывает производные проекции.
 */
export const createLibraryService = (ctx: EngineContext): LibraryService => {
  let snapshot: ValidationSnapshot | null = null;
  let rejected: RejectedReload | null = null;

  const requireStatus = (): LibraryStatus => {
    const status = ctx.library.current();
    if (status === null) throw new EngineError('LIBRARY_NOT_LOADED');
    return status;
  };

  /** Диагностики последней попытки `reload`: загруженной или отклонённой версии. */
  const latestStatus = (): LibraryStatus => {
    const current = requireStatus();
    return rejected !== null && rejected.base === current
      ? rejected.status
      : current;
  };

  const orphansOf = (): Diagnostic[] => {
    const { library } = requireStatus();
    return library === null
      ? []
      : findOrphanDiagnostics(ctx.projections.attempts.seenUnitIds(), library);
  };

  const effectiveSummary = (): DiagnosticSummary => {
    const { summary } = latestStatus();
    return {
      ...summary,
      warnings: summary.warnings + orphansOf().length,
    };
  };

  const compileOptions = async (
    runChecks: boolean,
  ): Promise<CompileOptions> => {
    const { ignored_paths: ignoredPaths } =
      await ctx.settings.loadPreferences();
    return {
      emit: 'always',
      scan: { ignoredPaths },
      checks: { exerciseTypes: ctx.exerciseTypes },
      ...(runChecks ? { runChecks: { exerciseTypes: ctx.exerciseTypes } } : {}),
    };
  };

  const getInfo = async (): Promise<LibraryInfo> => {
    const status = requireStatus();
    const { library } = status;
    return {
      contractVersion: CONTRACT_VERSION,
      root: ctx.courseSource.root,
      revision: status.revision,
      state: status.state,
      artifact: status.artifact,
      counts: {
        courses: library?.courses.size ?? 0,
        lessons: library?.lessons.size ?? 0,
        exercises: library?.exercises.size ?? 0,
        dependencyEdges: library?.graph.dependencyEdgeCount() ?? 0,
      },
      diagnostics: effectiveSummary(),
      loadedAt: status.loadedAt,
      loadMs: status.loadMs,
    };
  };

  const getDiagnostics: LibraryService['getDiagnostics'] = async (req = {}) => {
    const { minSeverity, ...pageRequest } = req;
    const all = sortDiagnostics([
      ...latestStatus().diagnostics,
      ...orphansOf(),
    ]);
    return paginate(filterBySeverity(all, minSeverity), pageRequest);
  };

  const innerCursor = (cursor: string, current: ValidationSnapshot): string => {
    const separator = cursor.indexOf(SNAPSHOT_SEPARATOR);
    const isCurrent =
      separator > 0 && cursor.slice(0, separator) === current.id;
    if (!isCurrent) {
      throw invalidArgument(
        'Cursor belongs to a previous validate result',
        'cursor',
      );
    }
    return cursor.slice(separator + 1);
  };

  const pageOfSnapshot = (
    current: ValidationSnapshot,
    req: ValidateRequest,
  ): ValidateResult => {
    const { minSeverity, limit, cursor } = req;
    const inner =
      cursor === undefined ? undefined : innerCursor(cursor, current);
    const page = paginate(filterBySeverity(current.diagnostics, minSeverity), {
      ...(limit === undefined ? {} : { limit }),
      ...(inner === undefined ? {} : { cursor: inner }),
    });
    return {
      items: page.items,
      ...(page.nextCursor === undefined
        ? {}
        : {
            nextCursor: `${current.id}${SNAPSHOT_SEPARATOR}${page.nextCursor}`,
          }),
      revision: current.revision,
      summary: current.summary,
      checksRun: current.checksRun,
    };
  };

  const validate = async (
    req: ValidateRequest = {},
  ): Promise<ValidateResult> => {
    if (req.cursor !== undefined) {
      if (snapshot === null) {
        throw invalidArgument('No validate result to continue', 'cursor');
      }
      return pageOfSnapshot(snapshot, req);
    }
    const rootProblem = await checkLibraryRoot(ctx.courseSource);
    if (rootProblem !== null) {
      snapshot = {
        id: ctx.ids.next(),
        diagnostics: [rootProblem],
        revision: '',
        summary: summarize([rootProblem]),
        checksRun: false,
      };
      return pageOfSnapshot(snapshot, req);
    }
    const runChecks = req.runChecks === true;
    const result = await compile(
      ctx.courseSource,
      await compileOptions(runChecks),
    );
    snapshot = {
      id: ctx.ids.next(),
      diagnostics: result.diagnostics,
      revision: result.artifact?.revision ?? '',
      summary: result.summary,
      checksRun: runChecks,
    };
    return pageOfSnapshot(snapshot, req);
  };

  /** Файл артефакта теперь соответствует загруженной библиотеке; граф остаётся прежним. */
  const markArtifactFresh = (revision: string) => {
    const current = ctx.library.current();
    if (current === null || current.revision !== revision) return;
    const next: LibraryStatus = { ...current, artifact: 'fresh' };
    ctx.library.swap(next);
    if (rejected !== null && rejected.base === current) rejected.base = next;
  };

  const compileLibrary = async (
    req: CompileRequest = {},
  ): Promise<CompileResult> => {
    const rootProblem = await checkLibraryRoot(ctx.courseSource);
    if (rootProblem !== null) {
      const summary = summarize([rootProblem]);
      ctx.emit({
        type: 'library-compiled',
        revision: '',
        artifactWritten: false,
        errors: summary.errors,
        warnings: summary.warnings,
      });
      return {
        revision: '',
        diagnosticsSummary: summary,
        artifactWritten: false,
      };
    }
    const runChecks = req.runChecks === true;
    const options = await compileOptions(runChecks);
    const probe = await probeArtifact(ctx.courseSource, options);
    const fresh = probe.artifact;
    if (fresh !== null && !runChecks) {
      const summary = fresh.diagnostics.summary;
      ctx.emit({
        type: 'library-compiled',
        revision: fresh.revision,
        artifactWritten: false,
        errors: summary.errors,
        warnings: summary.warnings,
      });
      return {
        revision: fresh.revision,
        diagnosticsSummary: summary,
        artifactWritten: false,
      };
    }
    const result = await compile(ctx.courseSource, options);
    const { artifact, summary } = result;
    const artifactWritten =
      fresh === null && artifact !== null && summary.errors === 0;
    if (artifactWritten) {
      await ctx.courseSource.writeArtifact(encodeArtifact(artifact));
      markArtifactFresh(artifact.revision);
    }
    const revision = artifact?.revision ?? '';
    ctx.emit({
      type: 'library-compiled',
      revision,
      artifactWritten,
      errors: summary.errors,
      warnings: summary.warnings,
    });
    return { revision, diagnosticsSummary: summary, artifactWritten };
  };

  /** Пропавший корень: рабочая библиотека остаётся, иначе — состояние `invalid`. */
  const rejectMissingRoot = (problem: Diagnostic) => {
    const status = invalidStatus(problem, ctx.clock);
    if (ctx.library.current()?.state === 'ready') {
      return { swapped: false, status };
    }
    ctx.library.swap(status);
    return { swapped: true, status };
  };

  const reload = async (): Promise<LibraryInfo> => {
    const { ignored_paths: ignoredPaths } =
      await ctx.settings.loadPreferences();
    const rootProblem = await checkLibraryRoot(ctx.courseSource);
    const { swapped, status } =
      rootProblem === null
        ? await reloadLibrary(
            ctx.library,
            ctx.courseSource,
            { clock: ctx.clock },
            {
              compile: {
                scan: { ignoredPaths },
                checks: { exerciseTypes: ctx.exerciseTypes },
              },
            },
          )
        : rejectMissingRoot(rootProblem);
    const current = requireStatus();
    if (swapped) {
      rejected = null;
      ctx.invalidateDerived();
    } else {
      rejected = { base: current, status };
    }
    const info = await getInfo();
    ctx.emit({
      type: 'library-reloaded',
      revision: info.revision,
      errors: info.diagnostics.errors,
      warnings: info.diagnostics.warnings,
    });
    return info;
  };

  const requireCourse = (courseId: string) => {
    const library = ctx.library.require();
    if (library.getCourse(courseId) === undefined) {
      throw new EngineError('NOT_FOUND', { details: { unitId: courseId } });
    }
    return library;
  };

  const listCourses: LibraryService['listCourses'] = async (req) => {
    const library = ctx.library.require();
    const page = paginate(library.getCourseIds(), req);
    return mapPage(page, (id) =>
      toCourseDto(
        library.courses.get(id)!,
        library.getLessonIds(id)?.length ?? 0,
      ),
    );
  };

  const listLessons: LibraryService['listLessons'] = async (courseId, req) => {
    const library = requireCourse(courseId);
    const page = paginate(library.getLessonIds(courseId) ?? [], req);
    return mapPage(page, (id) =>
      toLessonDto(
        library.lessons.get(id)!,
        library.getExerciseIds(id)?.length ?? 0,
      ),
    );
  };

  const listExercises: LibraryService['listExercises'] = async (
    lessonId,
    req,
  ) => {
    const library = ctx.library.require();
    if (library.getLesson(lessonId) === undefined) {
      throw new EngineError('NOT_FOUND', { details: { unitId: lessonId } });
    }
    const page = paginate(library.getExerciseIds(lessonId) ?? [], req);
    return mapPage(page, (id) =>
      toExerciseDto(library.exercises.get(id)!, ctx.exerciseTypes),
    );
  };

  const matchPrefix: LibraryService['matchPrefix'] = async (
    prefix,
    kind,
    req,
  ) => {
    if (kind !== undefined && !Object.hasOwn(UNIT_TYPE_OF, kind)) {
      throw invalidArgument(`Unknown unit kind: ${String(kind)}`, 'kind');
    }
    const library = ctx.library.require();
    const ids = library.getMatchingPrefix(
      prefix,
      kind === undefined ? undefined : UNIT_TYPE_OF[kind],
    );
    return paginate([...ids].sort(compare), req);
  };

  return {
    getInfo,
    getDiagnostics,
    validate,
    compile: compileLibrary,
    reload,
    listCourses,
    listLessons,
    listExercises,
    getUnit: async (id) =>
      toUnitDto(ctx.library.require(), id, ctx.exerciseTypes),
    matchPrefix,
    getGraph: async (query) => toGraphDto(ctx.library.require(), query),
    readAsset: async (ref) =>
      readAsset(ctx.courseSource, ctx.library.require(), ref),
  };
};
