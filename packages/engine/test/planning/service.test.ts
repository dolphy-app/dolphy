import type { DayPlanDto } from '@lms/engine-contract';
import { buildLibrary } from '@lms/testkit';
import { describe, expect, test } from 'vitest';
import { EngineError } from '../../src/app/index.ts';
import { createTestEngine } from '../helpers/engine.ts';
import type { TestEngine } from '../helpers/engine.ts';

const DAY_MS = 86_400_000;

const codeOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    if (error instanceof EngineError) return error.code;
    throw error;
  }
  return null;
};

/** Курс `k`: a ← b ← t по три упражнения. */
const chain = () =>
  buildLibrary({
    courses: [
      {
        id: 'k',
        lessons: [
          { id: 'a', exercises: 3 },
          { id: 'b', dependencies: ['a'], exercises: 3 },
          { id: 't', dependencies: ['b'], exercises: 3 },
        ],
      },
    ],
  });

let requests = 0;
const attempt = async (
  t: TestEngine,
  exerciseId: string,
  grade: 1 | 2 | 3 | 4 | 5 = 4,
  times = 1,
) => {
  for (let i = 0; i < times; i++) {
    t.clock.advance(1000);
    requests += 1;
    await t.engine.practice.recordAttempt({
      requestId: `req-${requests}`,
      exerciseId,
      grade,
    });
  }
};

const reasons = (plan: DayPlanDto) =>
  Object.fromEntries(plan.items.map((item) => [item.exerciseId, item.reason]));

describe('plan.getDay', () => {
  test('validates arguments', async () => {
    const t = await createTestEngine({ library: chain() });
    const { plan } = t.engine;
    for (const maxItems of [0, 201, 2.5, Number.NaN]) {
      expect(await codeOf(() => plan.getDay({ maxItems }))).toBe(
        'INVALID_ARGUMENT',
      );
    }
    expect(
      await codeOf(() => plan.getDay({ maxItems: 5, seed: 2 ** 32 })),
    ).toBe('INVALID_ARGUMENT');
    expect(await codeOf(() => plan.getDay({ maxItems: 5, seed: 1.5 }))).toBe(
      'INVALID_ARGUMENT',
    );
  });

  test('a fresh profile gets the frontier lessons as new items', async () => {
    const t = await createTestEngine({ library: chain() });
    const day = await t.engine.plan.getDay({ maxItems: 10, seed: 1 });
    expect(reasons(day)).toEqual({
      'k::a::e0': 'new',
      'k::a::e1': 'new',
      'k::a::e2': 'new',
    });
    expect(day.seed).toBe(1);
    expect(day.implicitCreditEnabled).toBe(false);
    expect(day.generatedAt).toBe(t.clock.now());
    expect(day.items.every((item) => item.covers === undefined)).toBe(true);
  });

  test('due exercises are reviews, the next lesson opens once the gate passes, size is bounded', async () => {
    const t = await createTestEngine({ library: chain() });
    for (const e of ['e0', 'e1', 'e2']) await attempt(t, `k::a::${e}`, 4, 2);
    // через 3 дня упражнения a просрочены (R ≤ 0.9), а оценка a ещё держит гейт
    t.clock.advance(3 * DAY_MS);
    const day = await t.engine.plan.getDay({ maxItems: 4, seed: 7 });
    expect(day.items.length).toBeLessThanOrEqual(4);
    const byReason = reasons(day);
    const review = Object.entries(byReason).filter(([, r]) => r === 'review');
    const fresh = Object.entries(byReason).filter(([, r]) => r === 'new');
    expect(review.length).toBe(3);
    expect(review.every(([id]) => id.startsWith('k::a::'))).toBe(true);
    // резерв ceil(0.25·4) = 1 под новое: следующий урок b
    expect(fresh.length).toBe(1);
    expect(fresh[0]?.[0].startsWith('k::b::')).toBe(true);
    expect(new Set(day.items.map((item) => item.exerciseId)).size).toBe(
      day.items.length,
    );
  });

  test('the same seed gives the same plan; no seed draws one from the engine Rng and echoes it', async () => {
    const t = await createTestEngine({ library: chain() });
    for (const e of ['e0', 'e1', 'e2']) await attempt(t, `k::a::${e}`, 4, 2);
    t.clock.advance(30 * DAY_MS);
    const a = await t.engine.plan.getDay({ maxItems: 5, seed: 42 });
    const b = await t.engine.plan.getDay({ maxItems: 5, seed: 42 });
    expect(b.items).toEqual(a.items);
    const drawn = await t.engine.plan.getDay({ maxItems: 5 });
    expect(Number.isInteger(drawn.seed)).toBe(true);
    const replay = await t.engine.plan.getDay({
      maxItems: 5,
      seed: drawn.seed,
    });
    expect(replay.items).toEqual(drawn.items);
  });

  test('does not change SessionState, the journal or later batches', async () => {
    const run = async (withPlans: boolean) => {
      const t = await createTestEngine({ library: 'sql-course', seed: 9 });
      for (const e of ['q1', 'q2', 'q3']) {
        await attempt(t, `sql_json::ddl::${e}`, 4, 2);
      }
      t.clock.advance(20 * DAY_MS);
      const entries = t.eventStore.entryCount();
      if (withPlans) {
        for (let seed = 1; seed <= 3; seed++) {
          await t.engine.plan.getDay({ maxItems: 10, seed });
        }
        expect(t.eventStore.entryCount()).toBe(entries);
        expect(t.ctx.session.trialCounts()).toEqual({ success: 6, failed: 0 });
        for (const q of ['q1', 'q2', 'q3']) {
          expect(t.ctx.session.frequencyOf(`sql_json::ddl::${q}`)).toBe(0);
        }
      }
      const batch = await t.engine.practice.getBatch();
      return batch.exercises.map((exercise) => exercise.id);
    };
    expect(await run(true)).toEqual(await run(false));
  });

  test('pending remediation goes in before new items and counts against maxItems', async () => {
    const t = await createTestEngine({ library: chain() });
    for (const e of ['e0', 'e1', 'e2']) await attempt(t, `k::a::${e}`, 4, 2);
    await attempt(t, 'k::b::e0', 1, 2); // две неудачи подряд → ремедиация по a
    const remediation = await t.engine.remediation.getPlan({
      exerciseId: 'k::b::e0',
    });
    expect(remediation.active).toBe(true);

    const wide = await t.engine.plan.getDay({ maxItems: 10, seed: 1 });
    const byReason = reasons(wide);
    expect(
      Object.entries(byReason)
        .filter(([, r]) => r === 'remediation')
        .map(([id]) => id)
        .sort(),
    ).toEqual(['k::a::e0', 'k::a::e1', 'k::a::e2']);
    expect(byReason['k::b::e1']).toBe('new');

    const narrow = await t.engine.plan.getDay({ maxItems: 4, seed: 1 });
    expect(narrow.items.length).toBeLessThanOrEqual(4);
    const counts = (plan: DayPlanDto, reason: string) =>
      plan.items.filter((item) => item.reason === reason).length;
    expect(counts(narrow, 'remediation')).toBe(3);
    expect(counts(narrow, 'new')).toBe(1);

    const tiny = await t.engine.plan.getDay({ maxItems: 2, seed: 1 });
    expect(tiny.items.length).toBe(2);
    expect(counts(tiny, 'remediation')).toBeGreaterThan(0);
  });

  test('blacklisted exercises are excluded from the plan', async () => {
    const t = await createTestEngine({ library: chain() });
    await t.engine.curation.blacklist.add('k::a::e1');
    const day = await t.engine.plan.getDay({ maxItems: 10, seed: 1 });
    expect(Object.keys(reasons(day)).sort()).toEqual(['k::a::e0', 'k::a::e2']);
  });
});

describe('plan.getDay with implicit credit', () => {
  /** Урок `t` охватывает `a` (вес 1): повтор `t` неявно повторяет `a`. */
  const encompassing = () => {
    const library = buildLibrary({
      courses: [
        {
          id: 'k',
          lessons: [
            { id: 'a', exercises: 2 },
            { id: 't', dependencies: ['a'], exercises: 2 },
          ],
        },
      ],
    });
    const lesson = library.lessons.find(({ id }) => id === 'k::t');
    if (lesson === undefined) throw new Error('lesson t');
    lesson.encompassed = [['k::a', 1]];
    return library;
  };

  const prepare = async () => {
    const t = await createTestEngine({ library: encompassing() });
    await attempt(t, 'k::a::e0', 4, 2);
    await attempt(t, 'k::t::e0', 4, 2);
    t.clock.advance(20 * DAY_MS);
    return t;
  };

  test('off by default: no covers, and enabling covers the encompassed exercise', async () => {
    const t = await prepare();
    const off = await t.engine.plan.getDay({ maxItems: 4, seed: 3 });
    expect(off.implicitCreditEnabled).toBe(false);
    expect(off.items.every((item) => item.covers === undefined)).toBe(true);

    await t.engine.settings.setScheduler({ implicitCredit: { enabled: true } });
    const on = await t.engine.plan.getDay({ maxItems: 4, seed: 3 });
    expect(on.implicitCreditEnabled).toBe(true);
    const hard = on.items.find((item) => item.exerciseId === 'k::t::e0');
    expect(hard?.covers).toBeDefined();
    const covered = hard?.covers?.find(
      (cover) => cover.exerciseId === 'k::a::e0',
    );
    expect(covered?.credit).toBeCloseTo(0.9, 12);
    // кредит выключен обратно — план возвращается к прежнему
    await t.engine.settings.setScheduler({
      implicitCredit: { enabled: false },
    });
    const again = await t.engine.plan.getDay({ maxItems: 4, seed: 3 });
    expect(again.items).toEqual(off.items);
  });
});
