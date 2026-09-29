import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildIndexedGraph,
  findCycle,
  topoOrder,
  transitiveReduction,
} from '../../src/domain/graph-algorithms.ts';
import type { IndexedGraph } from '../../src/domain/graph-algorithms.ts';

const FC = { seed: 20260929, numRuns: 200 } as const;

type Edges = Map<string, string[]>;

const nameOf = (i: number) => `n${i}`;

const fromEdges = (edges: Edges) => {
  const ids = [...edges.keys()];
  return buildIndexedGraph(ids, (id) => edges.get(id));
};

/** Эталон Кана: цикл есть, если не все узлы вышли из очереди. */
const kahnHasCycle = (n: number, edges: readonly boolean[][]): boolean => {
  const indegree = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) if (edges[i]?.[j]) indegree[j]!++;
  }
  const queue = indegree.flatMap((d, i) => (d === 0 ? [i] : []));
  let seen = 0;
  while (queue.length > 0) {
    const i = queue.pop()!;
    seen++;
    for (let j = 0; j < n; j++) {
      if (edges[i]?.[j] && --indegree[j]! === 0) queue.push(j);
    }
  }
  return seen < n;
};

const matrixArbitrary = fc.integer({ min: 1, max: 8 }).chain((n) =>
  fc.tuple(
    fc.constant(n),
    fc.array(fc.array(fc.boolean(), { minLength: n, maxLength: n }), {
      minLength: n,
      maxLength: n,
    }),
  ),
);

describe('findCycle (port of cyclefuzz)', () => {
  it('agrees with Kahn on random graphs with n <= 8: no misses, no false positives', () => {
    fc.assert(
      fc.property(matrixArbitrary, ([n, matrix]) => {
        const nodes = Array.from({ length: n }, (_, i) => nameOf(i));
        const neighbors = (id: string) =>
          nodes.filter((_, j) => matrix[Number(id.slice(1))]?.[j]);
        const cycle = findCycle(nodes, neighbors);
        expect(cycle !== null).toBe(kahnHasCycle(n, matrix));
        if (cycle !== null) {
          expect(cycle.length).toBeGreaterThanOrEqual(2);
          expect(cycle[0]).toBe(cycle.at(-1));
          for (let k = 0; k + 1 < cycle.length; k++) {
            expect(neighbors(cycle[k]!)).toContain(cycle[k + 1]);
          }
        }
      }),
      FC,
    );
  });

  it('finds a self-loop and a 2-cycle', () => {
    expect(findCycle(['a'], () => ['a'])).toEqual(['a', 'a']);
    const edges: Record<string, string[]> = { a: ['b'], b: ['a'] };
    const cycle = findCycle(['a', 'b'], (id) => edges[id] ?? []);
    expect(cycle?.length).toBe(3);
    expect(new Set(cycle)).toEqual(new Set(['a', 'b']));
  });

  it('does not report a diamond or a forest, and handles an empty graph', () => {
    const edges: Record<string, string[]> = {
      a: ['b', 'c'],
      b: ['d'],
      c: ['d'],
      d: [],
    };
    expect(findCycle(['a', 'b', 'c', 'd'], (id) => edges[id] ?? [])).toBeNull();
    expect(findCycle([], () => [])).toBeNull();
  });

  it('follows edges to nodes that are not in the start list', () => {
    const edges: Record<string, string[]> = { a: ['x'], x: ['y'], y: ['x'] };
    const cycle = findCycle(['a'], (id) => edges[id] ?? []);
    expect(new Set(cycle)).toEqual(new Set(['x', 'y']));
  });

  it('is iterative: a 200 000-node chain does not overflow the stack', () => {
    const n = 200_000;
    const nodes = Array.from({ length: n }, (_, i) => nameOf(i));
    const neighbors = (id: string) => {
      const next = Number(id.slice(1)) + 1;
      return next < n ? [nameOf(next)] : [];
    };
    expect(findCycle(nodes, neighbors)).toBeNull();
    const looped = (id: string) =>
      id === nameOf(n - 1) ? [nameOf(0)] : neighbors(id);
    expect(findCycle(nodes, looped)).not.toBeNull();
  });
});

describe('topoOrder', () => {
  const assertValid = (graph: IndexedGraph, order: Int32Array) => {
    expect(order).toHaveLength(graph.size);
    expect(new Set(order).size).toBe(graph.size);
    const position = new Map<number, number>();
    order.forEach((unit, i) => position.set(unit, i));
    for (let unit = 0; unit < graph.size; unit++) {
      for (let e = graph.offsets[unit]!; e < graph.offsets[unit + 1]!; e++) {
        const dependency = graph.targets[e]!;
        expect(position.get(dependency)!).toBeLessThan(position.get(unit)!);
      }
    }
  };

  it('puts every dependency before its dependent (random DAGs)', () => {
    fc.assert(
      fc.property(matrixArbitrary, ([n, matrix]) => {
        // Нижний треугольник матрицы: i зависит только от j < i — всегда DAG.
        const edges: Edges = new Map();
        for (let i = 0; i < n; i++) {
          edges.set(
            nameOf(i),
            Array.from({ length: i }, (_, j) => j)
              .filter((j) => matrix[i]?.[j])
              .map(nameOf),
          );
        }
        const graph = fromEdges(edges);
        const order = topoOrder(graph);
        expect(order).not.toBeNull();
        assertValid(graph, order!);
      }),
      FC,
    );
  });

  it('returns null on a cycle, including one behind a valid prefix', () => {
    const graph = fromEdges(
      new Map([
        ['ok', []],
        ['a', ['b', 'ok']],
        ['b', ['a']],
      ]),
    );
    expect(topoOrder(graph)).toBeNull();
    expect(topoOrder(fromEdges(new Map([['a', ['a']]])))).toBeNull();
  });

  it('handles empty and edge-less graphs', () => {
    expect(topoOrder(fromEdges(new Map()))).toEqual(new Int32Array(0));
    const isolated = fromEdges(
      new Map([
        ['a', []],
        ['b', []],
      ]),
    );
    assertValid(isolated, topoOrder(isolated)!);
  });

  it('buildIndexedGraph drops dependencies outside the id list and keeps duplicates', () => {
    const graph = buildIndexedGraph(['a', 'b'], (id) =>
      id === 'a' ? ['b', 'ghost', 'b'] : undefined,
    );
    expect(graph.edgeCount).toBe(2);
    expect([...graph.targets]).toEqual([1, 1]);
    expect([...graph.offsets]).toEqual([0, 2, 2]);
  });
});

/** Эталон O(V·E): ребро (u, t) избыточно, если t достижим из другой зависимости u. */
const naiveKeep = (edges: Edges): Map<string, Set<string>> => {
  const reachable = (from: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [...(edges.get(from) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(edges.get(next) ?? []));
    }
    return seen;
  };
  const kept = new Map<string, Set<string>>();
  for (const [unit, dependencies] of edges) {
    const keep = new Set<string>();
    for (const target of dependencies) {
      const redundant = dependencies.some(
        (other) => other !== target && reachable(other).has(target),
      );
      if (!redundant) keep.add(target);
    }
    kept.set(unit, keep);
  }
  return kept;
};

const reduceAndCompare = (edges: Edges) => {
  const graph = fromEdges(edges);
  const order = topoOrder(graph)!;
  expect(order).not.toBeNull();
  const reduction = transitiveReduction(graph, order);
  const expected = naiveKeep(edges);
  let expectedKept = 0;
  for (let unit = 0; unit < graph.size; unit++) {
    const id = graph.ids[unit]!;
    const actual = new Set<string>();
    for (let e = graph.offsets[unit]!; e < graph.offsets[unit + 1]!; e++) {
      if (reduction.keep[e] === 1) actual.add(graph.ids[graph.targets[e]!]!);
    }
    expect(actual, `edges kept for ${id}`).toEqual(expected.get(id));
    expectedKept += actual.size;
  }
  expect(reduction.kept).toBe(expectedKept);
  expect(reduction.kept + reduction.removed).toBe(graph.edgeCount);
  return reduction;
};

const dag = (n: number, dependenciesOf: (i: number) => number[]): Edges =>
  new Map(
    Array.from({ length: n }, (_, i) => [
      nameOf(i),
      dependenciesOf(i).map(nameOf),
    ]),
  );

describe('transitiveReduction against a naive O(V*E) reference', () => {
  it('chain with shortcuts: only the chain edges survive', () => {
    const edges = dag(12, (i) => Array.from({ length: i }, (_, j) => j));
    const reduction = reduceAndCompare(edges);
    expect(reduction.kept).toBe(11);
  });

  it('diamond with a redundant top-to-bottom edge', () => {
    const edges: Edges = new Map([
      ['bottom', []],
      ['left', ['bottom']],
      ['right', ['bottom']],
      ['top', ['left', 'right', 'bottom']],
    ]);
    const reduction = reduceAndCompare(edges);
    expect(reduction.removed).toBe(1);
  });

  it('dense window: each unit depends on the previous 6', () => {
    const reduction = reduceAndCompare(
      dag(40, (i) =>
        Array.from({ length: Math.min(6, i) }, (_, k) => i - 1 - k),
      ),
    );
    expect(reduction.kept).toBe(39);
  });

  it('random DAGs (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
          minLength: 900,
          maxLength: 900,
        }),
        fc.double({ min: 0, max: 0.6, noNaN: true }),
        (n, dice, density) => {
          reduceAndCompare(
            dag(n, (i) =>
              Array.from({ length: i }, (_, j) => j).filter(
                (j) => (dice[i * 30 + j] ?? 1) < density,
              ),
            ),
          );
        },
      ),
      FC,
    );
  });

  it('empty graph and isolated nodes keep nothing and remove nothing', () => {
    const empty = reduceAndCompare(new Map());
    expect(empty).toMatchObject({ kept: 0, removed: 0 });
    const isolated = reduceAndCompare(dag(5, () => []));
    expect(isolated).toMatchObject({ kept: 0, removed: 0 });
  });

  it('a duplicated edge is kept once', () => {
    const graph = fromEdges(
      new Map([
        ['a', []],
        ['b', ['a', 'a']],
      ]),
    );
    const reduction = transitiveReduction(graph, topoOrder(graph)!);
    expect(reduction.kept).toBe(1);
    expect(reduction.removed).toBe(1);
  });

  it('works with more than 32 nodes (bit-set word boundary)', () => {
    reduceAndCompare(
      dag(70, (i) => [i - 1, i - 33, i - 34].filter((j) => j >= 0)),
    );
  });
});
