/**
 * Общие хелперы тестов `planning/`: порт `spike/fire-plan/src/gen.ts`
 * (генератор библиотеки и журнала попыток) поверх настоящей `Library`, мир
 * (`world`) и сборка `PlanState` из `MemoryIndex`.
 *
 * Отличия от спайка: граф строится `assembleLibrary` из манифестов testkit,
 * режим `trane` — это `buildPlanGraph(library, 'graph')` без объявленных
 * охватов, `none`/`sparse` — `'declared'`; фронтир и «просроченное» приходят
 * в планировщик снаружи (`PlanState`), поэтому правило фронтира спайка
 * (`lessonStatus`) живёт здесь, как тестовый оракул.
 */
import type {
  EpochMs,
  SchedulerOptionsDto,
  UnitId,
} from '@lms/engine-contract';
import { buildCourse, buildExercise, buildLesson } from '@lms/testkit';
import { assembleLibrary } from '../../src/domain/library.ts';
import type { Library } from '../../src/domain/library.ts';
import type { AttemptRecord } from '../../src/app/context.ts';
import type { MemoryModel } from '../../src/ports/index.ts';
import { MS_PER_DAY } from '../../src/scoring/constants.ts';
import { createTsFsrsMemoryModel } from '../../src/scoring/memory-model.ts';
import { createCreditModel } from '../../src/planning/credit-model.ts';
import type { CreditModel } from '../../src/planning/credit-model.ts';
import { collectDue } from '../../src/planning/due-set.ts';
import { createMemoryIndex } from '../../src/planning/memory-index.ts';
import type { MemoryIndexProjection } from '../../src/planning/memory-index.ts';
import { buildPlanGraph } from '../../src/planning/plan-graph.ts';
import type {
  EncompassMode,
  PlanGraph,
} from '../../src/planning/plan-graph.ts';
import type { PlanState, PlannerOptions } from '../../src/planning/planner.ts';
import { createMulberry32 } from '../../src/planning/seeded-random.ts';

export type Regime = 'none' | 'trane' | 'sparse';
export const REGIMES: readonly Regime[] = ['none', 'trane', 'sparse'];

export const T0: EpochMs = 1_700_000_000_000;

export interface GenOptions {
  lessons: number;
  courseSize: number;
  exercisesPerLesson: number;
  depsPerLesson: number;
  /** Зависимости берутся из предыдущих `window` уроков того же курса. */
  window: number;
  tags: number;
  seed: number;
}

export const DEFAULT_GEN: GenOptions = {
  lessons: 300,
  courseSize: 50,
  exercisesPerLesson: 4,
  depsPerLesson: 3,
  window: 12,
  tags: 24,
  seed: 1,
};

export interface LessonSpec {
  id: string;
  courseId: string;
  deps: readonly string[];
  encompassed?: readonly (readonly [string, number])[];
  exercises: readonly string[];
  tags: readonly string[];
}

/** Порт `Rng` спайка: `next()` и `int(n)` поверх mulberry32. */
export interface SpikeRng {
  /** Равномерное на [0, 1). */
  next(): number;
  /** Равномерное целое на [0, n). */
  int(n: number): number;
}

export const createSpikeRng = (seed: number): SpikeRng => {
  const next = createMulberry32(seed);
  return { next, int: (n) => Math.floor(next() * n) };
};

export const genSpecs = (
  options: GenOptions,
  regime: Regime,
): { specs: LessonSpec[]; mode: EncompassMode } => {
  const rng = createSpikeRng(options.seed);
  const specs: LessonSpec[] = [];
  const courseName = (i: number) =>
    `c${String(Math.floor(i / options.courseSize)).padStart(2, '0')}`;
  const lessonId = (i: number) =>
    `${courseName(i)}::l${String(i).padStart(5, '0')}`;
  for (let i = 0; i < options.lessons; i++) {
    const position = i % options.courseSize;
    const base = i - position;
    const lo = Math.max(base, i - options.window);
    const deps = new Set<number>();
    const want = Math.min(options.depsPerLesson, i - lo);
    while (deps.size < want) deps.add(lo + rng.int(i - lo));
    const depList = [...deps].sort((a, b) => a - b);
    const encompassed: [string, number][] = [];
    if (regime === 'sparse') {
      for (const dep of depList) {
        if (rng.next() < 0.3) {
          encompassed.push([lessonId(dep), 0.3 + 0.7 * rng.next()]);
        }
      }
    }
    specs.push({
      id: lessonId(i),
      courseId: courseName(i),
      deps: depList.map(lessonId),
      ...(regime === 'sparse' ? { encompassed } : {}),
      exercises: Array.from(
        { length: options.exercisesPerLesson },
        (_, e) => `${lessonId(i)}::e${e}`,
      ),
      tags: [`t${rng.int(options.tags)}`],
    });
  }
  return { specs, mode: regime === 'trane' ? 'graph' : 'declared' };
};

/** Собирает настоящую `Library` из спецификаций (`encompassed`, `engine.tags`). */
export const buildSpecLibrary = (specs: readonly LessonSpec[]): Library => {
  const courseIds = [...new Set(specs.map((spec) => spec.courseId))];
  return assembleLibrary(
    courseIds.map((id) => buildCourse({ id })),
    specs.map((spec) =>
      buildLesson({
        id: spec.id,
        course_id: spec.courseId,
        dependencies: [...spec.deps],
        encompassed: (spec.encompassed ?? []).map(([id, weight]) => [
          id,
          weight,
        ]),
        engine: { tags: [...spec.tags] },
      }),
    ),
    specs.flatMap((spec) =>
      spec.exercises.map((id) =>
        buildExercise({
          id,
          lesson_id: spec.id,
          course_id: spec.courseId,
        }),
      ),
    ),
    { cycleCheck: true },
  );
};

export interface GeneratedWorld {
  library: Library;
  graph: PlanGraph;
  mode: EncompassMode;
}

export const genGraph = (
  options: GenOptions,
  regime: Regime,
): GeneratedWorld => {
  const { specs, mode } = genSpecs(options, regime);
  const library = buildSpecLibrary(specs);
  return { library, graph: buildPlanGraph(library, mode), mode };
};

const DEVICES = 3;

/**
 * Случайный журнал попыток: 3 устройства, seq по устройству, время на
 * `days` суток, доля успехов ≈ `passRate`. Порядок НЕ отсортирован.
 * Оценки: успех — 3..5, провал — 1..2.
 */
export const genLog = (
  exerciseIds: readonly UnitId[],
  count: number,
  days: number,
  passRate: number,
  rng: SpikeRng,
  t0: EpochMs = T0,
): AttemptRecord[] => {
  const seqs = new Array<number>(DEVICES).fill(0);
  const out: AttemptRecord[] = [];
  for (let i = 0; i < count; i++) {
    const device = rng.int(DEVICES);
    const at = t0 + Math.floor(rng.next() * days * MS_PER_DAY);
    const pass = rng.next() < passRate;
    const grade = (pass ? 3 + rng.int(3) : 1 + rng.int(2)) as 1 | 2 | 3 | 4 | 5;
    const seq = seqs[device] as number;
    seqs[device] = seq + 1;
    out.push({
      id: `dev${device}#${seq}`,
      deviceId: `dev${device}`,
      seq,
      at,
      exerciseId: exerciseIds[rng.int(exerciseIds.length)] as UnitId,
      grade,
      source: 'self',
    });
  }
  return out;
};

/** Порядок журнала `(at, deviceId, seq, id)`. */
export const sortAttempts = (attempts: readonly AttemptRecord[]) =>
  [...attempts].sort(
    (a, b) =>
      a.at - b.at ||
      Number(a.deviceId > b.deviceId) - Number(a.deviceId < b.deviceId) ||
      a.seq - b.seq ||
      Number(a.id > b.id) - Number(a.id < b.id),
  );

/** Детерминированная перестановка (Фишер — Йейтс). */
export const shuffled = <T>(items: readonly T[], seed: number): T[] => {
  const rng = createSpikeRng(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
};

export const CREDIT_ON: Pick<SchedulerOptionsDto, 'implicitCredit'> = {
  implicitCredit: { enabled: true, lambda: 0.9, minCredit: 0.2, kappa: 1 },
};
export const CREDIT_OFF: Pick<SchedulerOptionsDto, 'implicitCredit'> = {
  implicitCredit: { enabled: false, lambda: 0.9, minCredit: 0.2, kappa: 1 },
};

export const PLANNER_OPTIONS: PlannerOptions = {
  minNewFraction: 0.25,
  maxSameCourseRun: 2,
  minTagDistance: 2,
  fillWithNew: true,
};

export const TARGET_RETENTION = 0.9;

/** Пороги фронтира спайка (`passMinValue`, `passMinAvgTrials`, `valueScale`). */
const PASS_MIN_VALUE = 3;
const PASS_MIN_AVG_TRIALS = 1.8;
const VALUE_SCALE = 5;

export const memoryModel: MemoryModel = createTsFsrsMemoryModel();

export const retrievabilityOf = (
  index: MemoryIndexProjection,
  exerciseId: UnitId,
  now: EpochMs,
): number => {
  const memory = index.getMemory(exerciseId);
  if (memory === null) return 0;
  return memoryModel.retrievability(
    memory.state,
    Math.max(0, now - memory.lastAt) / MS_PER_DAY,
  );
};

/**
 * Правило фронтира спайка (`Planner.lessonStatus`): урок без состояний — на
 * фронтире, если все его зависимости начаты и «проходят»
 * (`5·среднее R ≥ 3` и среднее число попыток по всем упражнениям ≥ 1.8).
 */
export const frontierOf = (
  graph: PlanGraph,
  index: MemoryIndexProjection,
  now: EpochMs,
): UnitId[] => {
  const introduced = new Uint8Array(graph.lessonCount);
  const passes = new Uint8Array(graph.lessonCount);
  for (let lesson = 0; lesson < graph.lessonCount; lesson++) {
    let sumR = 0;
    let withState = 0;
    let sumTrials = 0;
    const exercises = graph.lessonExercises[lesson] as readonly number[];
    for (const exercise of exercises) {
      const id = graph.exerciseIds[exercise] as UnitId;
      sumTrials += index.trialsOf(id);
      if (index.getMemory(id) !== null) {
        withState++;
        sumR += retrievabilityOf(index, id, now);
      }
    }
    if (withState === 0) continue;
    introduced[lesson] = 1;
    const value = (sumR / withState) * VALUE_SCALE;
    const avgTrials = sumTrials / exercises.length;
    if (value >= PASS_MIN_VALUE && avgTrials >= PASS_MIN_AVG_TRIALS) {
      passes[lesson] = 1;
    }
  }
  const frontier: UnitId[] = [];
  for (let lesson = 0; lesson < graph.lessonCount; lesson++) {
    if (introduced[lesson] === 1) continue;
    const ready = (graph.dependencies[lesson] as readonly number[]).every(
      (dependency) => passes[dependency] === 1,
    );
    if (ready) frontier.push(graph.lessonIds[lesson] as UnitId);
  }
  return frontier;
};

/** `PlanState` из проекции памяти; пустые исключения и ремедиация — по умолчанию. */
export const planStateOf = (
  graph: PlanGraph,
  index: MemoryIndexProjection,
  now: EpochMs,
  overrides: Partial<PlanState> = {},
): PlanState => ({
  due: collectDue(
    {
      memory: index,
      memoryModel,
      graph,
      isExcluded: () => false,
    },
    now,
    TARGET_RETENTION,
  ),
  hasAttempts: (id) => index.trialsOf(id) > 0,
  frontierLessons: frontierOf(graph, index, now),
  lessonPasses: () => true, // симуляция без непройденных уроков
  isExcluded: () => false,
  remediation: [],
  ...overrides,
});

export interface World {
  library: Library;
  graph: PlanGraph;
  credit: CreditModel;
  index: MemoryIndexProjection;
  now: EpochMs;
}

/**
 * Мир плана: библиотека режима `regime`, индекс памяти с неявным кредитом
 * (λ 0.9, minCredit 0.2) и журнал на первой половине упражнений — чтобы
 * остался фронтир.
 */
export const world = (
  seed: number,
  regime: Regime,
  lessons = 40,
  events = 150,
  spanDays = 30,
): World => {
  const { library, graph, mode } = genGraph(
    { ...DEFAULT_GEN, lessons, courseSize: 10, exercisesPerLesson: 3, seed },
    regime,
  );
  const credit = createCreditModel(graph, {
    ...CREDIT_ON.implicitCredit,
  });
  const index = createMemoryIndex({
    memoryModel,
    ratingMap: 'runner',
    options: () => CREDIT_ON,
    encompassMode: mode,
  });
  const ids = graph.exerciseIds.slice(
    0,
    Math.floor(graph.exerciseIds.length / 2),
  );
  index.rebuild(
    genLog(ids, events, spanDays, 0.85, createSpikeRng((seed ^ 0x55) >>> 0)),
    library,
  );
  return {
    library,
    graph,
    credit,
    index,
    now: T0 + (spanDays + 20) * MS_PER_DAY,
  };
};

/** Попытка `self` устройства `deviceId` с `id = <устройство>#<seq>`. */
export const attemptOf = (
  seq: number,
  at: EpochMs,
  exerciseId: UnitId,
  grade: 1 | 2 | 3 | 4 | 5,
  deviceId = 'd',
): AttemptRecord => ({
  id: `${deviceId}#${seq}`,
  deviceId,
  seq,
  at,
  exerciseId,
  grade,
  source: 'self',
});
