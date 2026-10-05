/**
 * `placement.undo` / `placement.redo`: снятие ответа внутри теста, возврат,
 * сброс возврата новым ответом и равенство «любая цепочка = действующие ответы с нуля».
 */
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { EngineError } from '../../src/app/index.ts';
import { createTestEngine } from '../helpers/engine.ts';
import type { TestEngine } from '../helpers/engine.ts';

const SEED = 20261005;
const BUDGET = 20;

const start = (t: TestEngine, seed = 5) =>
  t.engine.placement.start({ budget: BUDGET, seed });

const answerNext = async (t: TestEngine, sessionId: string, pass: boolean) => {
  const probe = await t.engine.placement.nextProbe(sessionId);
  if (probe === null) return null;
  const progress = await t.engine.placement.answer({
    probeId: probe.probeId,
    result: { kind: 'grade', grade: pass ? 5 : 1 },
  });
  return { probe, progress };
};

const codeOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    if (error instanceof EngineError) return error.code;
    throw error;
  }
  return null;
};

describe('placement.undo / placement.redo', () => {
  test('undo takes back the last answer: progress as before it, the same probe is asked again', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const { sessionId } = await start(t);
    const first = await answerNext(t, sessionId, true);
    const second = await answerNext(t, sessionId, false);

    const undone = await t.engine.placement.undo(sessionId);
    expect(undone).toEqual({ changed: true, progress: first?.progress });
    expect(await t.engine.placement.nextProbe(sessionId)).toEqual(
      second?.probe,
    );
  });

  test('redo brings the answer back and the next probe is the one that followed it', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const { sessionId } = await start(t);
    await answerNext(t, sessionId, true);
    const second = await answerNext(t, sessionId, false);
    const third = await t.engine.placement.nextProbe(sessionId);

    await t.engine.placement.undo(sessionId);
    const redone = await t.engine.placement.redo(sessionId);
    expect(redone).toEqual({ changed: true, progress: second?.progress });
    expect(await t.engine.placement.nextProbe(sessionId)).toEqual(third);
  });

  test('an answer after undo drops the redo stack; an empty stack changes nothing', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const { sessionId } = await start(t);
    expect(await t.engine.placement.undo(sessionId)).toMatchObject({
      changed: false,
      progress: { asked: 0 },
    });
    await answerNext(t, sessionId, true);
    await t.engine.placement.undo(sessionId);
    await answerNext(t, sessionId, false);
    expect(await t.engine.placement.redo(sessionId)).toMatchObject({
      changed: false,
      progress: { asked: 1 },
    });
  });

  test('undo steps back one answer per call, redo returns them one by one', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const { sessionId } = await start(t);
    let answered = 0;
    while ((await answerNext(t, sessionId, answered % 2 === 0)) !== null) {
      answered++;
    }
    expect(answered).toBeGreaterThanOrEqual(3);
    const asked = async (step: 'undo' | 'redo') =>
      (await t.engine.placement[step](sessionId)).progress.asked;
    const down: number[] = [];
    for (let i = 0; i < answered; i++) down.push(await asked('undo'));
    expect(down).toEqual(
      Array.from({ length: answered }, (_, i) => answered - 1 - i),
    );
    const up: number[] = [];
    for (let i = 0; i < answered; i++) up.push(await asked('redo'));
    expect(up).toEqual(Array.from({ length: answered }, (_, i) => i + 1));
  });

  test('undo and redo need an open session', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const { placement } = t.engine;
    expect(await codeOf(() => placement.undo('nope'))).toBe(
      'PLACEMENT_SESSION_NOT_FOUND',
    );
    const { sessionId } = await start(t);
    await answerNext(t, sessionId, true);
    await placement.finish({ sessionId, requestId: 'done' });
    expect(await codeOf(() => placement.undo(sessionId))).toBe(
      'PLACEMENT_SESSION_NOT_FOUND',
    );
    expect(await codeOf(() => placement.redo(sessionId))).toBe(
      'PLACEMENT_SESSION_NOT_FOUND',
    );

    const again = await start(t);
    await placement.abort({ sessionId: again.sessionId });
    expect(await codeOf(() => placement.undo(again.sessionId))).toBe(
      'PLACEMENT_SESSION_NOT_FOUND',
    );
  });
});

type Step = 'pass' | 'fail' | 'undo' | 'redo';

describe('placement answers with undo and redo equal the effective answers from scratch', () => {
  test('any chain of answers, undos and redos: same probes, same result, same attempts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom<Step>('pass', 'fail', 'undo', 'redo'), {
          minLength: 1,
          maxLength: 14,
        }),
        fc.integer({ min: 0, max: 1_000 }),
        async (steps, seed) => {
          const a = await createTestEngine({ library: 'sql-course' });
          const { sessionId } = await start(a, seed);
          const effective: boolean[] = [];
          const undone: boolean[] = [];
          for (const step of steps) {
            if (step === 'undo') {
              const result = await a.engine.placement.undo(sessionId);
              const last = effective.pop();
              expect(result.changed).toBe(last !== undefined);
              if (last !== undefined) undone.push(last);
            } else if (step === 'redo') {
              const result = await a.engine.placement.redo(sessionId);
              const next = undone.pop();
              expect(result.changed).toBe(next !== undefined);
              if (next !== undefined) effective.push(next);
            } else {
              const asked = await answerNext(a, sessionId, step === 'pass');
              if (asked !== null) {
                effective.push(step === 'pass');
                undone.length = 0;
              }
            }
          }

          const b = await createTestEngine({ library: 'sql-course' });
          const fresh = await start(b, seed);
          for (const pass of effective) {
            await answerNext(b, fresh.sessionId, pass);
          }

          const lessonOf = async (t: TestEngine, id: string) =>
            (await t.engine.placement.nextProbe(id))?.lessonId ?? null;
          expect(await lessonOf(a, sessionId)).toBe(
            await lessonOf(b, fresh.sessionId),
          );
          const summaryA = await a.engine.placement.finish({
            sessionId,
            requestId: 'a',
          });
          const summaryB = await b.engine.placement.finish({
            sessionId: fresh.sessionId,
            requestId: 'b',
          });
          expect(summaryA).toEqual(summaryB);
          expect(a.eventStore.entryCount()).toBe(b.eventStore.entryCount());
        },
      ),
      { seed: SEED, numRuns: 40 },
    );
  });
});
