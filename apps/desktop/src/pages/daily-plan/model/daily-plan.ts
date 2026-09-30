import { onScopeDispose, ref, shallowRef } from 'vue';
import type {
  EngineEvent,
  ExerciseDto,
  ItemReason,
  LearningEngine,
  UnitDto,
  UnitId,
} from '@lms/engine-contract';
import { PLAN_MAX_ITEMS } from '@/shared/config/plan.ts';

const DUE_LIMIT = 5;
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
}

export interface DueEntry {
  exerciseId: UnitId;
  title: string;
  origin: string;
  /** Вероятность вспомнить сейчас, 0..100. */
  remembered: number;
}

export interface DailyPlan {
  seed: number;
  entries: PlanEntry[];
  due: DueEntry[];
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
): Promise<DailyPlan> => {
  const readUnit = createUnitReader(engine);
  const [plan, due] = await Promise.all([
    engine.plan.getDay({ maxItems: PLAN_MAX_ITEMS }),
    engine.practice.getDue({ limit: DUE_LIMIT }),
  ]);
  const entries = await Promise.all(
    plan.items.map(async ({ exerciseId, reason }) => ({
      exerciseId,
      reason,
      ...(await describeExercise(readUnit, exerciseId)),
    })),
  );
  const dueEntries = await Promise.all(
    due.items.map(async ({ exerciseId, retrievability }) => ({
      exerciseId,
      remembered: Math.round(retrievability * 100),
      ...(await describeExercise(readUnit, exerciseId)),
    })),
  );
  return { seed: plan.seed, entries, due: dueEntries };
};

/** Состояние строится из событий движка (см. API §7), а не из опроса. */
export const useDailyPlan = (engine: LearningEngine) => {
  const plan = shallowRef<DailyPlan | null>(null);
  const loading = ref(true);
  const error = ref<string | null>(null);
  let latestRequest = 0;

  const refresh = async () => {
    const request = ++latestRequest;
    try {
      const loaded = await loadDailyPlan(engine);
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
  void refresh();

  return { plan, loading, error, refresh };
};
