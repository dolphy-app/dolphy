/**
 * T-50: план дня — инварианты жадного взвешенного покрытия (порт
 * `spike/fire-plan/test/planner.test.ts`), правило фронтира и ремедиация
 * продукции (состояние приходит снаружи, `PlanState`).
 */
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import type { UnitId } from '@lms/engine-contract';
import { MS_PER_DAY } from '../../src/scoring/constants.ts';
import { createCreditModel } from '../../src/planning/credit-model.ts';
import { createMemoryIndex } from '../../src/planning/memory-index.ts';
import { buildPlanGraph } from '../../src/planning/plan-graph.ts';
import { createPlanner } from '../../src/planning/planner.ts';
import type {
  PlanState,
  PlannerOptions,
  ResidualUpdate,
} from '../../src/planning/planner.ts';
import { createSeededRng } from '../../src/planning/seeded-random.ts';
import {
  CREDIT_ON,
  PLANNER_OPTIONS,
  REGIMES,
  T0,
  attemptOf,
  buildSpecLibrary,
  memoryModel,
  planStateOf,
  retrievabilityOf,
  world,
} from './helpers.ts';
import type { LessonSpec, Regime } from './helpers.ts';

const planArb = fc.record({
  seed: fc.integer({ min: 1, max: 1e6 }),
  regime: fc.constantFrom<Regime>(...REGIMES),
  maxItems: fc.integer({ min: 1, max: 40 }),
  planSeed: fc.integer({ min: 1, max: 1e6 }),
  update: fc.constantFrom<ResidualUpdate>('subtractive', 'multiplicative'),
});

describe('planner invariants (T-50)', () => {
  test('maxItems, uniqueness, determinism, non-increasing gains, covers are due with CreditModel weights, new reserve, reasons', () => {
    let multiCover = 0;
    let withNew = 0;
    fc.assert(
      fc.property(planArb, ({ seed, regime, maxItems, planSeed, update }) => {
        const { graph, credit, index, now } = world(seed, regime);
        const planner = createPlanner(graph, credit, PLANNER_OPTIONS, update);
        const state = planStateOf(graph, index, now);
        const a = planner.planDayDetailed(state, {
          maxItems,
          rng: createSeededRng(planSeed),
        });
        const b = planner.planDayDetailed(state, {
          maxItems,
          rng: createSeededRng(planSeed),
        });
        expect(b.items).toEqual(a.items);
        expect(a.items.length).toBeLessThanOrEqual(maxItems);
        expect(new Set(a.items.map((item) => item.exerciseId)).size).toBe(
          a.items.length,
        );
        expect(a.items.length).toBe(
          a.greedy.length + a.items.filter((item) => item.gain === 0).length,
        );
        for (let i = 1; i < a.greedy.length; i++) {
          expect((a.greedy[i] as { gain: number }).gain).toBeLessThanOrEqual(
            (a.greedy[i - 1] as { gain: number }).gain + 1e-12,
          );
        }
        const due = new Set(state.due.map((entry) => entry.exerciseId));
        expect(a.dueCount).toBe(due.size);
        if (a.items.some((item) => item.reason === 'new')) withNew++;
        for (const item of a.greedy) {
          if (item.covers.length > 1) multiCover++;
          expect(item.gain).toBeGreaterThan(0);
          expect(item.covers.length).toBeGreaterThan(0);
          const source = graph.exerciseLesson[
            graph.exerciseIndex.get(item.exerciseId) as number
          ] as number;
          const weights = new Map(
            credit
              .of(source)
              .map((entry) => [graph.lessonIds[entry.lesson], entry.weight]),
          );
          for (const cover of item.covers) {
            expect(cover.credit).toBeGreaterThan(0);
            expect(due.has(cover.exerciseId)).toBe(true);
            const targetLesson = graph.lessonIds[
              graph.exerciseLesson[
                graph.exerciseIndex.get(cover.exerciseId) as number
              ] as number
            ] as UnitId;
            if (cover.exerciseId === item.exerciseId) {
              expect(cover.credit).toBe(1);
            } else {
              expect(cover.credit).toBeCloseTo(
                weights.get(targetLesson) as number,
                12,
              );
            }
          }
        }
        // резерв под новое: не меньше min(ceil(0.25·max), доступных, max)
        const reserve = Math.min(
          Math.ceil(0.25 * maxItems),
          a.newAvailable,
          maxItems,
        );
        expect(
          a.items.filter((item) => item.reason === 'new').length,
        ).toBeGreaterThanOrEqual(reserve);
        for (const item of a.items) {
          expect(item.reason === 'new').toBe(
            !state.hasAttempts(item.exerciseId),
          );
        }
      }),
      { seed: 11, numRuns: 150 },
    );
    // проверка не пуста: были и сжатия, и новое
    expect(multiCover).toBeGreaterThan(0);
    expect(withNew).toBeGreaterThan(0);
  });

  test('lazy greedy == naive full rescan (same picks, same gains)', () => {
    fc.assert(
      fc.property(planArb, ({ seed, regime, maxItems, planSeed, update }) => {
        const { graph, credit, index, now } = world(seed, regime);
        const planner = createPlanner(graph, credit, PLANNER_OPTIONS, update);
        const state = planStateOf(graph, index, now);
        const lazy = planner.planDayDetailed(state, {
          maxItems,
          rng: createSeededRng(planSeed),
        });
        const naive = planner.planDayDetailed(state, {
          maxItems,
          rng: createSeededRng(planSeed),
          naive: true,
        });
        expect(lazy.greedy.map((item) => [item.exerciseId, item.gain])).toEqual(
          naive.greedy.map((item) => [item.exerciseId, item.gain]),
        );
        expect(lazy.items).toEqual(naive.items);
      }),
      { seed: 12, numRuns: 100 },
    );
  });

  test('the plan is a pure function of state and the rng stream: different seeds change only tie-breaks and order', () => {
    const { graph, credit, index, now } = world(8, 'trane', 60, 300);
    const planner = createPlanner(graph, credit, PLANNER_OPTIONS);
    const state = planStateOf(graph, index, now);
    expect(state.due.length).toBeGreaterThan(10);
    const plans = [1, 2, 3, 4].map((seed) =>
      planner.planDay(state, { maxItems: 12, rng: createSeededRng(seed) }),
    );
    for (const plan of plans) expect(plan.length).toBeLessThanOrEqual(12);
    // жадный выигрыш первого шага не зависит от тай-брейка
    const firstGains = [1, 2, 3, 4].map(
      (seed) =>
        planner.planDayDetailed(state, {
          maxItems: 12,
          rng: createSeededRng(seed),
        }).greedy[0]?.gain,
    );
    expect(new Set(firstGains).size).toBe(1);
  });

  test('without a credit model greedy degenerates to lowest-R-first, every item covers only itself', () => {
    const { graph, index, now } = world(5, 'trane');
    const planner = createPlanner(graph, null, {
      ...PLANNER_OPTIONS,
      minNewFraction: 0,
    });
    const state = planStateOf(graph, index, now);
    const maxItems = 10;
    const detail = planner.planDayDetailed(state, {
      maxItems,
      rng: createSeededRng(1),
    });
    const retrievability = (id: string) => retrievabilityOf(index, id, now);
    const order = detail.greedy.map((item) => retrievability(item.exerciseId));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(
      detail.greedy.every(
        (item) =>
          item.covers.length === 1 &&
          item.covers[0]?.exerciseId === item.exerciseId,
      ),
    ).toBe(true);
    // выбраны именно самые забытые из просроченных
    expect(state.due.length).toBeGreaterThan(maxItems);
    expect(detail.greedy).toHaveLength(maxItems);
    const picked = new Set(detail.greedy.map((item) => item.exerciseId));
    const worstPicked = Math.max(...order);
    for (const entry of state.due) {
      if (!picked.has(entry.exerciseId)) {
        expect(entry.retrievability).toBeGreaterThanOrEqual(worstPicked);
      }
    }
  });

  test('a hard exercise covers several due basics in one item (hand-built)', () => {
    const lesson = (id: string, deps: string[]): LessonSpec => ({
      id,
      courseId: 'course',
      deps,
      exercises: [`${id}::e0`],
      tags: [],
    });
    const library = buildSpecLibrary([
      lesson('a', []),
      lesson('b', []),
      lesson('t', ['a', 'b']),
    ]);
    const graph = buildPlanGraph(library, 'graph');
    const credit = createCreditModel(graph, CREDIT_ON.implicitCredit);
    const index = createMemoryIndex({
      memoryModel,
      options: () => CREDIT_ON,
      encompassMode: 'graph',
    });
    index.rebuild(
      ['a::e0', 'b::e0', 't::e0'].map((id, seq) =>
        attemptOf(seq, T0 + seq * 1000, id, 5),
      ),
      library,
    );
    const now = T0 + 400 * MS_PER_DAY; // всё давно просрочено
    const state = planStateOf(graph, index, now);
    expect(state.due).toHaveLength(3);
    const planner = createPlanner(graph, credit, {
      ...PLANNER_OPTIONS,
      minNewFraction: 0,
    });
    const plan = planner.planDay(state, {
      maxItems: 1,
      rng: createSeededRng(1),
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]?.exerciseId).toBe('t::e0');
    expect(plan[0]?.covers.map((cover) => cover.exerciseId).sort()).toEqual([
      'a::e0',
      'b::e0',
      't::e0',
    ]);
    expect(
      plan[0]?.covers.find((cover) => cover.exerciseId === 'a::e0')?.credit,
    ).toBeCloseTo(0.9, 12);
    // без кредит-модели на один слот — только одно упражнение
    const bare = createPlanner(graph, null, {
      ...PLANNER_OPTIONS,
      minNewFraction: 0,
    }).planDayDetailed(state, { maxItems: 1, rng: createSeededRng(1) });
    expect(bare.items).toHaveLength(1);
    expect(bare.items[0]?.covers).toHaveLength(1);
    // три слота: кредит-модель закрывает всё за один-два элемента, остальные слоты свободны
    const wide = planner.planDayDetailed(state, {
      maxItems: 3,
      rng: createSeededRng(1),
    });
    expect(wide.items.length).toBeLessThanOrEqual(3);
    expect(wide.greedy[0]?.exerciseId).toBe('t::e0');
    expect(wide.dueCovered).toBe(3);
  });

  test('due entries outside the library are ignored', () => {
    const { graph, credit, index, now } = world(3, 'none');
    const planner = createPlanner(graph, credit, PLANNER_OPTIONS);
    const state = planStateOf(graph, index, now);
    const withGhost: PlanState = {
      ...state,
      due: [...state.due, { exerciseId: 'ghost::l::e0', retrievability: 0 }],
    };
    const request = { maxItems: 8, rng: createSeededRng(4) };
    const clean = planner.planDay(state, {
      maxItems: 8,
      rng: createSeededRng(4),
    });
    const dirty = planner.planDay(withGhost, request);
    expect(dirty.map((item) => item.exerciseId)).not.toContain('ghost::l::e0');
    expect(dirty).toEqual(clean);
  });
});

// Ручная библиотека для правил новых упражнений и ремедиации.
// Курс X: урок `s` (начат), `x1`, `x2` (фронтир); курс Y: `y1` (фронтир).
const lessonOf = (id: string, courseId: string, count: number): LessonSpec => ({
  id,
  courseId,
  deps: [],
  exercises: Array.from({ length: count }, (_, i) => `${id}::e${i}`),
  tags: [],
});
const fixture = () => {
  const library = buildSpecLibrary([
    lessonOf('X::s', 'X', 3),
    lessonOf('X::x1', 'X', 2),
    lessonOf('X::x2', 'X', 2),
    lessonOf('Y::y1', 'Y', 2),
  ]);
  const graph = buildPlanGraph(library, 'declared');
  const stateOf = (overrides: Partial<PlanState> = {}): PlanState => ({
    due: [],
    hasAttempts: (id) => id === 'X::s::e0',
    frontierLessons: ['X::x1', 'X::x2', 'Y::y1'],
    lessonPasses: () => true,
    isExcluded: () => false,
    remediation: [],
    ...overrides,
  });
  const options: PlannerOptions = {
    minNewFraction: 0.25,
    maxSameCourseRun: 3,
    minTagDistance: 1,
    fillWithNew: true,
  };
  return { graph, stateOf, options };
};
const idsOf = (items: readonly { exerciseId: string }[]) =>
  items.map((item) => item.exerciseId).sort();
const lessonIdOf = (exerciseId: string) =>
  exerciseId.split('::').slice(0, 2).join('::');

describe('new exercises: started lessons first, then the frontier round-robin over courses', () => {
  const { graph, stateOf, options } = fixture();
  const planner = createPlanner(graph, null, options);

  test('the unattempted rest of a started lesson comes before any frontier lesson', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const plan = planner.planDay(stateOf(), {
        maxItems: 2,
        rng: createSeededRng(seed),
      });
      expect(idsOf(plan)).toEqual(['X::s::e1', 'X::s::e2']);
    }
  });

  test('frontier lessons follow one per course in turn: never a second lesson of one course before the first of the other', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const plan = planner.planDay(stateOf(), {
        maxItems: 6,
        rng: createSeededRng(seed),
      });
      // 2 (начатый урок) + x1 и y1 целиком; x2 — только после круга
      expect(idsOf(plan)).toEqual([
        'X::s::e1',
        'X::s::e2',
        'X::x1::e0',
        'X::x1::e1',
        'Y::y1::e0',
        'Y::y1::e1',
      ]);
    }
  });

  test('the first frontier lesson is of a random course (the course order comes from rng)', () => {
    const firsts = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const plan = planner.planDay(stateOf(), {
        maxItems: 4,
        rng: createSeededRng(seed),
      });
      const frontier = plan.filter(
        (item) => lessonIdOf(item.exerciseId) !== 'X::s',
      );
      expect(frontier).toHaveLength(2);
      firsts.add(lessonIdOf(frontier[0]?.exerciseId as string));
    }
    expect(firsts).toEqual(new Set(['X::x1', 'Y::y1']));
  });

  test('everything is offered when there is room; a started lesson listed on the frontier is not doubled', () => {
    const plan = planner.planDay(
      stateOf({ frontierLessons: ['X::s', 'X::x1', 'X::x2', 'Y::y1'] }),
      { maxItems: 20, rng: createSeededRng(3) },
    );
    const all = graph.exerciseIds.filter((id) => id !== 'X::s::e0');
    expect(idsOf(plan)).toEqual([...all].sort());
    expect(plan.every((item) => item.reason === 'new')).toBe(true);
  });

  test('isExcluded removes exercises, lessons and courses from new items', () => {
    const excludedExercise = planner.planDay(
      stateOf({ isExcluded: (id) => id === 'X::s::e1' }),
      { maxItems: 20, rng: createSeededRng(3) },
    );
    expect(idsOf(excludedExercise)).not.toContain('X::s::e1');
    expect(idsOf(excludedExercise)).toContain('X::s::e2');
    const excludedLesson = planner.planDay(
      stateOf({ isExcluded: (id) => id.startsWith('Y::y1') }),
      { maxItems: 20, rng: createSeededRng(3) },
    );
    expect(
      excludedLesson.some((item) => item.exerciseId.startsWith('Y::')),
    ).toBe(false);
    expect(excludedLesson).toHaveLength(6);
    const excludedCourse = planner.planDay(
      stateOf({ isExcluded: (id) => id.startsWith('X::') }),
      { maxItems: 20, rng: createSeededRng(3) },
    );
    expect(idsOf(excludedCourse)).toEqual(['Y::y1::e0', 'Y::y1::e1']);
  });

  test('the new reserve is ceil(minNewFraction · maxItems) when fillWithNew is off and nothing is due', () => {
    const strict = createPlanner(graph, null, {
      ...options,
      fillWithNew: false,
    });
    for (const [maxItems, expected] of [
      [1, 1],
      [4, 1],
      [5, 2],
      [8, 2],
      [10, 3],
    ] as const) {
      const plan = strict.planDay(stateOf(), {
        maxItems,
        rng: createSeededRng(1),
      });
      expect(plan).toHaveLength(expected);
    }
    // с добором — вся свободная ёмкость
    expect(
      planner.planDay(stateOf(), { maxItems: 5, rng: createSeededRng(1) }),
    ).toHaveLength(5);
  });

  test('new items have no covers and zero gain; no candidates gives an empty plan', () => {
    const plan = planner.planDayDetailed(stateOf(), {
      maxItems: 4,
      rng: createSeededRng(2),
    });
    for (const item of plan.items) {
      expect(item.covers).toEqual([]);
      expect(item.gain).toBe(0);
    }
    const nothing = planner.planDayDetailed(
      stateOf({ frontierLessons: [], hasAttempts: () => true }),
      { maxItems: 4, rng: createSeededRng(2) },
    );
    expect(nothing.items).toEqual([]);
    expect(nothing.newAvailable).toBe(0);
  });

  test('a started lesson below the passing threshold is practised without being due; a passing one is not', () => {
    // X::s начат (e0), остальные упражнения — новые; фронтира нет
    const request = { maxItems: 5, rng: createSeededRng(3) };
    const reasonsById = (state: PlanState) =>
      Object.fromEntries(
        planner
          .planDay(state, request)
          .map(({ exerciseId, reason }) => [exerciseId, reason]),
      );
    const unfinished = stateOf({
      frontierLessons: [],
      lessonPasses: (lessonId) => lessonId !== 'X::s',
    });
    expect(reasonsById(unfinished)).toEqual({
      'X::s::e0': 'review',
      'X::s::e1': 'new',
      'X::s::e2': 'new',
    });
    expect(reasonsById(stateOf({ frontierLessons: [] }))).toEqual({
      'X::s::e1': 'new',
      'X::s::e2': 'new',
    });
    // исключённое упражнение не возвращается в план
    expect(
      reasonsById({
        ...unfinished,
        isExcluded: (id) => id === 'X::s::e0',
      }),
    ).not.toHaveProperty('X::s::e0');
  });
});

describe('remediation (T-55)', () => {
  const { graph, stateOf, options } = fixture();
  const planner = createPlanner(graph, null, options);
  const due = (ids: string[]): PlanState['due'] =>
    ids.map((exerciseId, i) => ({
      exerciseId,
      retrievability: 0.1 + 0.05 * i,
    }));
  const reasonsOf = (items: readonly { reason: string }[]) =>
    items.map((item) => item.reason);

  test('remediation items come after the greedy due items, displace new ones and count against maxItems', () => {
    // due: 2 упражнения; maxItems 5 → резерв 2, greedy 2, слоты для ремедиации 3
    const state = stateOf({
      due: due(['X::s::e0', 'X::x1::e0']),
      hasAttempts: (id) => id === 'X::s::e0' || id === 'X::x1::e0',
      remediation: ['Y::y1::e0', 'Y::y1::e1'],
    });
    const plan = planner.planDayDetailed(state, {
      maxItems: 5,
      rng: createSeededRng(1),
    });
    expect(plan.items.length).toBeLessThanOrEqual(5);
    const remediation = plan.items.filter(
      (item) => item.reason === 'remediation',
    );
    expect(idsOf(remediation)).toEqual(['Y::y1::e0', 'Y::y1::e1']);
    for (const item of remediation) {
      expect(item.covers).toEqual([]);
      expect(item.gain).toBe(0);
    }
    // просроченные не вытеснены
    expect(idsOf(plan.greedy)).toEqual(['X::s::e0', 'X::x1::e0']);
    expect(reasonsOf(plan.greedy)).toEqual(['review', 'review']);
    // оставшийся слот — новое
    expect(plan.items).toHaveLength(5);
    expect(plan.items.filter((item) => item.reason === 'new')).toHaveLength(1);
  });

  test('the reserve for new is displaced by remediation, due items are not', () => {
    const ids = ['X::s::e0', 'X::x1::e0', 'X::x1::e1'];
    const state = stateOf({
      due: due(ids),
      hasAttempts: (id) => ids.includes(id),
      remediation: ['Y::y1::e0', 'Y::y1::e1', 'X::x2::e0'],
    });
    // maxItems 4: резерв 1 → greedy 3 (все просроченные), слот под ремедиацию 1
    const plan = planner.planDayDetailed(state, {
      maxItems: 4,
      rng: createSeededRng(1),
    });
    expect(plan.items).toHaveLength(4);
    expect(idsOf(plan.greedy)).toEqual([...ids].sort());
    expect(plan.items.filter((item) => item.reason === 'new')).toHaveLength(0);
    // приоритет — по порядку в списке ремедиации
    expect(
      plan.items
        .filter((item) => item.reason === 'remediation')
        .map((i) => i.exerciseId),
    ).toEqual(['Y::y1::e0']);
    // когда просроченных больше, чем слотов без резерва, ремедиации не остаётся места
    const crowded = planner.planDayDetailed(
      stateOf({
        due: due(ids),
        hasAttempts: (id) => ids.includes(id),
        remediation: ['Y::y1::e0'],
      }),
      { maxItems: 3, rng: createSeededRng(1) },
    );
    // резерв 1 → greedy 2; ремедиация занимает третий слот, третье просроченное не берётся
    expect(crowded.greedy).toHaveLength(2);
    expect(crowded.items).toHaveLength(3);
    expect(
      reasonsOf(crowded.items).filter((r) => r === 'remediation'),
    ).toHaveLength(1);
  });

  test('duplicates of greedy picks and of each other are not repeated; excluded and unknown ones are skipped', () => {
    const state = stateOf({
      due: due(['X::s::e0', 'X::x1::e0']),
      hasAttempts: (id) => id === 'X::s::e0' || id === 'X::x1::e0',
      isExcluded: (id) => id === 'Y::y1::e1',
      remediation: [
        'X::s::e0', // уже выбран жадно
        'Y::y1::e0',
        'Y::y1::e0', // дубль в самой ремедиации
        'Y::y1::e1', // исключён
        'ghost::l::e0', // вне библиотеки
        'X::x2::e1',
      ],
    });
    const plan = planner.planDayDetailed(state, {
      maxItems: 10,
      rng: createSeededRng(1),
    });
    const ids = plan.items.map((item) => item.exerciseId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      plan.items
        .filter((item) => item.reason === 'remediation')
        .map((item) => item.exerciseId)
        .sort(),
    ).toEqual(['X::x2::e1', 'Y::y1::e0']);
    expect(ids).not.toContain('Y::y1::e1');
    expect(ids).not.toContain('ghost::l::e0');
    // жадный выбор сохранил свой 'review'
    expect(
      plan.items.find((item) => item.exerciseId === 'X::s::e0')?.reason,
    ).toBe('review');
  });

  test('remediation never exceeds maxItems and is empty-safe', () => {
    for (const maxItems of [1, 2, 3]) {
      const plan = planner.planDay(
        stateOf({
          remediation: ['Y::y1::e0', 'Y::y1::e1', 'X::x2::e0', 'X::x2::e1'],
        }),
        { maxItems, rng: createSeededRng(5) },
      );
      expect(plan).toHaveLength(maxItems);
      expect(plan.every((item) => item.reason === 'remediation')).toBe(true);
    }
    const none = planner.planDay(stateOf(), {
      maxItems: 3,
      rng: createSeededRng(5),
    });
    expect(none.some((item) => item.reason === 'remediation')).toBe(false);
  });

  test('remediation exercises are not offered again as new', () => {
    const plan = planner.planDay(stateOf({ remediation: ['X::s::e1'] }), {
      maxItems: 20,
      rng: createSeededRng(2),
    });
    const matching = plan.filter((item) => item.exerciseId === 'X::s::e1');
    expect(matching).toHaveLength(1);
    expect(matching[0]?.reason).toBe('remediation');
  });
});

describe('PlanState is not mutated', () => {
  const deepFreeze = <T>(value: T): T => {
    if (typeof value === 'object' && value !== null) {
      for (const inner of Object.values(value)) deepFreeze(inner);
      Object.freeze(value);
    }
    return value;
  };

  test('a frozen state plans without touching it, on a random world and with remediation', () => {
    const { graph, credit, index, now } = world(9, 'trane', 50, 250);
    const planner = createPlanner(graph, credit, PLANNER_OPTIONS);
    const base = planStateOf(graph, index, now);
    const remediation = graph.exerciseIds.slice(0, 5);
    const state = deepFreeze({ ...base, remediation });
    const snapshot = structuredClone({
      due: state.due,
      frontier: state.frontierLessons,
      remediation: state.remediation,
    });
    const first = planner.planDay(state, {
      maxItems: 30,
      rng: createSeededRng(1),
    });
    const second = planner.planDay(state, {
      maxItems: 30,
      rng: createSeededRng(1),
    });
    expect(second).toEqual(first);
    expect({
      due: state.due,
      frontier: state.frontierLessons,
      remediation: state.remediation,
    }).toEqual(snapshot);
  });
});
