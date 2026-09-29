import { MAX_SQL_CHARS } from '@lms/engine-contract';
import type {
  AttemptRecordDto,
  BatchDto,
  BatchRequest,
  CompleteAttemptRequest,
  DueRequest,
  FrontierRequest,
  Grade,
  ItemReason,
  PracticeService,
  ProgressQuery,
  RecordAttemptRequest,
  RecordResultDto,
  SubmitAnswerRequest,
  UnitId,
  VerdictDto,
} from '@lms/engine-contract';
import type { ExerciseManifest } from '../../domain/manifest.ts';
import type { RawVerdict } from '../../ports/index.ts';
import { SchedulerError } from '../../scheduler/types.ts';
import { countGradedVerdicts } from '../../verify/grade-policy.ts';
import type { EngineContext } from '../context.ts';
import { DEFAULT_VERIFICATION_TIMEOUT_MS, toExerciseDto } from '../dto.ts';
import { EngineError } from '../errors.ts';
import { paginate } from '../pagination.ts';
import { createProgressReader } from '../progress.ts';

/** Запас к `timeoutMs` раннера: ожидание в очереди пула входит в дедлайн вызова (engine-ts-api.md §8) [ВЫВОД]. */
export const VERIFIER_DEADLINE_GRACE_MS = 5_000;

const GRADES: ReadonlySet<unknown> = new Set([1, 2, 3, 4, 5]);
const SOURCES: ReadonlySet<unknown> = new Set([
  'self',
  'runner',
  'placement',
  'trane-import',
]);

const invalid = (details: Record<string, unknown>) =>
  new EngineError('INVALID_ARGUMENT', { details });

const requireText = (name: string, value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid({ [name]: value });
  }
  return value;
};

/** Ошибки данных планировщика — операционные; баги остаются обычными исключениями. */
const mapSchedulerError = (error: unknown): unknown => {
  if (!(error instanceof SchedulerError)) return error;
  const details = { ...error.details, reason: error.code };
  if (error.code === 'FILTER_ON_EXERCISE') {
    return new EngineError('INVALID_ARGUMENT', { details, cause: error });
  }
  if (error.code === 'SCORER_FAILED') return error;
  return new EngineError('NOT_FOUND', { details, cause: error });
};

interface BatchItem {
  manifest: ExerciseManifest;
  reason: ItemReason;
}

/**
 * Практика (engine-ts-api.md §4). `recordAttempt` — единственный путь записи
 * попытки; шаги 1–6 повторяют «Поток записи попытки» engine-ts.md §4.
 */
export const createPracticeService = (ctx: EngineContext): PracticeService => {
  const { clock, ids, library, projections, session, attempts } = ctx;
  const progress = createProgressReader(ctx);
  let sessionId: string | null = null;

  /** Повтор `requestId`: прежний результат без ремедиации, оценки — по текущему состоянию. */
  const replayDuplicate = async (requestId: string) => {
    const known = await ctx.eventStore.transact((tx) => tx.findById(requestId));
    if (known === null || known.kind !== 'attempt') {
      throw invalid({
        requestId,
        reason: 'request id is used by another entry',
      });
    }
    const result: RecordResultDto = {
      eventId: known.id,
      exerciseId: known.exerciseId,
      grade: known.grade,
      at: known.at,
      duplicate: true,
      affected: library.current()?.library?.hasExercise(known.exerciseId)
        ? progress.scoresOfExercise(known.exerciseId)
        : [],
    };
    return result;
  };

  const recordAttempt = async (
    request: RecordAttemptRequest,
  ): Promise<RecordResultDto> => {
    const started = performance.now();
    const requestId = requireText('requestId', request.requestId);
    const { exerciseId, grade, at, source = 'self' } = request;
    const graph = library.require(); // LIBRARY_NOT_LOADED | LIBRARY_INVALID
    // шаг 1: проверка
    if (!GRADES.has(grade)) throw invalid({ grade });
    if (!SOURCES.has(source)) throw invalid({ source });
    if (at !== undefined && !Number.isSafeInteger(at)) throw invalid({ at });
    if (typeof exerciseId !== 'string' || !graph.hasExercise(exerciseId)) {
      throw new EngineError('NOT_FOUND', { details: { exerciseId } });
    }
    // шаги 2–3: событие (seq, HLC-`at`) и `append` в одной транзакции
    // шаг 4–5: проекции и кэши скорера обновляет `commit`
    const { appended, duplicates, affectedUnitIds } = await ctx.commit([
      {
        fields: { kind: 'attempt', exerciseId, grade, source },
        id: requestId,
        ...(at !== undefined && { at }),
      },
    ]);
    const [entry] = appended;
    if (entry === undefined || entry.kind !== 'attempt') {
      if (!duplicates.includes(requestId)) {
        throw new Error(`recordAttempt: nothing appended for ${requestId}`);
      }
      return replayDuplicate(requestId);
    }
    session.noteResult(exerciseId, entry.grade);
    const remediation = projections.remediation.onAttempt(entry);
    // шаг 6: события уходят после команды (`bus.flush` фасада)
    ctx.emit({ type: 'progress', unitIds: affectedUnitIds, at: entry.at });
    if (remediation !== null) {
      ctx.emit({
        type: 'remediation-triggered',
        exerciseId,
        steps: remediation.steps.length,
        at: entry.at,
      });
    }
    ctx.metrics.record('recordAttempt', performance.now() - started);
    return {
      eventId: entry.id,
      exerciseId,
      grade: entry.grade,
      at: entry.at,
      duplicate: false,
      affected: progress.scoresOfExercise(exerciseId),
      ...(remediation !== null && { remediation }),
    };
  };

  const startSession = async () => {
    session.reset();
    sessionId = ids.next();
    return { sessionId, startedAt: clock.now() };
  };

  const getBatch = async (req: BatchRequest = {}): Promise<BatchDto> => {
    const started = performance.now();
    const graph = library.require();
    sessionId ??= ids.next();
    let manifests: ExerciseManifest[];
    try {
      manifests = ctx.scheduler.getExerciseBatch(req.filter);
    } catch (error) {
      throw mapSchedulerError(error);
    }
    const { attempts: index } = projections;
    let items: BatchItem[] = manifests.map((manifest) => ({
      manifest,
      reason: index.count(manifest.id) > 0 ? 'review' : 'new',
    }));
    // ремедиация встаёт перед новым материалом и вытесняет самые
    // низкоприоритетные новые; с явным фильтром область не расширяется
    if (req.filter === undefined) {
      const inserted = projections.remediation
        .pendingExerciseIds()
        .flatMap((id) => graph.getExercise(id) ?? []);
      if (inserted.length > 0) {
        const insertedIds = new Set(inserted.map(({ id }) => id));
        const rest = items.filter(
          ({ manifest }) => !insertedIds.has(manifest.id),
        );
        for (const { id } of inserted) session.incrementFrequency(id);
        items = [
          ...inserted.map((manifest): BatchItem => ({
            manifest,
            reason: 'remediation',
          })),
          ...rest,
        ];
        for (
          let i = items.length - 1;
          i >= 0 && items.length > manifests.length;
          i--
        ) {
          if ((items[i] as BatchItem).reason === 'new') items.splice(i, 1);
        }
      }
    }
    ctx.metrics.record('batch', performance.now() - started);
    return {
      exercises: items.map(({ manifest }) => toExerciseDto(manifest)),
      reasons: items.map(({ reason }) => reason),
      generatedAt: clock.now(),
      sessionId,
    };
  };

  const beginAttempt = async ({ exerciseId }: { exerciseId: UnitId }) => {
    const exercise = library.require().getExercise(exerciseId);
    if (exercise === undefined) {
      throw new EngineError('NOT_FOUND', { details: { exerciseId } });
    }
    const attemptId = ids.next();
    const verifiable = exercise.engine?.verification !== undefined;
    const startedAt = clock.now();
    attempts.set(attemptId, {
      attemptId,
      exerciseId,
      verifiable,
      startedAt,
      verdicts: [],
      busy: false,
      result: null,
    });
    return {
      attemptId,
      exercise: toExerciseDto(exercise),
      startedAt,
      verifiable,
    };
  };

  const openAttempt = (attemptId: string) => {
    const attempt = attempts.get(requireText('attemptId', attemptId));
    if (attempt === undefined) {
      throw new EngineError('ATTEMPT_NOT_FOUND', { details: { attemptId } });
    }
    return attempt;
  };

  const oversizedVerdict = (
    attemptId: string,
    attemptsUsed: number,
  ): VerdictDto => ({
    outcome: 'failed',
    reason: 'sqlite_limit',
    attemptId,
    attemptsUsed,
    durationMs: 0,
  });

  /** Вердикт раннера или дедлайн вызова (`VERIFIER_TIMEOUT`). */
  const checkWithDeadline = async (
    check: Promise<RawVerdict>,
    timeoutMs: number,
    attemptId: string,
  ) => {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new EngineError('VERIFIER_TIMEOUT', {
              details: { attemptId, timeoutMs },
            }),
          ),
        timeoutMs + VERIFIER_DEADLINE_GRACE_MS,
      );
    });
    try {
      return await Promise.race([check, deadline]);
    } finally {
      clearTimeout(timer);
    }
  };

  const submitAnswer = async ({
    attemptId,
    submission,
  }: SubmitAnswerRequest): Promise<VerdictDto> => {
    const attempt = openAttempt(attemptId);
    if (attempt.result !== null) {
      throw new EngineError('ATTEMPT_CLOSED', { details: { attemptId } });
    }
    if (!attempt.verifiable || attempt.busy) {
      throw invalid({
        attemptId,
        reason: attempt.busy ? 'busy' : 'not verifiable',
      });
    }
    const exercise = library.require().getExercise(attempt.exerciseId);
    const verification = exercise?.engine?.verification;
    if (exercise === undefined || verification === undefined) {
      throw new EngineError('NOT_FOUND', {
        details: { exerciseId: attempt.exerciseId },
      });
    }
    const { runner } = verification;
    const timeoutMs = verification.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
    const verifier = ctx.verifiers.get(runner); // Strategy через Map
    if (verifier === undefined) {
      throw new EngineError('VERIFIER_UNAVAILABLE', {
        details: { cause: 'no-runner', runner },
        retryable: false,
      });
    }
    const used = countGradedVerdicts(attempt.verdicts);
    // кап хоста до раннера: длиннее — `failed/sqlite_limit` без запуска
    if (submission.kind === 'sql' && submission.sql.length > MAX_SQL_CHARS) {
      const verdict = oversizedVerdict(attemptId, used + 1);
      attempt.verdicts.push(verdict);
      return verdict;
    }
    attempt.busy = true; // критическая секция вокруг await: один вердикт за раз
    try {
      const raw = await checkWithDeadline(
        verifier.check({
          exercise,
          submission,
          timeoutMs,
          authorMode: ctx.config.authorMode ?? false,
        }),
        timeoutMs,
        attemptId,
      );
      const attemptsUsed = raw.outcome === 'error' ? used : used + 1;
      const verdict = { ...raw, attemptId, attemptsUsed } as VerdictDto;
      if (verdict.outcome === 'failed' && ctx.config.authorMode !== true) {
        delete verdict.detail;
      }
      if (verdict.outcome !== 'error') attempt.verdicts.push(verdict); // error не пишется
      return verdict;
    } finally {
      attempt.busy = false;
    }
  };

  const completeAttempt = async ({
    attemptId,
    grade,
    outcome,
  }: CompleteAttemptRequest): Promise<RecordResultDto> => {
    const attempt = openAttempt(attemptId);
    if (attempt.result !== null) return { ...attempt.result, duplicate: true };
    if (attempt.busy) throw invalid({ attemptId, reason: 'busy' });
    if (grade !== undefined && !GRADES.has(grade)) throw invalid({ grade });
    if (outcome !== undefined && outcome !== 'gave-up')
      throw invalid({ outcome });
    const gaveUp = outcome === 'gave-up';
    const derived =
      attempt.verifiable || gaveUp
        ? ctx.gradePolicy({ verdicts: attempt.verdicts, gaveUp })
        : null;
    const finalGrade: Grade | null = derived ?? grade ?? null;
    if (finalGrade === null) {
      throw invalid({ attemptId, need: 'grade' });
    }
    const result = await recordAttempt({
      requestId: attemptId, // идемпотентность по attemptId
      exerciseId: attempt.exerciseId,
      grade: finalGrade,
      source: attempt.verifiable && derived !== null ? 'runner' : 'self',
    });
    attempt.result = result;
    return result;
  };

  const getUnitScore = async (unitId: UnitId) => progress.unitScore(unitId);

  const getAttempts = async (
    exerciseId: UnitId,
    req?: Parameters<PracticeService['getAttempts']>[1],
  ) => {
    if (!library.require().hasExercise(exerciseId)) {
      throw new EngineError('NOT_FOUND', { details: { exerciseId } });
    }
    const records = projections.attempts
      .getRecords(exerciseId)
      .map(({ id, grade, at, source }): AttemptRecordDto => ({
        eventId: id,
        exerciseId,
        grade,
        at,
        source,
      }));
    return paginate(records, req);
  };

  const getProgress = async (
    query: ProgressQuery = {},
    req?: Parameters<PracticeService['getProgress']>[1],
  ) => paginate(progress.progress(query), req);

  const getFrontier = async (req: FrontierRequest = {}) => {
    const { courseId } = req;
    if (
      courseId !== undefined &&
      library.require().getCourse(courseId) === undefined
    ) {
      throw new EngineError('NOT_FOUND', { details: { courseId } });
    }
    return paginate(ctx.getFrontier(courseId), req);
  };

  const getDue = async (req: DueRequest = {}) => {
    const { minNeed } = req;
    if (
      minNeed !== undefined &&
      !(Number.isFinite(minNeed) && minNeed >= 0 && minNeed <= 1)
    ) {
      throw invalid({ minNeed });
    }
    return paginate(ctx.getDue(minNeed), req);
  };

  const resetProgress = async ({
    unitId,
    requestId,
  }: {
    unitId: UnitId;
    requestId: string;
  }) => {
    requireText('requestId', requestId);
    const graph = library.require();
    if (graph.graph.getUnitType(unitId) === undefined) {
      throw new EngineError('NOT_FOUND', { details: { unitId } });
    }
    const revision = library.current()?.revision ?? '';
    const { appended, duplicates } = await ctx.commit([
      {
        fields: {
          kind: 'progress_reset',
          unitId,
          ...(revision !== '' && { libraryRevision: revision }),
        },
        id: requestId,
      },
    ]);
    const [entry] = appended;
    if (entry === undefined) {
      if (!duplicates.includes(requestId)) {
        throw new Error(`resetProgress: nothing appended for ${requestId}`);
      }
      return { eventId: requestId, duplicate: true };
    }
    // оценки меняются у самого юнита, вложенных и охватывающих
    const unitIds = [
      unitId,
      ...graph.graph.getContainers(unitId),
      ...graph.graph.getExercisesUnder(unitId).filter((id) => id !== unitId),
    ];
    ctx.emit({
      type: 'progress',
      unitIds: [...new Set(unitIds)],
      at: entry.at,
    });
    return { eventId: entry.id, duplicate: false };
  };

  return Object.freeze({
    startSession,
    getBatch,
    beginAttempt,
    submitAnswer,
    completeAttempt,
    recordAttempt,
    getUnitScore,
    getAttempts,
    getProgress,
    getFrontier,
    getDue,
    resetProgress,
  });
};
