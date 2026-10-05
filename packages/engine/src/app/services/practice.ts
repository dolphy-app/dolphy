import { MAX_ANSWER_CHARS } from '@dolphy-app/engine-contract';
import type {
  AttemptOutcome,
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
  RetractRequest,
  RetractResult,
  SubmitAnswerRequest,
  UnitId,
  VerdictDto,
} from '@dolphy-app/engine-contract';
import type { ExerciseManifest } from '../../domain/manifest.ts';
import type { OpenAttempt } from '../context.ts';
import { SchedulerError } from '../../scheduler/types.ts';
import {
  GRADE_POLICIES,
  countGradedVerdicts,
  resolveGradePolicy,
} from '../../verify/grade-policy.ts';
import { resolveCourseScope } from '../course-scope.ts';
import type { EngineContext } from '../context.ts';
import { ExerciseTypeError } from '../../ports/exercise-types.ts';
import { DEFAULT_EXERCISE_TIMEOUT_MS, toExerciseDto } from '../dto.ts';
import { EngineError } from '../errors.ts';
import { paginate } from '../pagination.ts';
import { createProgressReader } from '../progress.ts';
import { commitProgressResets } from '../progress-reset.ts';

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

/** Сколько открытых сессий помнит движок: окно заканчивает последние, старые безнадёжно потеряны. */
const MAX_OPEN_SESSIONS = 16;

/**
 * Итог попытки для события `attempt.closed`: сдался — `gave-up`; проверка
 * шла — `passed`, если хоть один вердикт прошёл, иначе `failed` (оценку после
 * неудачи мог поставить сам ученик); проверки не было — `self-assessed`.
 */
const outcomeOf = (attempt: OpenAttempt, gaveUp: boolean): AttemptOutcome => {
  if (gaveUp) return 'gave-up';
  if (!attempt.verifiable || attempt.verdicts.length === 0) {
    return 'self-assessed';
  }
  return attempt.verdicts.some(({ outcome }) => outcome === 'passed')
    ? 'passed'
    : 'failed';
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
  /** Выданные и ещё не законченные `finishSession` сессии: событие `session.finished` — один раз на id. */
  const openSessions = new Set<string>();

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

  /** `outcome` — для события `attempt.closed`; в журнал и контракт запроса не попадает. */
  const record = async (
    request: RecordAttemptRequest,
    outcome: AttemptOutcome,
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
    // дубликат вернулся выше, импорт и синхронизация сюда не заходят: событие — ровно на записанную попытку
    const exercise = graph.getExercise(exerciseId);
    if (exercise !== undefined) {
      ctx.emitLearning({
        name: 'attempt.closed',
        payload: {
          exerciseId,
          courseId: exercise.course_id,
          lessonId: exercise.lesson_id,
          grade: entry.grade,
          outcome,
          source: entry.source,
          at: entry.at,
        },
      });
    }
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

  /** Новая сессия движка: `session.started` уходит вместе с ответом команды. */
  const openSession = (): string => {
    const id = ids.next();
    sessionId = id;
    openSessions.add(id);
    if (openSessions.size > MAX_OPEN_SESSIONS) {
      const [oldest] = openSessions;
      if (oldest !== undefined) openSessions.delete(oldest);
    }
    ctx.emitLearning({
      name: 'session.started',
      payload: { sessionId: id, at: clock.now() },
    });
    return id;
  };

  const startSession = async () => {
    session.reset();
    const id = openSession();
    return { sessionId: id, startedAt: clock.now() };
  };

  const finishSession = async ({
    sessionId: finishing,
  }: {
    sessionId: string;
  }) => {
    requireText('sessionId', finishing);
    if (!openSessions.delete(finishing)) return { emitted: false };
    if (sessionId === finishing) sessionId = null; // следующий `getBatch` начнёт новую
    ctx.emitLearning({
      name: 'session.finished',
      payload: { sessionId: finishing, at: clock.now() },
    });
    return { emitted: true };
  };

  const getBatch = async (req: BatchRequest = {}): Promise<BatchDto> => {
    const started = performance.now();
    const graph = library.require();
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
    // идентификатор — после успешной сборки пачки: сбой команды сбросил бы событие, а id остался
    const batchSession = sessionId ?? openSession();
    return {
      exercises: items.map(({ manifest }) =>
        toExerciseDto(manifest, ctx.exerciseTypes, ctx.extensionPolicy),
      ),
      reasons: items.map(({ reason }) => reason),
      generatedAt: clock.now(),
      sessionId: batchSession,
    };
  };

  const unavailable = (error: ExerciseTypeError) =>
    new EngineError('EXERCISE_TYPE_UNAVAILABLE', {
      details: { cause: error.cause, type: error.type },
      cause: error,
    });

  const beginAttempt = async ({ exerciseId }: { exerciseId: UnitId }) => {
    const exercise = library.require().getExercise(exerciseId);
    if (exercise === undefined) {
      throw new EngineError('NOT_FOUND', { details: { exerciseId } });
    }
    const block = exercise.engine?.exercise;
    const verifiable = block !== undefined;
    let view: unknown = null;
    if (block !== undefined) {
      if (ctx.exerciseTypes.describe(block.type) === undefined) {
        throw new EngineError('EXERCISE_TYPE_UNAVAILABLE', {
          details: { cause: 'unknown-type', type: block.type },
          retryable: false,
        });
      }
      try {
        view = await ctx.exerciseTypes.project({
          type: block.type,
          exerciseId,
          spec: block.spec ?? {},
        });
      } catch (error) {
        if (error instanceof ExerciseTypeError) throw unavailable(error);
        throw error;
      }
    }
    const attemptId = ids.next();
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
      exercise: toExerciseDto(exercise, ctx.exerciseTypes, ctx.extensionPolicy),
      startedAt,
      verifiable,
      view: view ?? null,
    };
  };

  const openAttempt = (attemptId: string) => {
    const attempt = attempts.get(requireText('attemptId', attemptId));
    if (attempt === undefined) {
      throw new EngineError('ATTEMPT_NOT_FOUND', { details: { attemptId } });
    }
    return attempt;
  };

  const submitAnswer = async ({
    attemptId,
    answer,
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
    const block = exercise?.engine?.exercise;
    if (exercise === undefined || block === undefined) {
      throw new EngineError('NOT_FOUND', {
        details: { exerciseId: attempt.exerciseId },
      });
    }
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(answer);
    } catch {
      serialized = undefined;
    }
    if (serialized === undefined) {
      throw invalid({ attemptId, reason: 'answer-not-json' });
    }
    if (serialized.length > MAX_ANSWER_CHARS) {
      throw invalid({ attemptId, reason: 'answer-too-large' });
    }
    const issues = ctx.exerciseTypes.validateAnswer(block.type, answer);
    if (issues.length > 0) {
      throw invalid({ attemptId, reason: 'answer', issues });
    }
    const used = countGradedVerdicts(attempt.verdicts);
    attempt.busy = true; // критическая секция вокруг await: один вердикт за раз
    try {
      const raw = await ctx.exerciseTypes.grade({
        type: block.type,
        exerciseId: attempt.exerciseId,
        spec: block.spec ?? {},
        answer,
        timeoutMs: block.timeoutMs ?? DEFAULT_EXERCISE_TIMEOUT_MS,
        authorMode: ctx.config.authorMode ?? false,
      });
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
        ? await resolveGradePolicy({
            selectedId: ctx.learning.gradePolicy,
            builtin: GRADE_POLICIES,
            remote: ctx.gradePolicies,
            logger: ctx.logger,
          })({ verdicts: attempt.verdicts, gaveUp })
        : null;
    const finalGrade: Grade | null = derived ?? grade ?? null;
    if (finalGrade === null) {
      throw invalid({ attemptId, need: 'grade' });
    }
    const result = await record(
      {
        requestId: attemptId, // идемпотентность по attemptId
        exerciseId: attempt.exerciseId,
        grade: finalGrade,
        source: attempt.verifiable && derived !== null ? 'runner' : 'self',
      },
      outcomeOf(attempt, gaveUp),
    );
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
    const { minNeed, courseIds } = req;
    if (
      minNeed !== undefined &&
      !(Number.isFinite(minNeed) && minNeed >= 0 && minNeed <= 1)
    ) {
      throw invalid({ minNeed });
    }
    const scope = resolveCourseScope(ctx.library.require(), courseIds);
    const due = ctx.getDue(minNeed);
    return paginate(
      scope === null
        ? due
        : due.filter(({ lessonId }) => scope.hasLesson(lessonId)),
      req,
    );
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
    const { appended, duplicates } = await commitProgressResets(ctx, [
      { unitId, id: requestId },
    ]);
    const [entry] = appended;
    if (entry === undefined) {
      if (!duplicates.includes(requestId)) {
        throw new Error(`resetProgress: nothing appended for ${requestId}`);
      }
      return { eventId: requestId, duplicate: true };
    }
    return { eventId: entry.id, duplicate: false };
  };

  /**
   * `undo` (`set`) и `redo` (`unset`): запись `retract` по `targetId`. Журнал
   * не редактируется; состояние цели не меняется — запись не пишется.
   */
  const retract = async (
    op: 'set' | 'unset',
    { targetId, requestId }: RetractRequest,
  ): Promise<RetractResult> => {
    requireText('targetId', targetId);
    requireText('requestId', requestId);
    library.require();
    const known = await ctx.eventStore.transact((tx) => tx.findById(requestId));
    if (known !== null) {
      if (
        known.kind !== 'retract' ||
        known.targetId !== targetId ||
        known.op !== op
      ) {
        throw invalid({
          requestId,
          reason: 'request id is used by another entry',
        });
      }
      return { eventId: known.id, duplicate: true, changed: true };
    }
    if (projections.attempts.exercisesOf(targetId).length === 0) {
      const other = await ctx.eventStore.transact((tx) =>
        tx.findById(targetId),
      );
      if (other !== null) {
        throw invalid({ targetId, reason: 'target is not an attempt' });
      }
      throw new EngineError('NOT_FOUND', { details: { targetId } });
    }
    if (projections.attempts.isTargetRetracted(targetId) === (op === 'set')) {
      return { eventId: null, duplicate: false, changed: false };
    }
    const { appended, affectedUnitIds } = await ctx.commit([
      { fields: { kind: 'retract', targetId, op }, id: requestId },
    ]);
    const [entry] = appended;
    if (entry === undefined) {
      throw new Error(`retract: nothing appended for ${requestId}`);
    }
    ctx.emit({
      type: 'progress',
      unitIds: affectedUnitIds,
      at: entry.at,
    });
    return { eventId: entry.id, duplicate: false, changed: true };
  };

  /** Прямая запись оценки без открытой попытки: проверки не было, оценку поставил ученик. */
  const recordAttempt = (request: RecordAttemptRequest) =>
    record(request, 'self-assessed');

  return Object.freeze({
    startSession,
    finishSession,
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
    undo: (request: RetractRequest) => retract('set', request),
    redo: (request: RetractRequest) => retract('unset', request),
  });
};
