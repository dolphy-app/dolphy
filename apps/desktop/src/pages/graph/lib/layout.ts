import { Graph, layout } from '@dagrejs/dagre';
import type { GraphEdgeDto, UnitId } from '@spirula-app/engine-contract';

/** Размер узла-урока в графе; CSS узла берёт те же значения. */
export const NODE_WIDTH = 256;
export const NODE_HEIGHT = 96;

/** Шапка контейнера курса и отступы внутри него. */
export const FRAME_HEADER = 56;
export const FRAME_PADDING = 24;
const FRAME_GAP = 48;
const MIN_FRAME_WIDTH = NODE_WIDTH + FRAME_PADDING * 2;

const NODE_SEP = 24;
const RANK_SEP = 72;
const GRID_GAP = 24;
/** Ширина сетки узлов без зависимостей ≈ в √(2n) столбцов. */
const GRID_ASPECT = 2;

export interface Point {
  x: number;
  y: number;
}

export interface Layout {
  /** Левый верхний угол узла. */
  positions: Map<UnitId, Point>;
  /** Ранг слева направо (0 — без пререквизитов); только у узлов с зависимостями. */
  ranks: Map<UnitId, number>;
  width: number;
  height: number;
}

export const compare = (a: string, b: string) => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

/**
 * Раскладка одного курса слева направо. В ранжирование идут ТОЛЬКО рёбра
 * `dependency` (пререквизит левее зависимого урока); `encompassed` и
 * `superseded` раскладку не меняют. Узлы без зависимостей ни в какую сторону
 * не участвуют в рангах и лежат сеткой под графом: иначе сотня несвязанных
 * уроков вытянулась бы в один столбец. Результат детерминирован: узлы и
 * рёбра сортируются, циклы разрывает сам dagre.
 */
export const layoutGraph = (
  ids: readonly UnitId[],
  edges: readonly GraphEdgeDto[],
): Layout => {
  const known = new Set(ids);
  const sorted = [...known].sort(compare);
  const dependencies = edges
    .filter(
      ({ type, from, to }) =>
        type === 'dependency' &&
        from !== to &&
        known.has(from) &&
        known.has(to),
    )
    .map(({ from, to }) => ({ from: to, to: from })) // ребро: пререквизит → урок
    .sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to));

  const connected = new Set<UnitId>();
  for (const { from, to } of dependencies) {
    connected.add(from);
    connected.add(to);
  }

  const positions = new Map<UnitId, Point>();
  const ranks = new Map<UnitId, number>();
  let width = 0;
  let height = 0;

  if (connected.size > 0) {
    const graph = new Graph();
    graph.setGraph({
      rankdir: 'LR',
      nodesep: NODE_SEP,
      ranksep: RANK_SEP,
      marginx: 0,
      marginy: 0,
    });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const id of sorted) {
      if (connected.has(id)) {
        graph.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
      }
    }
    for (const { from, to } of dependencies) graph.setEdge(from, to);
    layout(graph);

    const columns = new Map<number, number>();
    for (const id of sorted) {
      if (!connected.has(id)) continue;
      const node = graph.node(id);
      const x = node.x - NODE_WIDTH / 2;
      const y = node.y - NODE_HEIGHT / 2;
      positions.set(id, { x, y });
      columns.set(x, 0);
      width = Math.max(width, x + NODE_WIDTH);
      height = Math.max(height, y + NODE_HEIGHT);
    }
    const order = [...columns.keys()].sort((a, b) => a - b);
    order.forEach((x, rank) => columns.set(x, rank));
    for (const [id, { x }] of positions) ranks.set(id, columns.get(x) ?? 0);
  }

  const isolated = sorted.filter((id) => !connected.has(id));
  if (isolated.length > 0) {
    const columnsCount = Math.ceil(Math.sqrt(isolated.length * GRID_ASPECT));
    const top = connected.size > 0 ? height + RANK_SEP : 0;
    isolated.forEach((id, index) => {
      const column = index % columnsCount;
      const row = Math.floor(index / columnsCount);
      positions.set(id, {
        x: column * (NODE_WIDTH + GRID_GAP),
        y: top + row * (NODE_HEIGHT + GRID_GAP),
      });
    });
    const rows = Math.ceil(isolated.length / columnsCount);
    width = Math.max(
      width,
      Math.min(isolated.length, columnsCount) * (NODE_WIDTH + GRID_GAP) -
        GRID_GAP,
    );
    height = top + rows * (NODE_HEIGHT + GRID_GAP) - GRID_GAP;
  }

  return { positions, ranks, width, height };
};

export interface CourseBlock {
  courseId: UnitId;
  lessonIds: readonly UnitId[];
}

export interface FrameLayout {
  courseId: UnitId;
  /** Положение и размер контейнера курса на холсте. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Положение уроков относительно контейнера. */
  local: Map<UnitId, Point>;
  ranks: Map<UnitId, number>;
}

export interface LayoutInput {
  blocks: readonly CourseBlock[];
  edges: readonly GraphEdgeDto[];
}

export interface CoursesLayout {
  frames: FrameLayout[];
  /** Положение всех уроков на холсте. */
  absolute: Map<UnitId, Point>;
}

/**
 * Курсы — контейнеры друг под другом (в порядке `blocks`), внутри каждого своя
 * раскладка `layoutGraph`. Рёбра между уроками разных курсов в раскладку не
 * входят.
 */
export const layoutCourses = (
  blocks: readonly CourseBlock[],
  edges: readonly GraphEdgeDto[],
): CoursesLayout => {
  const frames: FrameLayout[] = [];
  const absolute = new Map<UnitId, Point>();
  let top = 0;
  for (const { courseId, lessonIds } of blocks) {
    const inner = layoutGraph(lessonIds, edges);
    const local = new Map<UnitId, Point>();
    for (const [id, { x, y }] of inner.positions) {
      const shifted = {
        x: x + FRAME_PADDING,
        y: y + FRAME_HEADER + FRAME_PADDING,
      };
      local.set(id, shifted);
      absolute.set(id, { x: shifted.x, y: top + shifted.y });
    }
    const height = FRAME_HEADER + FRAME_PADDING * 2 + inner.height;
    frames.push({
      courseId,
      x: 0,
      y: top,
      width: Math.max(MIN_FRAME_WIDTH, inner.width + FRAME_PADDING * 2),
      height,
      local,
      ranks: inner.ranks,
    });
    top += height + FRAME_GAP;
  }
  return { frames, absolute };
};
