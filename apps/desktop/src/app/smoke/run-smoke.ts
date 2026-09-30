/**
 * Сквозная проверка в настоящем Electron (смоук-сборка, `LMS_SMOKE=1`):
 * renderer → preload → main → utilityProcess → движок → хост расширений
 * (`lms.sql`, `lms.choice`). Библиотеки — `sql-course` и `choice-course`
 * (`lib_kb`), см. `scripts/smoke.mjs`.
 */
import type { EngineEvent, LearningEngine } from '@lms/engine-contract';
import type { SmokeBridge } from '../../../shared/smoke.ts';
import { ensureAnswerElement } from '@/pages/session/api/answer-element.ts';

const EXERCISE_ID = 'sql_kb::where::q2';
const CHOICE_EXERCISE_ID = 'choice_kb::basic::q1';
const RIGHT_SQL = 'SELECT name FROM emp WHERE salary IS NULL;';
const WRONG_SQL = 'SELECT name FROM emp WHERE salary IS NOT NULL;';
const EVENT_TIMEOUT_MS = 5_000;
const RECONNECT_TIMEOUT_MS = 30_000;

interface Scenario {
  ok: boolean;
  [key: string]: unknown;
}

const withTimeout = <T>(promise: Promise<T>, ms: number, what: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}: timeout`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });

const createEventWaiter = (engine: LearningEngine) => {
  const seen: EngineEvent[] = [];
  const waiters = new Set<() => void>();
  engine.subscribe((event) => {
    seen.push(event);
    for (const waiter of [...waiters]) waiter();
  });
  const next = (type: EngineEvent['type'], from: number) =>
    withTimeout(
      new Promise<EngineEvent>((resolve) => {
        const check = () => {
          const found = seen.slice(from).find((event) => event.type === type);
          if (!found) return;
          waiters.delete(check);
          resolve(found);
        };
        waiters.add(check);
        check();
      }),
      EVENT_TIMEOUT_MS,
      `event ${type}`,
    );
  return { next, mark: () => seen.length };
};

const codeOf = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : String(error);

type Events = ReturnType<typeof createEventWaiter>;

const basic = async (
  engine: LearningEngine,
  events: Events,
): Promise<Scenario> => {
  const info = await engine.library.getInfo();
  const exercise = await engine.library.getUnit(EXERCISE_ID);
  const mark = events.mark();
  const request = { requestId: 'smoke-1', exerciseId: EXERCISE_ID, grade: 4 };
  const first = await engine.practice.recordAttempt({ ...request, grade: 4 });
  const progress = await events.next('progress', mark);
  const second = await engine.practice.recordAttempt({ ...request, grade: 4 });
  // вызовы без необязательных аргументов проходят схемы zod на хосте
  const courses = await engine.library.listCourses();
  const batch = await engine.practice.getBatch();
  const due = await engine.practice.getDue();
  return {
    ok:
      exercise.kind === 'exercise' &&
      !first.duplicate &&
      second.duplicate &&
      second.eventId === first.eventId &&
      progress.type === 'progress' &&
      courses.items.length > 0 &&
      batch.exercises.length > 0 &&
      Array.isArray(due.items),
    library: info,
    courses: courses.items.length,
    batch: batch.exercises.length,
    due: due.items.length,
    firstDuplicate: first.duplicate,
    secondDuplicate: second.duplicate,
    sameEventId: second.eventId === first.eventId,
    progress,
  };
};

const sql = async (engine: LearningEngine): Promise<Scenario> => {
  const attempt = await engine.practice.beginAttempt({
    exerciseId: EXERCISE_ID,
  });
  const wrong = await engine.practice.submitAnswer({
    attemptId: attempt.attemptId,
    answer: WRONG_SQL,
  });
  const right = await engine.practice.submitAnswer({
    attemptId: attempt.attemptId,
    answer: RIGHT_SQL,
  });
  const result = await engine.practice.completeAttempt({
    attemptId: attempt.attemptId,
  });
  return {
    ok:
      attempt.verifiable &&
      wrong.outcome === 'failed' &&
      right.outcome === 'passed' &&
      !result.duplicate,
    verifiable: attempt.verifiable,
    wrong,
    right,
    grade: result.grade,
  };
};

const choice = async (engine: LearningEngine): Promise<Scenario> => {
  const attempt = await engine.practice.beginAttempt({
    exerciseId: CHOICE_EXERCISE_ID,
  });
  const view = attempt.view as { options?: unknown } | null;
  const wrong = await engine.practice.submitAnswer({
    attemptId: attempt.attemptId,
    answer: [1],
  });
  const right = await engine.practice.submitAnswer({
    attemptId: attempt.attemptId,
    answer: [0],
  });
  const result = await engine.practice.completeAttempt({
    attemptId: attempt.attemptId,
  });
  return {
    ok:
      attempt.verifiable &&
      Array.isArray(view?.options) &&
      wrong.outcome === 'failed' &&
      right.outcome === 'passed' &&
      !result.duplicate,
    verifiable: attempt.verifiable,
    options: view?.options ?? null,
    wrong,
    right,
    grade: result.grade,
  };
};

/** Скрипты элементов ввода грузятся по `lms-ext://` (CSP, CORS с file://) и определяют свои теги. */
const renderer = async (engine: LearningEngine): Promise<Scenario> => {
  const loaded: Record<string, boolean> = {};
  for (const exerciseId of [EXERCISE_ID, CHOICE_EXERCISE_ID]) {
    const { exercise } = await engine.practice.beginAttempt({ exerciseId });
    if (exercise.task === undefined) {
      loaded[exerciseId] = false;
      continue;
    }
    await ensureAnswerElement(exercise.task);
    loaded[exerciseId] =
      customElements.get(exercise.task.element) !== undefined;
  }
  return { ok: Object.values(loaded).every(Boolean), loaded };
};

const crash = async (
  engine: LearningEngine,
  events: Events,
  smoke: SmokeBridge,
): Promise<Scenario> => {
  const before = await engine.diagnostics();
  const killed = await smoke.killHost();
  // идемпотентный вызов уходит в момент падения и повторяется один раз после переподключения
  const replayed = withTimeout(
    engine.library.getInfo(),
    RECONNECT_TIMEOUT_MS,
    'idempotent replay',
  );
  // неидемпотентный получает ENGINE_CLOSED (решение о повторе — за UI)
  const nonIdempotent = await engine.practice
    .getBatch()
    .then(() => 'resolved', codeOf);
  const info = await replayed;
  const after = await engine.diagnostics();
  const duplicate = await engine.practice.recordAttempt({
    requestId: 'smoke-1',
    exerciseId: EXERCISE_ID,
    grade: 4,
  });
  const mark = events.mark();
  const fresh = await engine.practice.recordAttempt({
    requestId: 'smoke-after-crash',
    exerciseId: EXERCISE_ID,
    grade: 3,
  });
  const progress = await events.next('progress', mark);
  return {
    ok:
      killed &&
      nonIdempotent === 'ENGINE_CLOSED' &&
      info.revision !== undefined &&
      after.uptimeMs < before.uptimeMs &&
      duplicate.duplicate &&
      !fresh.duplicate &&
      progress.type === 'progress',
    killed,
    nonIdempotent,
    replayedRevision: info.revision,
    uptimeBeforeMs: before.uptimeMs,
    uptimeAfterMs: after.uptimeMs,
    duplicateAfterRestart: duplicate.duplicate,
    freshDuplicate: fresh.duplicate,
    progressAfterReconnect: progress.type,
  };
};

const attempt = async (run: () => Promise<Scenario>): Promise<Scenario> => {
  try {
    return await run();
  } catch (error) {
    return { ok: false, error: String(error) };
  }
};

export const runSmoke = async (engine: LearningEngine, smoke: SmokeBridge) => {
  const events = createEventWaiter(engine);
  const scenarios = {
    basic: await attempt(() => basic(engine, events)),
    sql: await attempt(() => sql(engine)),
    choice: await attempt(() => choice(engine)),
    renderer: await attempt(() => renderer(engine)),
    crash: await attempt(() => crash(engine, events, smoke)),
  };
  return {
    ok: Object.values(scenarios).every((scenario) => scenario.ok),
    scenarios,
  };
};
