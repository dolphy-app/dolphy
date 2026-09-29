/**
 * T-51: веса неявного кредита `max по путям (∏ весов · λ^глубина)` на ручных
 * графах (порт `spike/fire-plan/test/credit.test.ts`) и `kappa` продукции.
 */
import { describe, expect, test } from 'vitest';
import { UnitGraphError } from '../../src/domain/graph.ts';
import { createCreditModel } from '../../src/planning/credit-model.ts';
import type { CreditParams } from '../../src/planning/credit-model.ts';
import { buildPlanGraph } from '../../src/planning/plan-graph.ts';
import type { EncompassMode } from '../../src/planning/plan-graph.ts';
import { buildSpecLibrary } from './helpers.ts';
import type { LessonSpec } from './helpers.ts';

const lesson = (
  id: string,
  deps: string[],
  encompassed?: [string, number][],
): LessonSpec => ({
  id,
  courseId: 'course',
  deps,
  ...(encompassed === undefined ? {} : { encompassed }),
  exercises: [`${id}::e0`],
  tags: [],
});

const DEFAULTS: CreditParams = { lambda: 0.9, minCredit: 0.2, kappa: 1 };

const credits = (
  specs: LessonSpec[],
  mode: EncompassMode,
  source: string,
  params: Partial<CreditParams> = {},
): Record<string, number> => {
  const graph = buildPlanGraph(buildSpecLibrary(specs), mode);
  const model = createCreditModel(graph, { ...DEFAULTS, ...params });
  return Object.fromEntries(
    model
      .of(graph.lessonIndex.get(source) as number)
      .map((entry) => [graph.lessonIds[entry.lesson] as string, entry.weight]),
  );
};

const chain = (length: number) => {
  const specs = [lesson('n0', [])];
  for (let i = 1; i < length; i++) specs.push(lesson(`n${i}`, [`n${i - 1}`]));
  return specs;
};

describe('credit weight = max over paths of prod(edge) * lambda^depth', () => {
  test('graph A: default chain d->c->b->a, all edges 1.0', () => {
    const specs = [
      lesson('a', []),
      lesson('b', ['a']),
      lesson('c', ['b']),
      lesson('d', ['c']),
    ];
    const result = credits(specs, 'graph', 'd');
    expect(result['c']).toBeCloseTo(0.9, 12);
    expect(result['b']).toBeCloseTo(0.81, 12);
    expect(result['a']).toBeCloseTo(0.729, 12);
    expect(Object.keys(result).sort()).toEqual(['a', 'b', 'c']);
    // minCredit 0.8 оставляет c (0.9) и b (0.81), отбрасывает a (0.729)
    expect(
      Object.keys(credits(specs, 'graph', 'd', { minCredit: 0.8 })).sort(),
    ).toEqual(['b', 'c']);
    // сам источник не получает кредита; лист — тоже ничего
    expect(credits(specs, 'graph', 'a')).toEqual({});
  });

  test('graph B: diamond takes the MAX path, not the sum', () => {
    // T -> M1 (0.5), T -> M2 (1.0), M1 -> B (1.0), M2 -> B (0.6)
    const specs = [
      lesson('B', []),
      lesson('M1', ['B'], [['B', 1]]),
      lesson('M2', ['B'], [['B', 0.6]]),
      lesson(
        'T',
        ['M1', 'M2'],
        [
          ['M1', 0.5],
          ['M2', 1],
        ],
      ),
    ];
    const result = credits(specs, 'declared', 'T');
    expect(result['M1']).toBeCloseTo(0.45, 12);
    expect(result['M2']).toBeCloseTo(0.9, 12);
    // через M2: 0.9·0.6·0.9 = 0.486; через M1: 0.405
    expect(result['B']).toBeCloseTo(0.9 * 0.6 * 0.9, 12);
  });

  test('graph C: cutoff below minCredit, boundary equality kept', () => {
    // T->X 0.5, X->Y 0.5, Y->Z 0.9: X .45, Y .2025 (kept), Z .164 (dropped)
    const specs = [
      lesson('Z', []),
      lesson('Y', ['Z'], [['Z', 0.9]]),
      lesson('X', ['Y'], [['Y', 0.5]]),
      lesson('T', ['X'], [['X', 0.5]]),
    ];
    const result = credits(specs, 'declared', 'T');
    expect(Object.keys(result).sort()).toEqual(['X', 'Y']);
    expect(result['Y']).toBeCloseTo(0.2025, 12);
    // λ=1: 0.5, затем 0.5·0.4 = 0.2 == minCredit — остаётся («ниже» отбрасывается)
    const boundary = [
      lesson('Q', []),
      lesson('P', ['Q'], [['Q', 0.4]]),
      lesson('T', ['P'], [['P', 0.5]]),
    ];
    const edge = credits(boundary, 'declared', 'T', { lambda: 1 });
    expect(edge['P']).toBeCloseTo(0.5, 12);
    expect(edge['Q']).toBeCloseTo(0.2, 12);
    // чуть выше порога — граница уже отбрасывает
    expect(
      credits(boundary, 'declared', 'T', { lambda: 1, minCredit: 0.2001 })['Q'],
    ).toBeUndefined();
  });

  test('depth limit of the default regime: 0.9^15 kept, 0.9^16 dropped', () => {
    const result = credits(chain(18), 'graph', 'n17');
    expect(result['n2']).toBeCloseTo(0.9 ** 15, 12);
    expect(result['n1']).toBeUndefined();
    expect(result['n0']).toBeUndefined();
  });

  test('entries are sorted by lesson index', () => {
    const graph = buildPlanGraph(buildSpecLibrary(chain(6)), 'graph');
    const model = createCreditModel(graph, DEFAULTS);
    const lessons = model
      .of(graph.lessonIndex.get('n5') as number)
      .map((entry) => entry.lesson);
    expect(lessons).toEqual([...lessons].sort((a, b) => a - b));
    expect(lessons).toHaveLength(5);
  });
});

describe('Trane B.3.3: dependency = encompass @ 1.0', () => {
  test('graph mode adds undeclared dependencies once any lesson declares; declared does not', () => {
    const specs = [
      lesson('a', []),
      lesson('b', []),
      lesson('c', ['a', 'b'], [['a', 0.5]]),
      lesson('x', ['b']),
    ];
    const viaGraph = credits(specs, 'graph', 'c');
    expect(viaGraph['a']).toBeCloseTo(0.45, 12);
    expect(viaGraph['b']).toBeCloseTo(0.9, 12); // b добавлен автоправилом @1.0
    expect(credits(specs, 'declared', 'c')).toEqual({
      a: expect.closeTo(0.45, 12),
    });
  });

  test('no manifest declares anything: graph mode = dependencies @ 1.0, declared = nothing', () => {
    const specs = [lesson('a', []), lesson('c', ['a'])];
    expect(credits(specs, 'graph', 'c')['a']).toBeCloseTo(0.9, 12);
    expect(credits(specs, 'declared', 'c')).toEqual({});
  });
});

describe('validation', () => {
  const graph = buildPlanGraph(buildSpecLibrary([lesson('a', [])]), 'graph');

  test.each([0, -0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'lambda %s is rejected',
    (lambda) => {
      expect(() => createCreditModel(graph, { ...DEFAULTS, lambda })).toThrow(
        RangeError,
      );
    },
  );

  test('lambda = 1 is accepted', () => {
    expect(() =>
      createCreditModel(graph, { ...DEFAULTS, lambda: 1 }),
    ).not.toThrow();
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'kappa %s is rejected',
    (kappa) => {
      expect(() => createCreditModel(graph, { ...DEFAULTS, kappa })).toThrow(
        RangeError,
      );
    },
  );

  test('encompassed weight outside [0, 1] fails library assembly', () => {
    expect(() =>
      buildSpecLibrary([lesson('a', []), lesson('b', ['a'], [['a', 1.5]])]),
    ).toThrow(UnitGraphError);
    expect(() =>
      buildSpecLibrary([lesson('a', []), lesson('b', ['a'], [['a', -0.1]])]),
    ).toThrow(UnitGraphError);
  });
});

describe('kappa: result = min(1, kappa * w), cutoff applied before kappa', () => {
  const specs = [
    lesson('a', []),
    lesson('b', ['a']),
    lesson('c', ['b']),
    lesson('d', ['c']),
  ];

  test('kappa < 1 scales every weight and drops nothing', () => {
    const result = credits(specs, 'graph', 'd', { kappa: 0.5 });
    expect(result['c']).toBeCloseTo(0.45, 12);
    expect(result['b']).toBeCloseTo(0.405, 12);
    // 0.729 ≥ minCredit до κ, поэтому остаётся, хотя 0.3645 > 0.2 и так
    expect(result['a']).toBeCloseTo(0.3645, 12);
  });

  test('kappa > 1 scales and clamps at 1', () => {
    const result = credits(specs, 'graph', 'd', { kappa: 1.2 });
    expect(result['c']).toBe(1); // 1.08 → 1
    expect(result['b']).toBeCloseTo(0.972, 12);
    expect(result['a']).toBeCloseTo(0.8748, 12);
    for (const weight of Object.values(result)) {
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  test('cutoff happens before kappa: a raw weight below minCredit stays dropped', () => {
    // a: 0.729 < 0.8 → отбрасывается, даже когда κ·0.729 = 0.8748 ≥ 0.8
    const result = credits(specs, 'graph', 'd', { minCredit: 0.8, kappa: 1.2 });
    expect(Object.keys(result).sort()).toEqual(['b', 'c']);
  });

  test('cutoff happens before kappa: kappa < 1 does not drop weights that fall below minCredit after scaling', () => {
    // raw: c .9, b .81, a .729 → после κ=0.2: .18, .162, .1458 — все < 0.2, но остаются
    const result = credits(specs, 'graph', 'd', { kappa: 0.2 });
    expect(Object.keys(result).sort()).toEqual(['a', 'b', 'c']);
    expect(result['a']).toBeCloseTo(0.1458, 12);
  });

  test('kappa does not change which path wins on the diamond', () => {
    const diamond = [
      lesson('B', []),
      lesson('M1', ['B'], [['B', 1]]),
      lesson('M2', ['B'], [['B', 0.6]]),
      lesson(
        'T',
        ['M1', 'M2'],
        [
          ['M1', 0.5],
          ['M2', 1],
        ],
      ),
    ];
    const base = credits(diamond, 'declared', 'T');
    const scaled = credits(diamond, 'declared', 'T', { kappa: 1.5 });
    expect(scaled['B']).toBeCloseTo(
      Math.min(1, 1.5 * (base['B'] as number)),
      12,
    );
    expect(scaled['M2']).toBeCloseTo(
      Math.min(1, 1.5 * (base['M2'] as number)),
      12,
    );
  });
});
