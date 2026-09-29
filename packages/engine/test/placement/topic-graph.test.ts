import { describe, expect, it } from 'vitest';
import { buildTopicGraph } from '../../src/placement/index.ts';
import { layeredDag, mulberry32 } from './helpers.ts';

const graphOf = (edges: Record<string, string[]>) =>
  buildTopicGraph(Object.keys(edges), (id) => edges[id]);

describe('buildTopicGraph', () => {
  it('транзитивная редукция снимает выводимые рёбра, прямые оставляет', () => {
    // c -> a выводимо из c -> b -> a
    const graph = graphOf({ a: [], b: ['a'], c: ['a', 'b'] });
    expect(graph.rawEdges).toBe(3);
    expect(graph.keptEdges).toBe(2);
    expect([...graph.level]).toEqual([0, 1, 2]);
    expect(graph.maxLevel).toBe(2);
    expect([
      ...graph.upTargets.subarray(graph.upOffsets[2], graph.upOffsets[3]),
    ]).toEqual([1]);
    expect([
      ...graph.downTargets.subarray(graph.downOffsets[0], graph.downOffsets[1]),
    ]).toEqual([1]);
  });

  it('порядок топологический, уровень — длиннейший путь от корня', () => {
    // ромб: d <- b, c <- a; плюс длинная ветка e <- d
    const graph = graphOf({
      a: [],
      b: ['a'],
      c: ['a'],
      d: ['b', 'c'],
      e: ['d'],
    });
    const position = new Map([...graph.order].map((t, k) => [t, k]));
    for (let u = 0; u < graph.size; u++) {
      for (
        let e = graph.upOffsets[u] as number;
        e < (graph.upOffsets[u + 1] as number);
        e++
      ) {
        expect(
          position.get(graph.upTargets[e] as number) as number,
        ).toBeLessThan(position.get(u) as number);
      }
    }
    expect([...graph.level]).toEqual([0, 1, 1, 2, 3]);
  });

  it('повторы и ссылки вне множества тем отбрасываются молча', () => {
    const graph = buildTopicGraph(['a', 'b'], (id) =>
      id === 'b' ? ['a', 'a', 'ghost'] : undefined,
    );
    expect(graph.keptEdges).toBe(1);
    expect([...graph.upTargets]).toEqual([0]);
  });

  it('цикл и самопетля — ошибка', () => {
    expect(() => graphOf({ a: ['b'], b: ['a'] })).toThrow(/cycle/);
    expect(() => graphOf({ a: ['a'] })).toThrow();
  });

  it('пустой граф', () => {
    const graph = graphOf({});
    expect(graph.size).toBe(0);
    expect(graph.maxLevel).toBe(0);
  });

  it('CSR вверх и вниз согласованы, списки отсортированы, редукция минимальна', () => {
    const graph = layeredDag(400, 15, mulberry32(400 * 131 + 15));
    expect(graph.rawEdges).toBeGreaterThan(graph.keptEdges);
    const up = new Set<string>();
    const down = new Set<string>();
    let kept = 0;
    for (let u = 0; u < graph.size; u++) {
      const ups = [
        ...graph.upTargets.subarray(graph.upOffsets[u], graph.upOffsets[u + 1]),
      ];
      expect(ups).toEqual([...ups].sort((a, b) => a - b));
      kept += ups.length;
      for (const p of ups) up.add(`${p}>${u}`);
      for (const d of graph.downTargets.subarray(
        graph.downOffsets[u],
        graph.downOffsets[u + 1],
      )) {
        down.add(`${u}>${d}`);
      }
    }
    expect(kept).toBe(graph.keptEdges);
    expect(up).toEqual(down);
    // минимальность: ни одно оставленное ребро p -> u не выводимо через другой путь
    const reach = (from: number, skip: number, to: number) => {
      const seen = new Set<number>();
      const stack = [from];
      while (stack.length > 0) {
        const x = stack.pop() as number;
        for (
          let e = graph.downOffsets[x] as number;
          e < (graph.downOffsets[x + 1] as number);
          e++
        ) {
          const y = graph.downTargets[e] as number;
          if (x === from && y === skip) continue;
          if (y === to) return true;
          if (!seen.has(y)) {
            seen.add(y);
            stack.push(y);
          }
        }
      }
      return false;
    };
    for (let u = 0; u < graph.size; u += 7) {
      for (const p of graph.upTargets.subarray(
        graph.upOffsets[u],
        graph.upOffsets[u + 1],
      )) {
        expect(reach(p, u, u)).toBe(false);
      }
    }
  });
});
