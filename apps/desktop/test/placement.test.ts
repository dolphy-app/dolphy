import { describe, expect, it } from 'vitest';
import type {
  ExerciseDto,
  LearningEngine,
  PlacementAnswerRequest,
  PlacementFinishRequest,
  PlacementProbeDto,
  PlacementStartRequest,
  PlacementSummaryDto,
  SubmitAnswerRequest,
  UnitDto,
  VerdictDto,
} from '@lms/engine-contract';
import {
  defaultBudget,
  maxBudget,
  normalizeBudget,
} from '@/pages/placement/lib/budget.ts';
import { createPlacement } from '@/pages/placement/model/placement.ts';

class FakeEngineError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, details?: Record<string, unknown>) {
    super(code);
    this.code = code;
    if (details) this.details = details;
  }
}

const passed: VerdictDto = {
  attemptId: 'attempt-1',
  attemptsUsed: 1,
  durationMs: 1,
  outcome: 'passed',
};
const failed: VerdictDto = {
  attemptId: 'attempt-1',
  attemptsUsed: 1,
  durationMs: 1,
  outcome: 'failed',
  reason: 'mismatch',
};
const broken: VerdictDto = {
  attemptId: 'attempt-1',
  attemptsUsed: 0,
  durationMs: 1,
  outcome: 'error',
  reason: 'timeout',
};

const summary: PlacementSummaryDto = {
  known: ['l1'],
  uncertain: ['l2'],
  unknown: ['l3', 'l-gone'],
  frontier: ['l2', 'l3'],
  attemptsWritten: 4,
  duplicate: false,
};

interface FakeOptions {
  lessons?: number;
  /** Пробы по порядку выдачи; после них `nextProbe` даёт `null`. */
  probes?: PlacementProbeDto[];
  /** Упражнения с раннером SQL. */
  verifiable?: string[];
  verdicts?: VerdictDto[];
  /** Итог `finish`; по умолчанию `summary`. */
  summary?: PlacementSummaryDto;
  /** Ошибки, которые выбросят вызовы по очереди. */
  errors?: Partial<
    Record<'getUnit' | 'start' | 'nextProbe' | 'answer' | 'finish', Error[]>
  >;
}

const probe = (n: number): PlacementProbeDto => ({
  probeId: `probe-${n}`,
  lessonId: 'l1',
  exerciseId: `e${n}`,
});

const createFakeEngine = (options: FakeOptions = {}) => {
  const lessons = options.lessons ?? 3;
  const probes = [...(options.probes ?? [])];
  const verdicts = [...(options.verdicts ?? [])];
  const verifiable = new Set(options.verifiable ?? []);
  const errors = options.errors ?? {};
  const calls = {
    start: [] as PlacementStartRequest[],
    answer: [] as PlacementAnswerRequest[],
    finish: [] as PlacementFinishRequest[],
    abort: [] as string[],
    submitted: [] as SubmitAnswerRequest[],
  };
  let answered = 0;
  let sessions = 0;

  const thrown = (key: keyof typeof errors) => {
    const error = errors[key]?.shift();
    if (error) throw error;
  };

  const exercise = (id: string): ExerciseDto => ({
    kind: 'exercise',
    id,
    lessonId: 'l1',
    courseId: 'c1',
    name: `Exercise ${id}`,
    exerciseType: 'declarative',
    content: { type: 'inlineFlashcard', front: `Q ${id}`, back: `A ${id}` },
    ...(verifiable.has(id) && {
      task: {
        type: 'lms.sql',
        timeoutMs: 1000,
        element: 'lms-sql-answer',
        rendererUrl: 'lms-ext://lms.sql/view.mjs',
      },
    }),
    keyPrerequisites: [],
  });
  const common = {
    metadata: {},
    dependencies: [],
    encompassed: [],
    superseded: [],
  };
  const course: UnitDto = {
    kind: 'course',
    id: 'c1',
    name: 'Course',
    lessonCount: lessons,
    ...common,
  };
  const lesson = (id: string, name: string): UnitDto => ({
    kind: 'lesson',
    id,
    name,
    courseId: 'c1',
    exerciseCount: 1,
    ...common,
  });
  const catalog: UnitDto[] = [
    course,
    lesson('l1', 'Basics'),
    lesson('l2', 'Joins'),
    lesson('l3', 'Indexes'),
  ];

  const engine = {
    library: {
      getUnit: async (id: string) => {
        thrown('getUnit');
        const unit = catalog.find((entry) => entry.id === id);
        return unit ?? exercise(id);
      },
      listCourses: async () => ({ items: [course] }),
      listLessons: async () => ({
        items: catalog.filter(({ kind }) => kind === 'lesson'),
      }),
      readAsset: async () => ({ text: '' }),
    },
    practice: {
      beginAttempt: async ({ exerciseId }: { exerciseId: string }) => ({
        attemptId: 'attempt-1',
        exercise: exercise(exerciseId),
        startedAt: 0,
        verifiable: true,
        view: { hint: 'v' },
      }),
      submitAnswer: async (request: SubmitAnswerRequest) => {
        calls.submitted.push(request);
        const verdict = verdicts.shift();
        if (!verdict) throw new Error('no verdict queued');
        return verdict;
      },
    },
    placement: {
      start: async (request: PlacementStartRequest) => {
        calls.start.push(request);
        thrown('start');
        sessions += 1;
        return {
          sessionId: `session-${sessions}`,
          lessonCount: lessons,
          budget: request.budget,
          seed: 1,
        };
      },
      nextProbe: async () => {
        thrown('nextProbe');
        return probes.shift() ?? null;
      },
      answer: async (request: PlacementAnswerRequest) => {
        thrown('answer');
        calls.answer.push(request);
        answered += 1;
        return { asked: answered, budget: 6, unresolved: 3 - answered };
      },
      finish: async (request: PlacementFinishRequest) => {
        calls.finish.push(request);
        thrown('finish');
        return options.summary ?? summary;
      },
      abort: async ({ sessionId }: { sessionId: string }) => {
        calls.abort.push(sessionId);
      },
    },
  } as unknown as LearningEngine;

  return { engine, calls };
};

const newPlacement = (
  engine: LearningEngine,
  courseId: string | undefined = 'c1',
) => {
  let ids = 0;
  return createPlacement(engine, {
    courseId,
    newRequestId: () => `request-${(ids += 1)}`,
  });
};

describe('placement budget', () => {
  it('defaults to min(20, lessons * 2) within 1..200', () => {
    expect(defaultBudget(3)).toBe(6);
    expect(defaultBudget(10)).toBe(20);
    expect(defaultBudget(500)).toBe(20);
    expect(defaultBudget(0)).toBe(1);
  });

  it('never offers more than two probes per lesson, capped at 200', () => {
    expect(maxBudget(3)).toBe(6);
    expect(maxBudget(400)).toBe(200);
  });

  it('brings a chosen budget into the accepted range', () => {
    expect(normalizeBudget(0, 10)).toBe(1);
    expect(normalizeBudget(99, 10)).toBe(20);
    expect(normalizeBudget(Number.NaN, 10)).toBe(1);
    expect(normalizeBudget(7.9, 10)).toBe(7);
  });
});

describe('placement model', () => {
  it('describes the course on the intro stage with the default budget', async () => {
    const { engine } = createFakeEngine({ lessons: 3 });
    const placement = newPlacement(engine);
    expect(placement.stage.value).toBe('loading');

    await placement.init();
    expect(placement.stage.value).toBe('intro');
    expect(placement.intro.value).toMatchObject({
      courseName: 'Course',
      lessonCount: 3,
      defaultBudget: 6,
    });
    expect(placement.budget.value).toBe(6);
  });

  it('runs start → probe → answer → finish and names the lessons', async () => {
    const { engine, calls } = createFakeEngine({
      probes: [probe(1), probe(2), probe(3)],
      verifiable: ['e2'],
      verdicts: [passed],
    });
    const placement = newPlacement(engine);
    await placement.init();
    placement.budget.value = 5;

    await placement.begin();
    expect(calls.start).toEqual([{ budget: 5, courseIds: ['c1'] }]);
    expect(placement.stage.value).toBe('probing');
    expect(placement.current.value).toMatchObject({
      probeId: 'probe-1',
      verifiable: false,
      lessonName: 'Basics',
    });

    await placement.selfGrade(4);
    expect(calls.answer[0]).toEqual({
      probeId: 'probe-1',
      result: { kind: 'grade', grade: 4 },
    });
    expect(placement.progress.value).toEqual({
      asked: 1,
      budget: 6,
      unresolved: 2,
    });

    // проверяемая проба: SQL → раннер → итог попытки
    expect(placement.current.value).toMatchObject({
      probeId: 'probe-2',
      verifiable: true,
      task: { type: 'lms.sql', element: 'lms-sql-answer' },
      view: { hint: 'v' },
      attemptId: 'attempt-1',
    });
    await placement.submit('SELECT 1');
    expect(calls.submitted).toEqual([
      { attemptId: 'attempt-1', answer: 'SELECT 1' },
    ]);
    expect(placement.passed.value).toBe(true);
    await placement.confirm();
    expect(calls.answer[1]).toEqual({
      probeId: 'probe-2',
      result: { kind: 'attempt', attemptId: 'attempt-1' },
    });

    await placement.skip();
    expect(calls.answer[2]).toEqual({
      probeId: 'probe-3',
      result: { kind: 'grade', grade: 1 },
    });

    // проб больше нет — итог собирается сам
    expect(calls.finish).toEqual([
      { sessionId: 'session-1', requestId: 'request-1' },
    ]);
    expect(placement.stage.value).toBe('finished');
    expect(placement.result.value).toEqual({
      known: [{ id: 'l1', name: 'Basics' }],
      uncertain: [{ id: 'l2', name: 'Joins' }],
      unknown: [
        { id: 'l3', name: 'Indexes' },
        { id: 'l-gone', name: 'l-gone' },
      ],
      frontier: 2,
      attemptsWritten: 4,
      duplicate: false,
    });
  });

  it('counts a failed check but not a checker error', async () => {
    const { engine, calls } = createFakeEngine({
      probes: [probe(1)],
      verifiable: ['e1'],
      verdicts: [broken, failed],
    });
    const placement = newPlacement(engine);
    await placement.init();
    await placement.begin();

    await placement.submit('SELECT 1');
    expect(placement.checked.value).toBe(false);
    await placement.confirm();
    expect(calls.answer).toHaveLength(0);

    await placement.submit('SELECT 2');
    expect(placement.checked.value).toBe(true);
    expect(placement.passed.value).toBe(false);
    await placement.confirm();
    expect(calls.answer).toEqual([
      {
        probeId: 'probe-1',
        result: { kind: 'attempt', attemptId: 'attempt-1' },
      },
    ]);
  });

  it('finishes early with the same requestId after a network failure', async () => {
    const { engine, calls } = createFakeEngine({
      probes: [probe(1)],
      errors: { finish: [new Error('network down')] },
    });
    const placement = newPlacement(engine);
    await placement.init();
    await placement.begin();

    await placement.finishEarly();
    expect(placement.stage.value).toBe('failed');
    expect(placement.error.value).toBe('network down');

    await placement.retry();
    expect(placement.stage.value).toBe('finished');
    expect(placement.error.value).toBeNull();
    expect(calls.finish).toHaveLength(2);
    expect(calls.finish[1]).toEqual(calls.finish[0]);
  });

  it('shows the duplicate flag from a repeated finish', async () => {
    const { engine } = createFakeEngine({
      probes: [probe(1)],
      summary: { ...summary, duplicate: true },
    });
    const placement = newPlacement(engine);
    await placement.init();
    await placement.begin();
    await placement.finishEarly();
    expect(placement.result.value?.duplicate).toBe(true);
  });

  it('aborts the session without writing anything', async () => {
    const { engine, calls } = createFakeEngine({ probes: [probe(1)] });
    const placement = newPlacement(engine);
    await placement.init();
    await placement.begin();

    await placement.abort();
    await placement.abort();
    expect(calls.abort).toEqual(['session-1']);
    expect(calls.finish).toHaveLength(0);
  });

  it('keeps the probe on an answer error and lets the learner retry', async () => {
    const { engine, calls } = createFakeEngine({
      probes: [probe(1)],
      errors: { answer: [new Error('boom')] },
    });
    const placement = newPlacement(engine);
    await placement.init();
    await placement.begin();

    await placement.selfGrade(5);
    expect(placement.stage.value).toBe('probing');
    expect(placement.error.value).toBe('boom');

    await placement.selfGrade(5);
    expect(placement.error.value).toBeNull();
    expect(calls.answer).toHaveLength(1);
  });

  it('fails when the engine cannot describe the course', async () => {
    const { engine } = createFakeEngine({
      errors: { getUnit: [new FakeEngineError('NOT_FOUND')] },
    });
    const placement = newPlacement(engine);
    await placement.init();
    expect(placement.stage.value).toBe('failed');
    expect(placement.error.value).toBe('NOT_FOUND');

    await placement.retry();
    expect(placement.stage.value).toBe('intro');
  });

  it('fails when start is rejected and retries the start', async () => {
    const { engine, calls } = createFakeEngine({
      probes: [probe(1)],
      errors: { start: [new FakeEngineError('INTERNAL')] },
    });
    const placement = newPlacement(engine);
    await placement.init();
    await placement.begin();
    expect(placement.stage.value).toBe('failed');

    await placement.retry();
    expect(placement.stage.value).toBe('probing');
    expect(calls.start).toHaveLength(2);
  });

  it('closes a session left over by a closed page and starts again', async () => {
    const { engine, calls } = createFakeEngine({
      probes: [probe(1)],
      errors: {
        start: [
          new FakeEngineError('PLACEMENT_SESSION_ACTIVE', {
            sessionId: 'stale',
          }),
        ],
      },
    });
    const placement = newPlacement(engine);
    await placement.init();
    await placement.begin();

    expect(calls.abort).toEqual(['stale']);
    expect(placement.stage.value).toBe('probing');
  });

  it('ignores a second action while one is in flight', async () => {
    const { engine, calls } = createFakeEngine({
      probes: [probe(1), probe(2)],
    });
    const placement = newPlacement(engine);
    await placement.init();
    await placement.begin();

    await Promise.all([placement.selfGrade(3), placement.selfGrade(5)]);
    expect(calls.answer).toHaveLength(1);
  });
});
