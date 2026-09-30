import { compare } from './layout.ts';
import type {
  GraphDto,
  ProgressNodeDto,
  UnitId,
  UnitStatus,
} from '@lms/engine-contract';

export interface CourseRef {
  id: UnitId;
  name: string;
}

export interface CoveredLesson {
  id: UnitId;
  weight: number;
}

export interface LessonView {
  id: UnitId;
  courseId: UnitId;
  name: string;
  status: UnitStatus;
  /** 0..5; `null` — нет оценки. */
  score: number | null;
  attempts: number;
  /** Упражнения урока, которые пора повторить. */
  due: number;
  /** Пререквизиты (рёбра `dependency`), в порядке id. */
  prerequisites: UnitId[];
  /** Что охватывает урок (рёбра `encompassed`) с весами. */
  encompasses: CoveredLesson[];
}

export interface CourseView extends CourseRef {
  lessonIds: UnitId[];
  mastered: number;
}

export interface LinkView {
  from: UnitId;
  to: UnitId;
}

export interface CoverView extends LinkView {
  weight: number;
}

export interface GraphView {
  courses: CourseView[];
  lessons: Map<UnitId, LessonView>;
  /** `from` зависит от `to`; только внутри одного курса (по ним раскладка). */
  dependencies: LinkView[];
  /** `from` охватывает `to` с весом; только внутри одного курса. */
  covers: CoverView[];
  /** Движок отдал не весь граф (лимит `getGraph`). */
  truncated: boolean;
}

/** Статус урока, для которого в прогрессе нет узла: считаем открытым. */
const DEFAULT_STATUS: UnitStatus = 'ready';

export interface GraphViewInput {
  courses: readonly CourseRef[];
  graph: GraphDto;
  progress: readonly ProgressNodeDto[];
}

/**
 * Склейка графа библиотеки с прогрессом. Узлы — только уроки выбранных курсов
 * (курс — контейнер, упражнения не рисуются); рёбра `superseded` отбрасываются,
 * рёбра к неизвестным узлам — тоже. Порядок курсов — как во входе, уроков —
 * по id: результат не зависит от порядка ответа движка.
 */
export const buildGraphView = ({
  courses,
  graph,
  progress,
}: GraphViewInput): GraphView => {
  const courseIds = new Set(courses.map(({ id }) => id));
  const progressById = new Map(progress.map((node) => [node.id, node]));

  const lessons = new Map<UnitId, LessonView>();
  const nodes = graph.nodes
    .filter(
      ({ kind, parentId }) =>
        kind === 'lesson' && parentId !== undefined && courseIds.has(parentId),
    )
    .sort((a, b) => compare(a.id, b.id));
  for (const { id, name, parentId } of nodes) {
    const node = progressById.get(id);
    lessons.set(id, {
      id,
      courseId: parentId ?? '',
      name,
      status: node?.status ?? DEFAULT_STATUS,
      score: node?.score ?? null,
      attempts: node?.attempts ?? 0,
      due: node?.dueExercises ?? 0,
      prerequisites: [],
      encompasses: [],
    });
  }

  const dependencies: LinkView[] = [];
  const covers: CoverView[] = [];
  const seen = new Set<string>();
  const edges = [...graph.edges].sort(
    (a, b) =>
      compare(a.from, b.from) || compare(a.to, b.to) || compare(a.type, b.type),
  );
  for (const { from, to, type, weight } of edges) {
    const source = lessons.get(from);
    const target = lessons.get(to);
    if (!source || !target || from === to) continue;
    const key = `${type}\u0000${from}\u0000${to}`;
    if (type === 'superseded' || seen.has(key)) continue;
    seen.add(key);
    const sameCourse = source.courseId === target.courseId;
    if (type === 'dependency') {
      source.prerequisites.push(to);
      if (sameCourse) dependencies.push({ from, to });
    } else {
      const covered = weight ?? 1;
      source.encompasses.push({ id: to, weight: covered });
      if (sameCourse) covers.push({ from, to, weight: covered });
    }
  }

  return {
    courses: courses.map((course): CourseView => {
      const lessonIds = [...lessons.values()]
        .filter(({ courseId }) => courseId === course.id)
        .map(({ id }) => id);
      return {
        ...course,
        lessonIds,
        mastered: lessonIds.filter(
          (id) => lessons.get(id)?.status === 'mastered',
        ).length,
      };
    }),
    lessons,
    dependencies,
    covers,
    truncated: graph.truncated,
  };
};

/**
 * Обновление одного прогресса без пересборки графа: копия вида с новыми
 * статусами, оценками и счётчиками; структура (рёбра, порядок) сохраняется.
 */
export const applyProgress = (
  view: GraphView,
  progress: readonly ProgressNodeDto[],
): GraphView => {
  const progressById = new Map(progress.map((node) => [node.id, node]));
  const lessons = new Map<UnitId, LessonView>();
  for (const [id, lesson] of view.lessons) {
    const node = progressById.get(id);
    lessons.set(
      id,
      node
        ? {
            ...lesson,
            status: node.status,
            score: node.score,
            attempts: node.attempts,
            due: node.dueExercises ?? 0,
          }
        : lesson,
    );
  }
  return {
    ...view,
    lessons,
    courses: view.courses.map((course) => ({
      ...course,
      mastered: course.lessonIds.filter(
        (id) => lessons.get(id)?.status === 'mastered',
      ).length,
    })),
  };
};

export interface StatusView {
  icon: string;
  /** Цвет темы Vuetify только для значка; текст статуса нейтральный. */
  color: string;
}

/** Значок и цвет значка по статусу; форма значка различима без цвета. */
export const STATUS_VIEW: Record<UnitStatus, StatusView> = {
  locked: { icon: 'mdi-lock-outline', color: 'on-surface-variant' },
  ready: { icon: 'mdi-play-circle-outline', color: 'primary' },
  'in-progress': { icon: 'mdi-progress-clock', color: 'warning' },
  mastered: { icon: 'mdi-check-circle', color: 'success' },
  blacklisted: { icon: 'mdi-eye-off-outline', color: 'on-surface-variant' },
  superseded: { icon: 'mdi-swap-horizontal', color: 'on-surface-variant' },
};

/** Порядок в легенде: основные статусы всегда, остальные — если встречаются. */
export const CORE_STATUSES: readonly UnitStatus[] = [
  'locked',
  'ready',
  'in-progress',
  'mastered',
];
const EXTRA_STATUSES: readonly UnitStatus[] = ['blacklisted', 'superseded'];

export const legendStatuses = (view: GraphView): UnitStatus[] => {
  const present = new Set(
    [...view.lessons.values()].map(({ status }) => status),
  );
  return [
    ...CORE_STATUSES,
    ...EXTRA_STATUSES.filter((status) => present.has(status)),
  ];
};
