import { onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import type {
  EngineEvent,
  ExerciseDto,
  ItemReason,
  LearningEngine,
  UnitDto,
  UnitId,
} from '@lms/engine-contract';
import { PLAN_MAX_ITEMS } from '@/shared/config/plan.ts';

/** Как размер плана: у каждого повторения в плане должна быть своя оценка. */
const DUE_LIMIT = PLAN_MAX_ITEMS;
const REFRESH_ON: Partial<Record<EngineEvent['type'], true>> = {
  progress: true,
  'library-reloaded': true,
  'state-rebuilt': true,
  'settings-changed': true,
};

export interface PlanEntry {
  exerciseId: UnitId;
  title: string;
  /** «Курс · урок». */
  origin: string;
  reason: ItemReason;
  /** Вероятность вспомнить сейчас, 0..100; `null` — упражнение не в очереди повторений. */
  remembered: number | null;
}

export interface DailyPlan {
  seed: number;
  /** Курс, по которому построен план; `null` — все курсы. */
  courseId: UnitId | null;
  entries: PlanEntry[];
}

type UnitReader = (id: UnitId) => Promise<UnitDto>;

const createUnitReader = (engine: LearningEngine): UnitReader => {
  const cache = new Map<UnitId, Promise<UnitDto>>();
  return (id) => {
    const cached = cache.get(id);
    if (cached) return cached;
    const loaded = engine.library.getUnit(id);
    cache.set(id, loaded);
    return loaded;
  };
};

interface ExerciseView {
  title: string;
  origin: string;
}

const describeExercise = async (
  readUnit: UnitReader,
  id: UnitId,
): Promise<ExerciseView> => {
  const unit = await readUnit(id);
  if (unit.kind !== 'exercise') throw new Error(`${id} is not an exercise`);
  const { courseId, lessonId, name }: ExerciseDto = unit;
  const [course, lesson] = await Promise.all([
    readUnit(courseId),
    readUnit(lessonId),
  ]);
  return { title: name, origin: `${course.name} · ${lesson.name}` };
};

export const loadDailyPlan = async (
  engine: LearningEngine,
  courseId: UnitId | null,
): Promise<DailyPlan> => {
  const readUnit = createUnitReader(engine);
  const scope = courseId === null ? {} : { courseIds: [courseId] };
  const [plan, due] = await Promise.all([
    engine.plan.getDay({ maxItems: PLAN_MAX_ITEMS, ...scope }),
    engine.practice.getDue({ limit: DUE_LIMIT, ...scope }),
  ]);
  const remembered = new Map(
    due.items.map(({ exerciseId, retrievability }) => [
      exerciseId,
      Math.round(retrievability * 100),
    ]),
  );
  const entries = await Promise.all(
    plan.items.map(async ({ exerciseId, reason }) => ({
      exerciseId,
      reason,
      remembered: remembered.get(exerciseId) ?? null,
      ...(await describeExercise(readUnit, exerciseId)),
    })),
  );
  return { seed: plan.seed, courseId, entries };
};

/** Состояние строится из событий движка (см. API §7), а не из опроса. */
export const useDailyPlan = (
  engine: LearningEngine,
  courseId: Readonly<Ref<UnitId | null>>,
) => {
  const plan = shallowRef<DailyPlan | null>(null);
  const loading = ref(true);
  const error = ref<string | null>(null);
  let latestRequest = 0;
  const today = ref(new Date());
  let midnight = 0;

  const refresh = async () => {
    const request = ++latestRequest;
    try {
      const loaded = await loadDailyPlan(engine, courseId.value);
      if (request !== latestRequest) return;
      plan.value = loaded;
      error.value = null;
    } catch (caught) {
      if (request !== latestRequest) return;
      error.value = caught instanceof Error ? caught.message : String(caught);
    } finally {
      if (request === latestRequest) loading.value = false;
    }
  };

  const unsubscribe = engine.subscribe((event) => {
    // слушатель не вызывает команды синхронно (API §7)
    if (REFRESH_ON[event.type]) queueMicrotask(() => void refresh());
  });
  onScopeDispose(unsubscribe);
  watch(courseId, () => void refresh());

  // план строится на день: после полуночи дата и план обновляются сами
  const scheduleMidnight = () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    midnight = window.setTimeout(() => {
      today.value = new Date();
      void refresh();
      scheduleMidnight();
    }, next.getTime() - now.getTime());
  };
  scheduleMidnight();
  onScopeDispose(() => window.clearTimeout(midnight));

  void refresh();

  return { plan, today, loading, error, refresh };
};
