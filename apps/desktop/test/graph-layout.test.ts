import { describe, expect, it } from 'vitest';
import type { GraphEdgeDto } from '@dolphy-app/engine-contract';
import { neighborInDirection } from '@/pages/graph/lib/flow.ts';
import {
  FRAME_HEADER,
  FRAME_PADDING,
  NODE_HEIGHT,
  NODE_WIDTH,
  layoutCourses,
  layoutGraph,
} from '@/pages/graph/lib/layout.ts';
import type { Layout } from '@/pages/graph/lib/layout.ts';

const dependency = (from: string, to: string): GraphEdgeDto => ({
  from,
  to,
  type: 'dependency',
});
const encompassed = (from: string, to: string, weight = 0.5): GraphEdgeDto => ({
  from,
  to,
  type: 'encompassed',
  weight,
});

/** Цепочка: `c` зависит от `b`, `b` — от `a`; `d` зависит от `a`. */
const IDS = ['a', 'b', 'c', 'd'];
const CHAIN = [
  dependency('b', 'a'),
  dependency('c', 'b'),
  dependency('d', 'a'),
];

const snapshot = ({ positions, ranks, width, height }: Layout) => ({
  positions: [...positions].sort(([x], [y]) => x.localeCompare(y)),
  ranks: [...ranks].sort(([x], [y]) => x.localeCompare(y)),
  width,
  height,
});

const overlap = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean =>
  a.x < b.x + NODE_WIDTH &&
  b.x < a.x + NODE_WIDTH &&
  a.y < b.y + NODE_HEIGHT &&
  b.y < a.y + NODE_HEIGHT;

const overlaps = (layout: Layout) => {
  const points = [...layout.positions.values()];
  return points.some((point, index) =>
    points.slice(index + 1).some((other) => overlap(point, other)),
  );
};

describe('layoutGraph', () => {
  it('пререквизит левее зависимого урока, ранги растут вдоль зависимостей', () => {
    const { ranks, positions } = layoutGraph(IDS, CHAIN);
    expect(ranks.get('a')).toBe(0);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.get('c')).toBe(2);
    expect(ranks.get('d')).toBe(1);
    expect(positions.get('a')!.x).toBeLessThan(positions.get('b')!.x);
    expect(positions.get('b')!.x).toBeLessThan(positions.get('c')!.x);
  });

  it('детерминирована: порядок узлов и рёбер на вход не влияет', () => {
    const forward = layoutGraph(IDS, CHAIN);
    const shuffled = layoutGraph([...IDS].reverse(), [...CHAIN].reverse());
    expect(snapshot(shuffled)).toEqual(snapshot(forward));
    expect(snapshot(layoutGraph(IDS, CHAIN))).toEqual(snapshot(forward));
  });

  it('рёбра encompassed и superseded не меняют ни ранги, ни положение', () => {
    const plain = layoutGraph(IDS, CHAIN);
    const noisy = layoutGraph(IDS, [
      ...CHAIN,
      encompassed('c', 'a'),
      encompassed('a', 'c'), // против хода зависимостей
      encompassed('d', 'b'),
      { from: 'a', to: 'd', type: 'superseded' },
    ]);
    expect(snapshot(noisy)).toEqual(snapshot(plain));
  });

  it('цикл зависимостей не падает: все узлы получают конечные координаты', () => {
    const layout = layoutGraph(
      ['a', 'b', 'c'],
      [dependency('a', 'b'), dependency('b', 'c'), dependency('c', 'a')],
    );
    expect(layout.positions.size).toBe(3);
    for (const { x, y } of layout.positions.values()) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
    expect(overlaps(layout)).toBe(false);
  });

  it('самозависимость и рёбра к неизвестным узлам игнорируются', () => {
    const layout = layoutGraph(
      ['a', 'b'],
      [dependency('a', 'a'), dependency('a', 'ghost'), dependency('b', 'a')],
    );
    expect([...layout.positions.keys()].sort()).toEqual(['a', 'b']);
    expect(layout.ranks.get('b')).toBe(1);
  });

  it('пустой граф — пустая раскладка нулевого размера', () => {
    const layout = layoutGraph([], []);
    expect(layout.positions.size).toBe(0);
    expect(layout.ranks.size).toBe(0);
    expect([layout.width, layout.height]).toEqual([0, 0]);
  });

  it('уроки без зависимостей лежат сеткой без пересечений и без рангов', () => {
    const ids = Array.from({ length: 30 }, (_, index) => `l${index}`);
    const layout = layoutGraph(ids, [encompassed('l1', 'l2')]);
    expect(layout.positions.size).toBe(30);
    expect(layout.ranks.size).toBe(0);
    expect(overlaps(layout)).toBe(false);
    const xs = new Set([...layout.positions.values()].map(({ x }) => x));
    expect(xs.size).toBeGreaterThan(1); // не один столбец
  });

  it('изолированные уроки идут под связной частью и не наезжают на неё', () => {
    const layout = layoutGraph(['a', 'b', 'lonely'], [dependency('b', 'a')]);
    expect(overlaps(layout)).toBe(false);
    const lonely = layout.positions.get('lonely')!;
    expect(lonely.y).toBeGreaterThan(layout.positions.get('a')!.y);
    expect(layout.ranks.has('lonely')).toBe(false);
  });

  it('уроки на большом графе не пересекаются', () => {
    const ids = Array.from({ length: 120 }, (_, index) => `l${index}`);
    const edges = ids
      .slice(1)
      .flatMap((id, index) => [
        dependency(id, ids[index]!),
        ...(index >= 5 ? [dependency(id, ids[index - 5]!)] : []),
      ]);
    expect(overlaps(layoutGraph(ids, edges))).toBe(false);
  });
});

describe('layoutCourses', () => {
  const layout = layoutCourses(
    [
      { courseId: 'c1', lessonIds: ['c1::a', 'c1::b'] },
      { courseId: 'c2', lessonIds: ['c2::a'] },
    ],
    [dependency('c1::b', 'c1::a'), dependency('c2::a', 'c1::a')],
  );

  it('курсы — контейнеры друг под другом без наложения', () => {
    const [first, second] = layout.frames;
    expect(first!.y + first!.height).toBeLessThan(second!.y);
  });

  it('рёбра между курсами в раскладку не входят', () => {
    const second = layout.frames[1]!;
    expect(second.ranks.size).toBe(0);
  });

  it('абсолютное положение урока — контейнер плюс положение внутри него', () => {
    for (const frame of layout.frames) {
      for (const [id, point] of frame.local) {
        expect(point.x).toBeGreaterThanOrEqual(FRAME_PADDING);
        expect(point.y).toBeGreaterThanOrEqual(FRAME_HEADER + FRAME_PADDING);
        expect(layout.absolute.get(id)).toEqual({
          x: frame.x + point.x,
          y: frame.y + point.y,
        });
      }
    }
  });

  it('контейнер вмещает свои уроки', () => {
    for (const frame of layout.frames) {
      for (const point of frame.local.values()) {
        expect(point.x + NODE_WIDTH).toBeLessThanOrEqual(frame.width);
        expect(point.y + NODE_HEIGHT).toBeLessThanOrEqual(frame.height);
      }
    }
  });

  it('курс без уроков не ломает раскладку', () => {
    const empty = layoutCourses([{ courseId: 'c', lessonIds: [] }], []);
    expect(empty.frames).toHaveLength(1);
    expect(empty.absolute.size).toBe(0);
  });
});

describe('neighborInDirection', () => {
  const points = new Map([
    ['center', { x: 0, y: 0 }],
    ['right', { x: 300, y: 10 }],
    ['right-far', { x: 600, y: 0 }],
    ['right-off', { x: 300, y: 400 }],
    ['down', { x: 5, y: 200 }],
  ]);

  it('берёт ближайший урок в нужной стороне', () => {
    expect(neighborInDirection(points, 'center', 'right')).toBe('right');
    expect(neighborInDirection(points, 'center', 'down')).toBe('down');
    expect(neighborInDirection(points, 'right-far', 'left')).toBe('right');
  });

  it('в стороне без уроков — null', () => {
    expect(neighborInDirection(points, 'center', 'left')).toBeNull();
    expect(neighborInDirection(points, 'center', 'up')).toBeNull();
    expect(neighborInDirection(points, 'ghost', 'right')).toBeNull();
  });
});
