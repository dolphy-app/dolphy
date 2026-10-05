/**
 * `practice.undo` / `practice.redo` через фасад на настоящем движке: отмена
 * попытки, идемпотентность, ошибки, журнал и статистика.
 */
import type { LearningEngine } from '@dolphy-app/engine-contract';
import { buildLibrary } from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import { EngineError } from '../../src/app/index.ts';
import { localDayOf } from '../../src/domain/learning-stats.ts';
import { createTestEngine } from '../helpers/engine.ts';

const library = buildLibrary({
  courses: [
    {
      id: 'c',
      lessons: [
        { id: 'l1', exercises: ['e1', 'e2'] },
        { id: 'l2', dependencies: ['l1'], exercises: ['e1'] },
      ],
    },
  ],
});
const E1 = 'c::l1::e1';
const E2 = 'c::l1::e2';

const record = (engine: LearningEngine, requestId: string, exerciseId = E1) =>
  engine.practice.recordAttempt({ requestId, exerciseId, grade: 5 });

const codeOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    if (error instanceof EngineError) return error.code;
    throw error;
  }
  return null;
};

describe('undo / redo of an attempt', () => {
  it('removes the attempt from every reading and redo brings it back', async () => {
    const t = await createTestEngine({ library });
    await record(t.engine, 'a1');
    await record(t.engine, 'a2', E2);
    const readings = async () => ({
      attempts: (await t.engine.practice.getAttempts(E1)).items.length,
      score: (await t.engine.practice.getUnitScore(E1)).score,
      lesson: (await t.engine.practice.getUnitScore('c::l1')).score,
    });
    const before = await readings();
    expect(before.attempts).toBe(1);

    const undone = await t.engine.practice.undo({
      targetId: 'a1',
      requestId: 'u1',
    });
    expect(undone).toEqual({ eventId: 'u1', duplicate: false, changed: true });
    const untouched = await createTestEngine({ library });
    expect((await untouched.engine.practice.getUnitScore(E1)).score).toBe(0);
    expect(await readings()).toMatchObject({ attempts: 0, score: 0 });
    expect((await t.engine.practice.getAttempts(E2)).items).toHaveLength(1);
    expect(t.events.at(-1)).toMatchObject({
      type: 'progress',
      unitIds: expect.arrayContaining([E1, 'c::l1', 'c']),
    });

    const redone = await t.engine.practice.redo({
      targetId: 'a1',
      requestId: 'r1',
    });
    expect(redone).toEqual({ eventId: 'r1', duplicate: false, changed: true });
    expect(await readings()).toEqual(before);
  });

  it('keeps the journal append-only: undo adds a retract entry, the attempt stays', async () => {
    const t = await createTestEngine({ library });
    await record(t.engine, 'a1');
    t.clock.advance(1_000);
    await t.engine.practice.undo({ targetId: 'a1', requestId: 'u1' });
    const journal = [];
    for await (const entry of t.eventStore.readAll()) journal.push(entry);
    expect(journal.map(({ id, kind }) => [id, kind])).toEqual([
      ['a1', 'attempt'],
      ['u1', 'retract'],
    ]);
    expect(journal[1]).toMatchObject({ targetId: 'a1', op: 'set' });
  });

  it('drops the undone attempt from the learning stats and restores it on redo', async () => {
    const t = await createTestEngine({ library });
    await record(t.engine, 'a1');
    await record(t.engine, 'a2', E2);
    const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = localDayOf(t.clock.now(), timeZone);
    const attemptsToday = async () =>
      (await t.ctx.statsIndex.daily(today, today))[0]?.attempts;
    expect(await attemptsToday()).toBe(2);
    await t.engine.practice.undo({ targetId: 'a1', requestId: 'u1' });
    expect(await attemptsToday()).toBe(1);
    await t.engine.practice.redo({ targetId: 'a1', requestId: 'r1' });
    expect(await attemptsToday()).toBe(2);
  });

  it('is idempotent by requestId and writes nothing when the state already matches', async () => {
    const t = await createTestEngine({ library });
    await record(t.engine, 'a1');
    t.clock.advance(1_000);
    const first = await t.engine.practice.undo({
      targetId: 'a1',
      requestId: 'u1',
    });
    const count = t.eventStore.entryCount();
    expect(
      await t.engine.practice.undo({ targetId: 'a1', requestId: 'u1' }),
    ).toEqual({ eventId: first.eventId, duplicate: true, changed: true });
    // другой requestId, цель уже отменена: записи нет
    expect(
      await t.engine.practice.undo({ targetId: 'a1', requestId: 'u2' }),
    ).toEqual({ eventId: null, duplicate: false, changed: false });
    expect(t.eventStore.entryCount()).toBe(count);
    // redo возвращает, повторный redo с другим requestId ничего не пишет
    expect(
      await t.engine.practice.redo({ targetId: 'a1', requestId: 'r1' }),
    ).toMatchObject({ changed: true });
    expect(
      await t.engine.practice.redo({ targetId: 'a1', requestId: 'r2' }),
    ).toEqual({ eventId: null, duplicate: false, changed: false });
    expect(t.eventStore.entryCount()).toBe(count + 1);
  });

  it('rejects an unknown target, a non-attempt target and a reused request id', async () => {
    const t = await createTestEngine({ library });
    await record(t.engine, 'a1');
    await t.engine.practice.resetProgress({ unitId: E2, requestId: 'reset' });
    const undo = (targetId: string, requestId: string) => () =>
      t.engine.practice.undo({ targetId, requestId });
    expect(await codeOf(undo('nope', 'u1'))).toBe('NOT_FOUND');
    expect(await codeOf(undo('reset', 'u2'))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(undo('a1', 'a1'))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(undo('', 'u3'))).toBe('INVALID_ARGUMENT');
  });

  it('an attempt recorded after undo counts normally', async () => {
    const t = await createTestEngine({ library });
    await record(t.engine, 'a1');
    t.clock.advance(1_000);
    await t.engine.practice.undo({ targetId: 'a1', requestId: 'u1' });
    t.clock.advance(1_000);
    await record(t.engine, 'a3');
    expect(
      (await t.engine.practice.getAttempts(E1)).items.map(
        ({ eventId }) => eventId,
      ),
    ).toEqual(['a3']);
  });
});
