import type {
  Grade,
  PlacementAnswerRequest,
  PlacementFinishRequest,
  PlacementProbeDto,
  PlacementProgressDto,
  PlacementService,
  PlacementStartRequest,
  PlacementStartResult,
  PlacementSummaryDto,
  UnitId,
} from '@spirula/engine-contract';
import {
  CLASS_KNOWN,
  CLASS_UNCERTAIN,
  CLASS_UNKNOWN,
  type DiagnosticSession,
  createDiagnosticSession,
  frontierOf,
} from '../../placement/diagnostic.ts';
import {
  PLACEMENT_GRADE,
  placementAttempts,
} from '../../placement/attempts.ts';
import {
  type PlacementTopics,
  buildPlacementTopics,
} from '../../placement/topics.ts';
import { drawSeed, isUint32 } from '../../planning/seeded-random.ts';
import type { CommitInput, EngineContext } from '../context.ts';
import { createExpiringMap } from '../expiring-map.ts';
import { EngineError } from '../errors.ts';

/** Границы и TTL сессии — предположения [ВЫВОД] (engine-ts.md §6a.3). */
export const MAX_PLACEMENT_BUDGET = 200;
export const PLACEMENT_SESSION_TTL_MS = 86_400_000;
const MAX_SESSIONS = 8;
/** «Пройдено» ⇔ самооценка не ниже этой оценки. */
const PASSING_GRADE = 3;
/** `known` при пробах без исполняемой проверки требует стольких независимых проходов. */
const GUESSABLE_MIN_PASS = 2;
const GRADES = new Set<number>([1, 2, 3, 4, 5]);

interface PlacementSession {
  readonly sessionId: string;
  readonly seed: number;
  readonly budget: number;
  readonly topics: PlacementTopics;
  readonly diagnostic: DiagnosticSession;
  /** Выданная и ещё не отвеченная проба (тема). */
  issued: number | null;
  finished: { requestId: string; summary: PlacementSummaryDto } | null;
}

const probeIdOf = (sessionId: string, topic: number) => `${sessionId}:${topic}`;

/** `<sessionId>:<topic>`; `sessionId` может сам содержать `:`. */
const parseProbeId = (probeId: string) => {
  const cut = probeId.lastIndexOf(':');
  const topic = Number(probeId.slice(cut + 1));
  if (cut <= 0 || !Number.isInteger(topic) || topic < 0) return null;
  return { sessionId: probeId.slice(0, cut), topic };
};

/**
 * `placement.*` (F3, engine-ts.md §6a.3). Сессии — в памяти хоста
 * (`createExpiringMap`, TTL 24 ч, не более одной активной на профиль); журнал
 * пишет только `finish`: по 2 попытки на упражнение `known`-уроков,
 * `source: 'placement'`, одной транзакцией, идемпотентно по `requestId`.
 */
export const createPlacementService = (
  ctx: EngineContext,
): PlacementService => {
  const sessions = createExpiringMap<PlacementSession>({
    capacity: MAX_SESSIONS,
    ttlMs: PLACEMENT_SESSION_TTL_MS,
    clock: ctx.clock,
  });
  let activeId: string | null = null;

  const activeSession = () => {
    if (activeId === null) return null;
    const session = sessions.get(activeId);
    if (session === undefined || session.finished !== null) {
      activeId = null;
      return null;
    }
    return session;
  };

  const notFound = (sessionId: string) =>
    new EngineError('PLACEMENT_SESSION_NOT_FOUND', { details: { sessionId } });

  /** Сессия по id; TTL продлевается при каждом обращении. */
  const touch = (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (session === undefined) throw notFound(sessionId);
    sessions.set(sessionId, session);
    return session;
  };

  const requireOpen = (sessionId: string) => {
    const session = touch(sessionId);
    if (session.finished !== null) throw notFound(sessionId);
    return session;
  };

  const start = async ({
    courseIds,
    budget,
    seed,
  }: PlacementStartRequest): Promise<PlacementStartResult> => {
    if (
      !Number.isInteger(budget) ||
      budget < 1 ||
      budget > MAX_PLACEMENT_BUDGET
    ) {
      throw new EngineError('INVALID_ARGUMENT', {
        details: { budget, min: 1, max: MAX_PLACEMENT_BUDGET },
      });
    }
    if (seed !== undefined && !isUint32(seed)) {
      throw new EngineError('INVALID_ARGUMENT', { details: { seed } });
    }
    const library = ctx.library.require();
    for (const courseId of courseIds ?? []) {
      if (library.getCourse(courseId) === undefined) {
        throw new EngineError('NOT_FOUND', { details: { courseId } });
      }
    }
    const active = activeSession();
    if (active !== null) {
      throw new EngineError('PLACEMENT_SESSION_ACTIVE', {
        details: { sessionId: active.sessionId },
      });
    }
    const topics = buildPlacementTopics(library, {
      ...(courseIds !== undefined && { courseIds }),
      blacklist: ctx.projections.flags,
    });
    const usedSeed = seed ?? drawSeed(ctx.rng);
    const guessable = topics.verifiable.some((verifiable) => !verifiable);
    const session: PlacementSession = {
      sessionId: ctx.ids.next(),
      seed: usedSeed,
      budget,
      topics,
      diagnostic: createDiagnosticSession(topics.graph, {
        budget,
        seed: usedSeed,
        minPass: guessable ? GUESSABLE_MIN_PASS : 0,
      }),
      issued: null,
      finished: null,
    };
    sessions.set(session.sessionId, session);
    activeId = session.sessionId;
    return {
      sessionId: session.sessionId,
      lessonCount: topics.graph.size,
      budget,
      seed: usedSeed,
    };
  };

  const nextProbe = async (
    sessionId: string,
  ): Promise<PlacementProbeDto | null> => {
    const session = requireOpen(sessionId);
    const topic = session.diagnostic.nextProbe();
    if (topic === null) return null;
    session.issued = topic;
    return {
      probeId: probeIdOf(sessionId, topic),
      lessonId: session.topics.graph.ids[topic] as UnitId,
      exerciseId: session.topics.probeExercise[topic] as UnitId,
    };
  };

  /** «Пройдено» по самооценке или по итогу открытой попытки. */
  const passedBy = (
    result: PlacementAnswerRequest['result'],
    exerciseId: UnitId,
  ): boolean => {
    if (result.kind === 'grade') {
      const grade: number = result.grade;
      if (!GRADES.has(grade)) {
        throw new EngineError('INVALID_ARGUMENT', { details: { grade } });
      }
      return (grade as Grade) >= PASSING_GRADE;
    }
    const attempt = ctx.attempts.get(result.attemptId);
    if (attempt === undefined) {
      throw new EngineError('ATTEMPT_NOT_FOUND', {
        details: { attemptId: result.attemptId },
      });
    }
    const verdict = attempt.verdicts[attempt.verdicts.length - 1];
    if (attempt.exerciseId !== exerciseId || verdict === undefined) {
      throw new EngineError('INVALID_ARGUMENT', {
        details: {
          attemptId: result.attemptId,
          need:
            attempt.exerciseId !== exerciseId ? 'probe-exercise' : 'verdict',
        },
      });
    }
    return verdict.outcome === 'passed';
  };

  const answer = async ({
    probeId,
    result,
  }: PlacementAnswerRequest): Promise<PlacementProgressDto> => {
    const parsed = parseProbeId(probeId);
    if (parsed === null) {
      throw new EngineError('INVALID_ARGUMENT', { details: { probeId } });
    }
    const session = requireOpen(parsed.sessionId);
    const { diagnostic } = session;
    if (session.issued !== parsed.topic) {
      const answered = diagnostic.probes.includes(parsed.topic);
      if (answered || diagnostic.probes.length >= session.budget) {
        throw new EngineError('PLACEMENT_BUDGET_EXHAUSTED', {
          details: { sessionId: session.sessionId, budget: session.budget },
        });
      }
      throw new EngineError('INVALID_ARGUMENT', {
        details: { probeId, reason: 'not-issued' },
      });
    }
    const pass = passedBy(
      result,
      session.topics.probeExercise[parsed.topic] as UnitId,
    );
    diagnostic.answer(parsed.topic, pass);
    session.issued = null;
    // итог открытой попытки принят: попытка закрыта, события в журнал нет
    if (result.kind === 'attempt') ctx.attempts.delete(result.attemptId);
    return {
      asked: diagnostic.probes.length,
      budget: session.budget,
      unresolved: diagnostic.unresolvedCount,
    };
  };

  const summarize = (session: PlacementSession, attemptsWritten: number) => {
    const { topics, diagnostic } = session;
    const classes = diagnostic.classes();
    const ids = topics.graph.ids;
    const pick = (wanted: number) =>
      ids.filter((_, topic) => classes[topic] === wanted);
    return {
      classes,
      summary: {
        known: pick(CLASS_KNOWN),
        unknown: pick(CLASS_UNKNOWN),
        uncertain: pick(CLASS_UNCERTAIN),
        frontier: frontierOf(topics.graph, classes).map(
          (topic) => ids[topic] as UnitId,
        ),
        attemptsWritten,
        duplicate: false,
      } satisfies PlacementSummaryDto,
    };
  };

  const finish = async ({
    sessionId,
    requestId,
  }: PlacementFinishRequest): Promise<PlacementSummaryDto> => {
    if (typeof requestId !== 'string' || requestId === '') {
      throw new EngineError('INVALID_ARGUMENT', { details: { requestId } });
    }
    const session = touch(sessionId);
    if (session.finished !== null) {
      if (session.finished.requestId !== requestId) throw notFound(sessionId);
      return { ...session.finished.summary, duplicate: true };
    }

    const { classes } = summarize(session, 0);
    const planned = placementAttempts(session.topics, classes);
    // база времени не ниже последней записи: иначе HLC схлопнет шаг между попытками
    const baseAt = Math.max(ctx.clock.now(), ctx.eventStore.maxAt() + 1);
    const inputs: CommitInput[] = planned.map(
      ({ exerciseId, offsetMs }, i) => ({
        fields: {
          kind: 'attempt',
          exerciseId,
          grade: PLACEMENT_GRADE,
          source: 'placement',
        },
        id: `${requestId}#${i}`,
        at: baseAt + offsetMs,
      }),
    );
    const committed =
      inputs.length === 0
        ? { appended: [], duplicates: [], affectedUnitIds: [] }
        : await ctx.commit(inputs);
    const { summary } = summarize(session, inputs.length);
    session.finished = { requestId, summary };
    if (activeId === sessionId) activeId = null;
    if (committed.affectedUnitIds.length > 0) {
      ctx.emit({
        type: 'progress',
        unitIds: [...new Set(committed.affectedUnitIds)],
        at: ctx.clock.now(),
      });
    }
    return {
      ...summary,
      duplicate: inputs.length > 0 && committed.appended.length === 0,
    };
  };

  /** Неизвестная, истёкшая и завершённая сессии — no-op (engine-ts-api.md §4.2). */
  const abort = async ({ sessionId }: { sessionId: string }): Promise<void> => {
    const session = sessions.get(sessionId);
    if (session === undefined || session.finished !== null) return;
    sessions.delete(sessionId);
    if (activeId === sessionId) activeId = null;
  };

  return { start, nextProbe, answer, finish, abort };
};
