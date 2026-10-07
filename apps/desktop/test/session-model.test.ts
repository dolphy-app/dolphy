import { reactive } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  CompleteAttemptRequest,
  ExerciseDto,
  Grade,
  ItemReason,
  LearningEngine,
  RecordResultDto,
  RemediationDto,
  SubmitAnswerRequest,
  UnitDto,
  VerdictDto,
} from '@dolphy-app/engine-contract';
import { createSession } from '@/pages/session/model/session.ts';
import { flush } from './support/extensions-fakes.ts';

interface FakeOptions {
  plan: Array<{ id: string; reason?: ItemReason }>;
  /** Проверяемые упражнения (у них есть `task` и `view`). */
  verifiable?: string[];
  verdicts?: VerdictDto[];
  remediation?: RemediationDto;
  planError?: Error;
  /** `startSession` и `finishSession` отказывают с этой ошибкой. */
  sessionError?: Error;
  /** У движка нет команд сессии (старый контракт). */
  withoutSessionCommands?: boolean;
}

const exercise = (id: string, verifiable: boolean): ExerciseDto => ({
  kind: 'exercise',
  id,
  lessonId: 'lesson-1',
  courseId: 'course-1',
  name: `Exercise ${id}`,
  exerciseType: verifiable ? 'procedural' : 'declarative',
  content: { type: 'inlineFlashcard', front: `Q ${id}`, back: `A ${id}` },
  ...(verifiable
    ? {
        task: {
          type: 'dolphy.sql',
          timeoutMs: 1000,
          rendererUrl: 'dolphy-ext://dolphy.sql/view.mjs',
          origin: 'bundled',
          revision: '',
        },
      }
    : {}),
  keyPrerequisites: [],
});

const passed: VerdictDto = {
  attemptId: 'a',
  attemptsUsed: 1,
  durationMs: 1,
  outcome: 'passed',
};
const failed: VerdictDto = {
  attemptId: 'a',
  attemptsUsed: 1,
  durationMs: 1,
  outcome: 'failed',
  reason: 'mismatch',
};

const createFakeEngine = (options: FakeOptions) => {
  const submitted: SubmitAnswerRequest[] = [];
  const completed: CompleteAttemptRequest[] = [];
  const verdicts = [...(options.verdicts ?? [])];
  let planError = options.planError;
  const verifiable = new Set(options.verifiable ?? []);
  const started: Array<Record<string, never>> = [];
  const finished: Array<{ sessionId: string }> = [];

  const units: Record<string, UnitDto> = {
    'course-1': {
      kind: 'course',
      id: 'course-1',
      name: 'Course',
      lessonCount: 1,
      metadata: {},
      dependencies: [],
      encompassed: [],
      superseded: [],
    },
    'lesson-1': {
      kind: 'lesson',
      id: 'lesson-1',
      name: 'Lesson',
      courseId: 'course-1',
      exerciseCount: options.plan.length,
      metadata: {},
      dependencies: [],
      encompassed: [],
      superseded: [],
    },
    'prereq-1': {
      kind: 'lesson',
      id: 'prereq-1',
      name: 'Prerequisite',
      courseId: 'course-1',
      exerciseCount: 1,
      metadata: {},
      dependencies: [],
      encompassed: [],
      superseded: [],
    },
  };

  const engine = {
    plan: {
      getDay: async () => {
        if (planError) {
          const error = planError;
          planError = undefined; // повтор после ошибки проходит
          throw error;
        }
        return {
          items: options.plan.map(({ id, reason }) => ({
            exerciseId: id,
            reason: reason ?? 'review',
          })),
          interleaveOk: true,
          implicitCreditEnabled: false,
          seed: 1,
          generatedAt: 0,
        };
      },
    },
    library: {
      getUnit: async (id: string) => units[id],
      readAsset: async () => ({ text: '' }),
    },
    practice: {
      ...(!options.withoutSessionCommands && {
        startSession: async () => {
          if (options.sessionError) throw options.sessionError;
          started.push({});
          return { sessionId: `session-${started.length}`, startedAt: 0 };
        },
        finishSession: async (request: { sessionId: string }) => {
          if (options.sessionError) throw options.sessionError;
          finished.push(request);
          return { emitted: true };
        },
      }),
      beginAttempt: async ({ exerciseId }: { exerciseId: string }) => ({
        attemptId: `attempt-${exerciseId}`,
        exercise: exercise(exerciseId, verifiable.has(exerciseId)),
        startedAt: 0,
        verifiable: verifiable.has(exerciseId),
        view: verifiable.has(exerciseId) ? { hint: exerciseId } : null,
      }),
      submitAnswer: async (request: SubmitAnswerRequest) => {
        submitted.push(request);
        const verdict = verdicts.shift();
        if (!verdict) throw new Error('no verdict queued');
        return verdict;
      },
      completeAttempt: async (
        request: CompleteAttemptRequest,
      ): Promise<RecordResultDto> => {
        completed.push(request);
        const gaveUp = request.outcome === 'gave-up';
        const grade: Grade = gaveUp ? 1 : (request.grade ?? 5);
        return {
          eventId: `event-${completed.length}`,
          exerciseId: request.attemptId,
          grade,
          at: 0,
          duplicate: false,
          affected: [],
          remediation: options.remediation,
        };
      },
    },
  } as unknown as LearningEngine;

  return { engine, submitted, completed, started, finished };
};

describe('session model', () => {
  it('shows an empty stage for an empty plan', async () => {
    const { engine } = createFakeEngine({ plan: [] });
    const session = createSession(engine);
    await session.start();
    expect(session.stage.value).toBe('empty');
  });

  it('lets the learner retry after a failed load', async () => {
    const { engine } = createFakeEngine({
      plan: [{ id: 'e1' }],
      planError: new Error('boom'),
    });
    const session = createSession(engine);
    await session.start();
    expect(session.stage.value).toBe('failed');
    expect(session.error.value).toBe('boom');

    await session.start();
    expect(session.stage.value).toBe('answering');
    expect(session.error.value).toBeNull();
  });

  it('keeps a failed SQL answer open and records the attempt only on a pass', async () => {
    const { engine, submitted, completed } = createFakeEngine({
      plan: [{ id: 'e1' }],
      verifiable: ['e1'],
      verdicts: [failed, passed],
    });
    const session = createSession(engine);
    await session.start();
    expect(session.current.value?.task).toMatchObject({
      type: 'dolphy.sql',
    });
    expect(session.current.value?.view).toEqual({ hint: 'e1' });

    await session.submit('SELECT 1');
    expect(session.stage.value).toBe('answering');
    expect(completed).toHaveLength(0);

    await session.submit('SELECT 2');
    expect(submitted.map(({ answer }) => answer)).toEqual([
      'SELECT 1',
      'SELECT 2',
    ]);
    // оценку ставит политика движка, а не UI
    expect(completed).toEqual([{ attemptId: 'attempt-e1' }]);
    expect(session.stage.value).toBe('reviewed');

    await session.next();
    expect(session.stage.value).toBe('finished');
  });

  it('sends a cloneable answer even when the input is a reactive proxy', async () => {
    const { engine, submitted } = createFakeEngine({
      plan: [{ id: 'e1' }],
      verifiable: ['e1'],
      verdicts: [failed],
    });
    const session = createSession(engine);
    await session.start();
    // ответ элемента, попавший в реактивное состояние (ref, props), — Proxy
    await session.submit(reactive([0, 2]));
    expect(() => structuredClone(submitted[0]?.answer)).not.toThrow();
    expect(submitted[0]?.answer).toEqual([0, 2]);
  });

  it('records a give-up and reveals the answer', async () => {
    const { engine, completed } = createFakeEngine({
      plan: [{ id: 'e1' }],
      verifiable: ['e1'],
    });
    const session = createSession(engine);
    await session.start();
    await session.giveUp();
    expect(completed).toEqual([
      { attemptId: 'attempt-e1', outcome: 'gave-up' },
    ]);
    expect(session.revealed.value).toBe(true);
    expect(session.stage.value).toBe('reviewed');
  });

  it('advances automatically after a self-grade and summarises the session', async () => {
    const { engine, completed } = createFakeEngine({
      plan: [{ id: 'e1' }, { id: 'e2', reason: 'new' }],
    });
    const session = createSession(engine);
    await session.start();
    expect(session.total.value).toBe(2);

    await session.selfGrade(2);
    expect(session.position.value).toBe(2);
    expect(session.current.value?.reason).toBe('new');
    expect(session.stage.value).toBe('answering');

    await session.selfGrade(4);
    expect(completed).toEqual([
      { attemptId: 'attempt-e1', grade: 2 },
      { attemptId: 'attempt-e2', grade: 4 },
    ]);
    expect(session.stage.value).toBe('finished');
    expect(session.summary.value).toEqual({
      count: 2,
      averageGrade: 3,
      passed: 1,
    });
  });

  it('stops on remediation until the learner continues', async () => {
    const { engine } = createFakeEngine({
      plan: [{ id: 'e1' }, { id: 'e2' }],
      remediation: {
        exerciseId: 'e1',
        active: true,
        steps: [
          {
            unitId: 'prereq-1',
            source: 'key-prerequisite',
            exerciseIds: [],
            done: false,
          },
        ],
      },
    });
    const session = createSession(engine);
    await session.start();
    await session.selfGrade(1);

    expect(session.stage.value).toBe('reviewed');
    expect(session.remediation.value).toEqual(['Prerequisite']);

    await session.next();
    expect(session.position.value).toBe(2);
    expect(session.remediation.value).toEqual([]);
  });

  it('ignores a second action while one is in flight', async () => {
    const { engine, completed } = createFakeEngine({ plan: [{ id: 'e1' }] });
    const session = createSession(engine);
    await session.start();

    await Promise.all([session.selfGrade(3), session.selfGrade(5)]);
    expect(completed).toHaveLength(1);
  });

  describe('engine session', () => {
    it('opens a session with the first exercise and finishes it once at the end', async () => {
      const { engine, started, finished } = createFakeEngine({
        plan: [{ id: 'e1' }, { id: 'e2' }],
      });
      const session = createSession(engine);
      await session.start();
      await flush();
      expect(started).toHaveLength(1);
      expect(finished).toEqual([]);

      await session.selfGrade(5);
      await flush();
      expect(finished).toEqual([]);

      await session.selfGrade(5);
      await flush();
      expect(session.stage.value).toBe('finished');
      expect(finished).toEqual([{ sessionId: 'session-1' }]);

      await session.next();
      await flush();
      expect(finished).toHaveLength(1);
    });

    it('does not finish a session left in the middle', async () => {
      const { engine, started, finished } = createFakeEngine({
        plan: [{ id: 'e1' }, { id: 'e2' }],
      });
      const session = createSession(engine);
      await session.start();
      await session.selfGrade(5);
      await flush();
      expect(started).toHaveLength(1);
      expect(finished).toEqual([]);
    });

    it('does not open a session for an empty plan', async () => {
      const { engine, started, finished } = createFakeEngine({ plan: [] });
      const session = createSession(engine);
      await session.start();
      await flush();
      expect(started).toEqual([]);
      expect(finished).toEqual([]);
    });

    it('keeps one engine session across a retry after a failed load', async () => {
      const { engine, started } = createFakeEngine({
        plan: [{ id: 'e1' }],
        planError: new Error('boom'),
      });
      const session = createSession(engine);
      await session.start();
      await session.start();
      await session.start();
      expect(started).toHaveLength(1);
    });

    it('starts a new engine session when the finished one is restarted', async () => {
      const { engine, started, finished } = createFakeEngine({
        plan: [{ id: 'e1' }],
      });
      const session = createSession(engine);
      await session.start();
      await session.selfGrade(5);
      await session.start();
      await session.selfGrade(5);
      await flush();
      expect(started).toHaveLength(2);
      expect(finished).toEqual([
        { sessionId: 'session-1' },
        { sessionId: 'session-2' },
      ]);
    });

    it('keeps the screen working when the engine refuses the session calls', async () => {
      const { engine } = createFakeEngine({
        plan: [{ id: 'e1' }],
        sessionError: new Error('refused'),
      });
      const session = createSession(engine);
      await session.start();
      await session.selfGrade(5);
      await flush();
      expect(session.stage.value).toBe('finished');
      expect(session.error.value).toBeNull();
    });

    it('keeps the screen working when the engine has no session commands', async () => {
      const { engine } = createFakeEngine({
        plan: [{ id: 'e1' }],
        withoutSessionCommands: true,
      });
      const session = createSession(engine);
      await session.start();
      await session.selfGrade(5);
      await flush();
      expect(session.stage.value).toBe('finished');
    });
  });
});
