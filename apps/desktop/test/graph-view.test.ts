import { describe, expect, it } from 'vitest';
import type {
  GraphDto,
  GraphNodeDto,
  ProgressNodeDto,
} from '@dolphy-app/engine-contract';
import { buildEdges } from '@/pages/graph/lib/flow.ts';
import {
  applyProgress,
  buildGraphView,
  legendStatuses,
} from '@/pages/graph/lib/view.ts';

const lesson = (id: string, parentId: string): GraphNodeDto => ({
  id,
  kind: 'lesson',
  name: `name of ${id}`,
  parentId,
});
const progress = (
  id: string,
  patch: Partial<ProgressNodeDto> = {},
): ProgressNodeDto => ({
  id,
  kind: 'lesson',
  status: 'ready',
  score: null,
  avgTrials: null,
  attempts: 0,
  ...patch,
});

const COURSES = [
  { id: 'c1', name: 'Курс 1' },
  { id: 'c2', name: 'Курс 2' },
];

const GRAPH: GraphDto = {
  nodes: [
    lesson('c1::b', 'c1'),
    lesson('c1::a', 'c1'),
    lesson('c2::x', 'c2'),
    lesson('other::z', 'other'), // курс вне области
    { id: 'c1', kind: 'course', name: 'Курс 1' },
    { id: 'c1::a::e1', kind: 'exercise', name: 'e', parentId: 'c1::a' },
  ],
  edges: [
    { from: 'c1::b', to: 'c1::a', type: 'dependency' },
    { from: 'c1::b', to: 'c1::a', type: 'dependency' }, // дубликат
    { from: 'c1::b', to: 'c1::a', type: 'encompassed', weight: 0.4 },
    { from: 'c1::b', to: 'c1::a', type: 'superseded' },
    { from: 'c2::x', to: 'c1::a', type: 'dependency' }, // между курсами
    { from: 'c2::x', to: 'other::z', type: 'dependency' }, // вне области
    { from: 'c1::a', to: 'c1::a::e1', type: 'dependency' }, // упражнение
  ],
  truncated: false,
};

const PROGRESS = [
  progress('c1::a', { status: 'mastered', score: 4.5, attempts: 6 }),
  progress('c1::b', {
    status: 'in-progress',
    score: 2,
    attempts: 2,
    dueExercises: 3,
  }),
  progress('c1', { kind: 'course' }),
];

describe('buildGraphView', () => {
  const view = buildGraphView({
    courses: COURSES,
    graph: GRAPH,
    progress: PROGRESS,
  });

  it('узлы — только уроки выбранных курсов, по курсам и по id', () => {
    expect([...view.lessons.keys()]).toEqual(['c1::a', 'c1::b', 'c2::x']);
    expect(view.courses.map(({ id, lessonIds }) => [id, lessonIds])).toEqual([
      ['c1', ['c1::a', 'c1::b']],
      ['c2', ['c2::x']],
    ]);
  });

  it('склеивает статус, оценку, попытки и повторения с прогрессом', () => {
    expect(view.lessons.get('c1::b')).toMatchObject({
      status: 'in-progress',
      score: 2,
      attempts: 2,
      due: 3,
      name: 'name of c1::b',
    });
    expect(view.lessons.get('c1::a')).toMatchObject({
      status: 'mastered',
      due: 0,
    });
  });

  it('урок без узла прогресса — «готов», без оценки', () => {
    expect(view.lessons.get('c2::x')).toMatchObject({
      status: 'ready',
      score: null,
      attempts: 0,
      due: 0,
    });
  });

  it('считает освоенные уроки курса', () => {
    expect(view.courses.map(({ mastered }) => mastered)).toEqual([1, 0]);
  });

  it('рёбра: дубликаты схлопнуты, superseded и рёбра к чужим узлам отброшены', () => {
    expect(view.dependencies).toEqual([{ from: 'c1::b', to: 'c1::a' }]);
    expect(view.covers).toEqual([{ from: 'c1::b', to: 'c1::a', weight: 0.4 }]);
  });

  it('пререквизиты и охват урока — для боковой панели, включая другой курс', () => {
    expect(view.lessons.get('c1::b')).toMatchObject({
      prerequisites: ['c1::a'],
      encompasses: [{ id: 'c1::a', weight: 0.4 }],
    });
    // зависимость между курсами видна в панели, но не рисуется
    expect(view.lessons.get('c2::x')?.prerequisites).toEqual(['c1::a']);
    expect(view.dependencies.some(({ from }) => from === 'c2::x')).toBe(false);
  });

  it('порядок ответа движка на результат не влияет', () => {
    const reversed = buildGraphView({
      courses: COURSES,
      graph: {
        ...GRAPH,
        nodes: [...GRAPH.nodes].reverse(),
        edges: [...GRAPH.edges].reverse(),
      },
      progress: [...PROGRESS].reverse(),
    });
    expect(reversed).toEqual(view);
  });

  it('переносит truncated', () => {
    const truncated = buildGraphView({
      courses: COURSES,
      graph: { ...GRAPH, truncated: true },
      progress: [],
    });
    expect(truncated.truncated).toBe(true);
  });

  it('без курсов и без узлов — пустой вид', () => {
    const empty = buildGraphView({
      courses: [],
      graph: { nodes: [], edges: [], truncated: false },
      progress: [],
    });
    expect(empty.lessons.size).toBe(0);
    expect(empty.courses).toEqual([]);
  });
});

describe('applyProgress', () => {
  const view = buildGraphView({
    courses: COURSES,
    graph: GRAPH,
    progress: PROGRESS,
  });
  const next = applyProgress(view, [
    progress('c1::b', {
      status: 'mastered',
      score: 4.8,
      attempts: 5,
      dueExercises: 0,
    }),
  ]);

  it('обновляет статус, оценку и счётчики урока', () => {
    expect(next.lessons.get('c1::b')).toMatchObject({
      status: 'mastered',
      score: 4.8,
      attempts: 5,
      due: 0,
    });
  });

  it('уроки без нового узла остаются как были', () => {
    expect(next.lessons.get('c1::a')).toBe(view.lessons.get('c1::a'));
  });

  it('структура не меняется, освоенные уроки курса пересчитаны', () => {
    expect(next.dependencies).toBe(view.dependencies);
    expect(next.covers).toBe(view.covers);
    expect(next.courses.map(({ mastered }) => mastered)).toEqual([2, 0]);
    expect(view.courses.map(({ mastered }) => mastered)).toEqual([1, 0]); // исходный вид цел
  });
});

describe('legendStatuses', () => {
  it('четыре основных статуса всегда, «скрыт» и «заменён» — если встречаются', () => {
    const base = { courses: COURSES, graph: GRAPH };
    expect(
      legendStatuses(buildGraphView({ ...base, progress: PROGRESS })),
    ).toEqual(['locked', 'ready', 'in-progress', 'mastered']);
    const hidden = buildGraphView({
      ...base,
      progress: [progress('c1::a', { status: 'superseded' })],
    });
    expect(legendStatuses(hidden)).toEqual([
      'locked',
      'ready',
      'in-progress',
      'mastered',
      'superseded',
    ]);
  });
});

describe('buildEdges', () => {
  const view = buildGraphView({
    courses: COURSES,
    graph: GRAPH,
    progress: PROGRESS,
  });
  const label = {
    weight: (weight: number) => `w${weight}`,
    dependency: (from: string, to: string) => `${from} requires ${to}`,
    cover: (from: string, to: string) => `${from} covers ${to}`,
  };

  it('зависимость рисуется от пререквизита к уроку', () => {
    const [edge] = buildEdges(view, false, label);
    expect(edge).toMatchObject({ source: 'c1::a', target: 'c1::b' });
  });

  it('охват — только по переключателю, с подписью веса', () => {
    expect(buildEdges(view, false, label)).toHaveLength(1);
    const edges = buildEdges(view, true, label);
    expect(edges).toHaveLength(2);
    expect(edges[1]).toMatchObject({
      source: 'c1::b',
      target: 'c1::a',
      label: 'w0.4',
    });
  });

  it('у каждого ребра есть описание для чтения с экрана', () => {
    const [dependency, cover] = buildEdges(view, true, label);
    expect(dependency?.ariaLabel).toBe('c1::b requires c1::a');
    expect(cover?.ariaLabel).toBe('c1::b covers c1::a');
  });

  it('id рёбер уникальны', () => {
    const ids = buildEdges(view, true, label).map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
