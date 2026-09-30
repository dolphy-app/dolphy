import { MarkerType } from '@vue-flow/core';
import type { Edge, Node } from '@vue-flow/core';
import type { UnitId } from '@spirula/engine-contract';
import { NODE_HEIGHT, NODE_WIDTH } from './layout.ts';
import type { CoursesLayout, LayoutInput, Point } from './layout.ts';
import type { GraphView } from './view.ts';

export const LESSON_NODE = 'lesson';
export const COURSE_NODE = 'course';

/** Ручки узла: зависимости идут слева направо, охват — снизу вверх. */
export const HANDLE = {
  dependencyIn: 'dependency-in',
  dependencyOut: 'dependency-out',
  coverIn: 'cover-in',
  coverOut: 'cover-out',
} as const;

export interface LessonNodeData {
  lessonId: UnitId;
}

export interface CourseNodeData {
  courseId: UnitId;
}

/** Вход раскладки: уроки по курсам и рёбра вида (зависят только от структуры, не от прогресса). */
export const layoutInput = (view: GraphView): LayoutInput => ({
  blocks: view.courses.map(({ id, lessonIds }) => ({
    courseId: id,
    lessonIds,
  })),
  edges: [
    ...view.dependencies.map(({ from, to }) => ({
      from,
      to,
      type: 'dependency' as const,
    })),
    ...view.covers.map(({ from, to, weight }) => ({
      from,
      to,
      weight,
      type: 'encompassed' as const,
    })),
  ],
});

/**
 * Узлы Vue Flow: контейнер на курс и уроки внутри (координаты — от
 * контейнера). Зависят только от структуры графа: статус, оценка и подпись для
 * скринридера берутся узлом из вида, поэтому прогресс узлы не пересоздаёт.
 */
export const buildNodes = (view: GraphView, layout: CoursesLayout): Node[] => {
  const nodes: Node[] = [];
  for (const frame of layout.frames) {
    nodes.push({
      id: frame.courseId,
      type: COURSE_NODE,
      position: { x: frame.x, y: frame.y },
      width: frame.width,
      height: frame.height,
      draggable: false,
      selectable: false,
      focusable: false,
      connectable: false,
      zIndex: 0,
      data: { courseId: frame.courseId } satisfies CourseNodeData,
    });
    for (const [id, position] of frame.local) {
      nodes.push({
        id,
        type: LESSON_NODE,
        position,
        parentNode: frame.courseId,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        draggable: false,
        selectable: false,
        focusable: false,
        connectable: false,
        zIndex: 1,
        data: { lessonId: id } satisfies LessonNodeData,
      });
    }
  }
  return nodes;
};

/** Цвет стрелки берётся от `color` контейнера (токен темы), а не задан hex-ом. */
const MARKER = {
  type: MarkerType.ArrowClosed,
  color: 'currentColor',
};

const EDGE_CLASS = { dependency: 'edge-dependency', cover: 'edge-cover' };

/** Тексты рёбер: подпись веса на линии и описание для чтения с экрана. */
export interface EdgeLabels {
  weight: (weight: number) => string;
  /** `from` требует `to`. */
  dependency: (from: UnitId, to: UnitId) => string;
  /** `from` охватывает `to`. */
  cover: (from: UnitId, to: UnitId, weight: number) => string;
}

/**
 * Рёбра: зависимости — от пререквизита к уроку; охват — пунктиром поверх, с
 * подписью веса, только при `showCovers`. У каждого ребра есть описание для
 * чтения с экрана (`role="img"` без имени — нарушение доступности).
 */
export const buildEdges = (
  view: GraphView,
  showCovers: boolean,
  labels: EdgeLabels,
): Edge[] => {
  const edges: Edge[] = view.dependencies.map(({ from, to }) => ({
    id: `dependency:${to}->${from}`,
    source: to,
    target: from,
    sourceHandle: HANDLE.dependencyOut,
    targetHandle: HANDLE.dependencyIn,
    type: 'default',
    class: EDGE_CLASS.dependency,
    markerEnd: MARKER,
    focusable: false,
    selectable: false,
    ariaLabel: labels.dependency(from, to),
    zIndex: 1,
  }));
  if (showCovers) {
    for (const { from, to, weight } of view.covers) {
      edges.push({
        id: `cover:${from}->${to}`,
        source: from,
        target: to,
        sourceHandle: HANDLE.coverOut,
        targetHandle: HANDLE.coverIn,
        type: 'default',
        class: EDGE_CLASS.cover,
        label: labels.weight(weight),
        markerEnd: MARKER,
        focusable: false,
        selectable: false,
        ariaLabel: labels.cover(from, to, weight),
        zIndex: 2,
      });
    }
  }
  return edges;
};

export type Direction = 'left' | 'right' | 'up' | 'down';

const CROSS_PENALTY = 2;

/**
 * Ближайший урок в стороне `direction` от `from` для стрелок клавиатуры:
 * главное расстояние по оси движения плюс удвоенное отклонение поперёк.
 * `null` — в этой стороне уроков нет.
 */
export const neighborInDirection = (
  positions: ReadonlyMap<UnitId, Point>,
  from: UnitId,
  direction: Direction,
): UnitId | null => {
  const origin = positions.get(from);
  if (!origin) return null;
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'right' || direction === 'down' ? 1 : -1;
  let best: UnitId | null = null;
  let bestCost = Infinity;
  for (const [id, point] of positions) {
    if (id === from) continue;
    const along = (horizontal ? point.x - origin.x : point.y - origin.y) * sign;
    if (along <= 0) continue;
    const across = Math.abs(
      horizontal ? point.y - origin.y : point.x - origin.x,
    );
    const cost = along + across * CROSS_PENALTY;
    if (cost < bestCost || (cost === bestCost && best !== null && id < best)) {
      best = id;
      bestCost = cost;
    }
  }
  return best;
};
