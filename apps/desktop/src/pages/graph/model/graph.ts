import { onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import type {
  EngineEvent,
  LearningEngine,
  ProgressNodeDto,
} from '@spirula-app/engine-contract';
import { readAllPages } from '@/shared/lib/read-all-pages.ts';
import { applyProgress, buildGraphView } from '../lib/view.ts';
import type { CourseRef, GraphView } from '../lib/view.ts';

/** Максимум `GraphQuery.limit` движка (`MAX_GRAPH_LIMIT`): уроки курсов берём одним запросом. */
const GRAPH_LIMIT = 2000;

/** Структура графа меняется при перечитывании библиотеки, прогресс — при попытках. */
const RELOAD_ON: Partial<Record<EngineEvent['type'], true>> = {
  'library-reloaded': true,
  'state-rebuilt': true,
};

const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

/**
 * Уроки выбранных курсов и связи между ними: корни — курсы, глубина 1 (уроки
 * курса), только `lesson`. Рёбра между уроками возвращает сам движок.
 */
export const loadGraph = (
  engine: LearningEngine,
  courses: readonly CourseRef[],
) =>
  engine.library.getGraph({
    rootIds: courses.map(({ id }) => id),
    depth: 1,
    kinds: ['lesson'],
    limit: GRAPH_LIMIT,
  });

/** Прогресс уроков курсов (узлы курсов тоже приходят, `buildGraphView` их не берёт). */
export const loadProgress = async (
  engine: LearningEngine,
  courses: readonly CourseRef[],
): Promise<ProgressNodeDto[]> => {
  const perCourse = await Promise.all(
    courses.map(({ id }) =>
      readAllPages((req) =>
        engine.practice.getProgress({ scope: { courseId: id } }, req),
      ),
    ),
  );
  return perCourse.flat();
};

export const loadGraphView = async (
  engine: LearningEngine,
  courses: readonly CourseRef[],
): Promise<GraphView> => {
  if (courses.length === 0) {
    return buildGraphView({
      courses,
      graph: { nodes: [], edges: [], truncated: false },
      progress: [],
    });
  }
  const [graph, progress] = await Promise.all([
    loadGraph(engine, courses),
    loadProgress(engine, courses),
  ]);
  return buildGraphView({ courses, graph, progress });
};

/**
 * Граф выбранных курсов. Структура (`structure`) перестраивается при смене
 * курсов и перечитывании библиотеки; событие `progress` обновляет только
 * статусы, оценки и счётчики (`view`) — без повторной загрузки графа и без
 * новой раскладки.
 */
export const useGraph = (
  engine: LearningEngine,
  courses: Readonly<Ref<readonly CourseRef[]>>,
  courseKey: Readonly<Ref<string>>,
) => {
  /** Вид с актуальным прогрессом. */
  const view = shallowRef<GraphView | null>(null);
  /** Вид на момент последней загрузки структуры: по нему строится раскладка. */
  const structure = shallowRef<GraphView | null>(null);
  const loading = ref(true);
  const error = ref<string | null>(null);
  let structureRequest = 0;
  let progressRequest = 0;

  const reload = async () => {
    const request = ++structureRequest;
    progressRequest++; // ответ о прогрессе для старой структуры не нужен
    const scoped = courses.value;
    try {
      const loaded = await loadGraphView(engine, scoped);
      if (request !== structureRequest) return;
      structure.value = loaded;
      view.value = loaded;
      error.value = null;
    } catch (caught) {
      if (request === structureRequest) error.value = errorText(caught);
    } finally {
      if (request === structureRequest) loading.value = false;
    }
  };

  const refreshProgress = async () => {
    const generation = structureRequest;
    const request = ++progressRequest;
    const scoped = courses.value;
    if (view.value === null || scoped.length === 0) return;
    try {
      const progress = await loadProgress(engine, scoped);
      if (request !== progressRequest || generation !== structureRequest)
        return;
      if (view.value) view.value = applyProgress(view.value, progress);
      error.value = null;
    } catch (caught) {
      if (request === progressRequest) error.value = errorText(caught);
    }
  };

  const unsubscribe = engine.subscribe((event) => {
    // слушатель не вызывает команды синхронно (API §7)
    if (RELOAD_ON[event.type]) queueMicrotask(() => void reload());
    else if (event.type === 'progress') {
      queueMicrotask(() => void refreshProgress());
    }
  });
  onScopeDispose(unsubscribe);
  watch(courseKey, () => void reload());
  void reload();

  return { view, structure, loading, error, reload };
};
