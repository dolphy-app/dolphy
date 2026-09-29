/**
 * Настоящий движок поверх `SqliteEventStore`: сценарии через фасад на файле
 * БД (перезапуск, сбой проекции, обмен журналами и конфликты). Ядро `@lms/engine`
 * от SQLite не зависит, поэтому эти сценарии живут здесь.
 */
import { buildAttempt, createFakeClock, T0_MS } from '@lms/testkit';
import { describe, expect, it, vi } from 'vitest';
import { createTestEngine } from '../../engine/test/helpers/engine.ts';
import { openTestStore, useTempDir } from './store-factory.ts';

const temp = useTempDir();
const EXERCISE = 'sql_json::ddl::q1';
const SECOND = 'sql_json::ddl::q2';
const options = (
  slot: string,
  deviceId = 'device-a',
  clock = createFakeClock(),
) =>
  ({
    library: 'sql-course',
    clock,
    eventStore: openTestStore(temp.dir, slot, deviceId),
  }) as const;

describe('engine over SqliteEventStore', () => {
  it('survives a restart: the journal on disk rebuilds the same state', async () => {
    const clock = createFakeClock();
    const first = await createTestEngine(options('restart', 'device-a', clock));
    await first.engine.practice.recordAttempt({
      requestId: 'a',
      exerciseId: EXERCISE,
      grade: 5,
    });
    clock.advance(1_000);
    await first.engine.practice.recordAttempt({
      requestId: 'b',
      exerciseId: EXERCISE,
      grade: 2,
    });
    await first.engine.curation.reviewList.add(SECOND);
    const scoreBefore = await first.engine.practice.getUnitScore(EXERCISE);
    await first.engine.close();

    const second = await createTestEngine(
      options('restart', 'device-a', clock),
    );
    expect(second.eventStore.entryCount()).toBe(3);
    expect(await second.engine.practice.getUnitScore(EXERCISE)).toEqual(
      scoreBefore,
    );
    expect(
      (await second.engine.practice.getAttempts(EXERCISE)).items.map(
        ({ eventId }) => eventId,
      ),
    ).toEqual(['b', 'a']);
    expect((await second.engine.curation.reviewList.list()).items).toEqual([
      SECOND,
    ]);
    // seq продолжается без пропусков и `at` не уходит назад
    const next = await second.engine.practice.recordAttempt({
      requestId: 'c',
      exerciseId: EXERCISE,
      grade: 3,
    });
    expect(next.at).toBeGreaterThan(T0_MS + 1_000);
    expect(second.eventStore.lastSeq()).toBe(4);
  });

  it('a projection failure leaves a written journal, the retry rebuilds and returns duplicate (T-11)', async () => {
    const t = await createTestEngine(options('dirty'));
    const apply = vi
      .spyOn(t.ctx.projections, 'apply')
      .mockImplementationOnce(() => {
        throw new Error('projection is broken');
      });
    const request = {
      requestId: 'r1',
      exerciseId: EXERCISE,
      grade: 4,
    } as const;
    await expect(
      t.engine.practice.recordAttempt(request),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    apply.mockRestore();
    expect(t.eventStore.entryCount()).toBe(1);
    expect(t.ctx.state.dirty).toBe(true);
    expect(await t.engine.practice.recordAttempt(request)).toMatchObject({
      duplicate: true,
    });
    expect(t.eventStore.entryCount()).toBe(1);
    expect(
      (await t.engine.practice.getUnitScore(EXERCISE)).score,
    ).toBeGreaterThan(0);
  });

  it('two devices exchange journals: idempotent import, older records rebuild', async () => {
    const clock = createFakeClock();
    const a = await createTestEngine(options('ex-a', 'device-a', clock));
    const b = await createTestEngine(options('ex-b', 'device-b', clock));
    await a.engine.practice.recordAttempt({
      requestId: 'a1',
      exerciseId: EXERCISE,
      grade: 5,
    });
    clock.advance(1_000);
    await b.engine.practice.recordAttempt({
      requestId: 'b1',
      exerciseId: EXERCISE,
      grade: 1,
    });
    clock.advance(1_000);
    await b.engine.practice.recordAttempt({
      requestId: 'b2',
      exerciseId: SECOND,
      grade: 4,
    });

    const fromA = await a.engine.sync.exportSince();
    const imported = await b.engine.sync.import(fromA.entries);
    expect(imported).toMatchObject({
      inserted: 1,
      duplicates: 0,
      conflicts: 0,
      rebuilt: true,
    }); // a1 старше b2
    expect(await b.engine.sync.import(fromA.entries)).toMatchObject({
      inserted: 0,
      duplicates: 1,
    });

    const { entries } = await b.engine.sync.exportSince({
      since: (await a.engine.sync.getState()).vector,
    });
    await a.engine.sync.import(entries);
    for (const engine of [a.engine, b.engine]) {
      expect(
        (await engine.practice.getAttempts(EXERCISE)).items.map(
          ({ eventId }) => eventId,
        ),
      ).toEqual(['b1', 'a1']);
      expect(
        (await engine.practice.getUnitScore(SECOND)).score,
      ).toBeGreaterThan(0);
    }
  });

  it('an id-content conflict hides both records until resolved; the decision survives a restart (T-58, T-60)', async () => {
    const clock = createFakeClock();
    const a = await createTestEngine(options('conflict', 'device-a', clock));
    const original = buildAttempt({
      id: 'same-id',
      deviceId: 'device-x',
      seq: 1,
      at: T0_MS + 10,
      exerciseId: EXERCISE,
      grade: 5,
    });
    const forged = { ...original, grade: 1 } as const;
    await a.engine.sync.import([original]);
    const result = await a.engine.sync.import([forged]);
    expect(result.conflicts).toBe(1);
    expect(a.events.some(({ type }) => type === 'sync-conflict')).toBe(true);
    expect((await a.engine.practice.getAttempts(EXERCISE)).items).toEqual([]); // обе стороны скрыты
    const [conflict] = (await a.engine.sync.getConflicts()).items;
    expect(conflict?.reason).toBe('id-content');

    const resolved = await a.engine.sync.resolveConflict({
      conflictId: conflict!.conflictId,
      keep: 'same-id',
    });
    expect(resolved).toMatchObject({ kept: 'same-id', rebuilt: true });
    expect((await a.engine.practice.getAttempts(EXERCISE)).items).toHaveLength(
      1,
    );
    expect((await a.engine.sync.getConflicts()).items).toEqual([]);
    await a.engine.close();

    const restarted = await createTestEngine(
      options('conflict', 'device-a', clock),
    );
    expect((await restarted.engine.sync.getConflicts()).items).toEqual([]);
    expect(
      (await restarted.engine.practice.getAttempts(EXERCISE)).items,
    ).toHaveLength(1);
    // повторный импорт не возвращает решённый конфликт
    expect(
      await restarted.engine.sync.import([original, forged]),
    ).toMatchObject({ conflicts: 0 });
    expect((await restarted.engine.sync.getConflicts()).items).toEqual([]);
  });
});
