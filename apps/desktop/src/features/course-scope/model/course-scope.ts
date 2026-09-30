import { computed, ref, shallowRef } from 'vue';
import type { ComputedRef, InjectionKey, Ref, ShallowRef } from 'vue';
import type {
  EngineEvent,
  LearningEngine,
  UnitId,
} from '@spirula/engine-contract';
import { loadCourses } from '@/entities/course';
import type { CourseSummary } from '@/entities/course';

const REFRESH_ON: Partial<Record<EngineEvent['type'], true>> = {
  progress: true,
  'library-reloaded': true,
  'state-rebuilt': true,
};

export interface CourseScope {
  courses: ShallowRef<CourseSummary[]>;
  /** Курс в фокусе; `null` — все курсы вперемешку. */
  activeId: Ref<UnitId | null>;
  active: ComputedRef<CourseSummary | null>;
  /** Для `courseIds` плана и повторений: без поля — все курсы. */
  courseIds: ComputedRef<UnitId[] | undefined>;
  error: Ref<string | null>;
  select(id: UnitId | null): Promise<void>;
  refresh(): Promise<void>;
}

export const COURSE_SCOPE_KEY: InjectionKey<CourseScope> =
  Symbol('course-scope');

const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

/**
 * Курсы библиотеки и выбранный курс. Выбор хранится в настройках движка
 * (`UiSettingsDto.activeCourseId`), а не в журнале: переключение ничего не
 * пишет в журнал и не влияет на другие устройства. Живёт всё время работы
 * приложения; данные курсов обновляются по событиям движка.
 */
export const createCourseScope = async (
  engine: LearningEngine,
): Promise<CourseScope> => {
  const courses = shallowRef<CourseSummary[]>([]);
  const activeId = ref<UnitId | null>(null);
  const error = ref<string | null>(null);
  let latestRequest = 0;
  let selecting = 0; // пока выбор пишется, устаревшее чтение его не затирает

  const active = computed(
    () => courses.value.find(({ id }) => id === activeId.value) ?? null,
  );
  const courseIds = computed(() =>
    activeId.value === null ? undefined : [activeId.value],
  );

  const refresh = async () => {
    const request = ++latestRequest;
    try {
      const [loaded, { activeCourseId }] = await Promise.all([
        loadCourses(engine),
        engine.settings.getUi(),
      ]);
      if (request !== latestRequest) return;
      courses.value = loaded;
      error.value = null;
      // курс могли убрать из библиотеки: фокус на нём сбрасываем и в настройках
      const known = loaded.some(({ id }) => id === activeCourseId);
      if (selecting === 0) {
        activeId.value =
          known && activeCourseId !== undefined ? activeCourseId : null;
      }
      if (activeCourseId !== undefined && !known && loaded.length > 0) {
        await engine.settings.setUi({ activeCourseId: null });
      }
    } catch (caught) {
      if (request === latestRequest) error.value = errorText(caught);
    }
  };

  const select = async (id: UnitId | null) => {
    const previous = activeId.value;
    if (id === previous) return;
    activeId.value = id;
    selecting++;
    try {
      await engine.settings.setUi({ activeCourseId: id });
    } catch (caught) {
      activeId.value = previous;
      error.value = errorText(caught);
    } finally {
      selecting--;
    }
  };

  engine.subscribe((event) => {
    // слушатель не вызывает команды синхронно (API §7)
    if (REFRESH_ON[event.type]) queueMicrotask(() => void refresh());
  });
  await refresh(); // окна с планом открываются уже с верным выбором

  return { courses, activeId, active, courseIds, error, select, refresh };
};
