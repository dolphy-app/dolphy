import { describe, expect, it, vi } from 'vitest';
import type {
  LearningEngine,
  RetractRequest,
  RetractResult,
} from '@dolphy-app/engine-contract';
import { createSession } from '@/pages/session/model/session.ts';

const EXERCISES = ['c::l::e1', 'c::l::e2', 'c::l::e3'];

/** Минимальный движок для сессии: план из трёх упражнений, журнал — вызовы `undo`/`redo`. */
const setup = () => {
  let opened = 0;
  const result = (eventId: string) => ({
    eventId,
    duplicate: false,
    changed: true,
  });
  const undo = vi.fn<(request: RetractRequest) => Promise<RetractResult>>(
    async () => result('u'),
  );
  const redo = vi.fn<(request: RetractRequest) => Promise<RetractResult>>(
    async () => result('r'),
  );
  const engine = {
    plan: {
      getDay: async () => ({
        items: EXERCISES.map((exerciseId) => ({ exerciseId, reason: 'new' })),
      }),
    },
    practice: {
      startSession: async () => ({ sessionId: 's', startedAt: 0 }),
      finishSession: async () => ({ emitted: true }),
      beginAttempt: async ({ exerciseId }: { exerciseId: string }) => ({
        attemptId: `attempt-${++opened}`,
        verifiable: false,
        view: null,
        exercise: {
          name: exerciseId,
          lessonId: 'c::l',
          courseId: 'c',
          content: { type: 'inlineMarkdown', text: exerciseId },
        },
      }),
      completeAttempt: async ({
        attemptId,
        grade,
      }: {
        attemptId: string;
        grade?: number;
      }) => ({ eventId: attemptId, grade: grade ?? 4 }),
      undo,
      redo,
    },
    library: {
      getUnit: async (id: string) =>
        id === 'c'
          ? { kind: 'course', id, name: 'Course' }
          : { kind: 'lesson', id, name: 'Lesson' },
    },
  } as unknown as LearningEngine;
  let counter = 0;
  const session = createSession(engine, {
    newRequestId: () => `request-${++counter}`,
  });
  return { session, undo, redo };
};

describe('отмена и возврат ответов сессии', () => {
  it('отмена снимает последний ответ в движке, возвращает то же упражнение и убирает его из итога', async () => {
    const { session, undo } = setup();
    await session.start();
    await session.selfGrade(5);
    await session.selfGrade(3);
    expect(session.position.value).toBe(3);
    expect(session.summary.value.count).toBe(2);

    await session.undo();
    expect(undo).toHaveBeenCalledExactlyOnceWith({
      targetId: 'attempt-2',
      requestId: 'request-1',
    });
    expect(session.position.value).toBe(2);
    expect(session.current.value?.exerciseId).toBe(EXERCISES[1]);
    expect(session.summary.value.count).toBe(1);
    expect(session.canRedo.value).toBe(true);
  });

  it('возврат восстанавливает ответ и переходит к следующему упражнению', async () => {
    const { session, redo } = setup();
    await session.start();
    await session.selfGrade(5);
    await session.undo();
    expect(session.position.value).toBe(1);
    expect(session.canUndo.value).toBe(false);

    await session.redo();
    expect(redo).toHaveBeenCalledExactlyOnceWith({
      targetId: 'attempt-1',
      requestId: 'request-2',
    });
    expect(session.position.value).toBe(2);
    expect(session.summary.value.count).toBe(1);
    expect(session.canUndo.value).toBe(true);
    expect(session.canRedo.value).toBe(false);
  });

  it('новый ответ после отмены сбрасывает «вернуть»', async () => {
    const { session } = setup();
    await session.start();
    await session.selfGrade(5);
    await session.undo();
    expect(session.canRedo.value).toBe(true);
    await session.selfGrade(2);
    expect(session.canRedo.value).toBe(false);
    expect(session.summary.value.count).toBe(1);
  });

  it('отмены и возвраты идут стеком: вернуть можно в порядке, обратном отмене', async () => {
    const { session, redo } = setup();
    await session.start();
    await session.selfGrade(5);
    await session.selfGrade(4);
    await session.undo();
    await session.undo();
    expect(session.position.value).toBe(1);

    await session.redo();
    await session.redo();
    expect(redo.mock.calls.map(([request]) => request.targetId)).toEqual([
      'attempt-1',
      'attempt-2',
    ]);
    expect(session.position.value).toBe(3);
  });

  it('с экрана итога отмена возвращает к последнему упражнению, возврат — обратно к итогу', async () => {
    const { session } = setup();
    await session.start();
    for (const grade of [5, 4, 3] as const) await session.selfGrade(grade);
    expect(session.stage.value).toBe('finished');

    await session.undo();
    expect(session.stage.value).toBe('answering');
    expect(session.position.value).toBe(3);

    await session.redo();
    expect(session.stage.value).toBe('finished');
    expect(session.summary.value.count).toBe(3);
  });

  it('сбой движка остаётся ошибкой экрана: состояние не меняется', async () => {
    const { session, undo } = setup();
    await session.start();
    await session.selfGrade(5);
    undo.mockRejectedValueOnce(new Error('boom'));
    await session.undo();
    expect(session.error.value).toBe('boom');
    expect(session.summary.value.count).toBe(1);
    expect(session.canRedo.value).toBe(false);
  });
});
