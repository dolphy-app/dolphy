import type { ItemReason, UnitId } from '@lms/engine-contract';
import type { Rng } from '../ports/index.ts';
import type { CreditModel } from './credit-model.ts';
import { interleave } from './interleave.ts';
import type { PlanGraph } from './plan-graph.ts';

/** Параметры плана дня (`SchedulerOptionsDto.plan`, без `targetRetention`) и заполнение новым. */
export interface PlannerOptions {
  /** Доля позиций, резервируемая под новое. */
  readonly minNewFraction: number;
  readonly maxSameCourseRun: number;
  readonly minTagDistance: number;
  /** Добирать свободные позиции новым, если просроченного не осталось. */
  readonly fillWithNew: boolean;
}

export interface PlanDueExercise {
  readonly exerciseId: UnitId;
  /** `R` сейчас; `need = 1 − R`. */
  readonly retrievability: number;
}

/**
 * Состояние ученика, нужное плану: просроченные упражнения, начатые
 * упражнения, фронтир и ремедиация. Планировщик состояния не меняет.
 */
export interface PlanState {
  /** Упражнения с состоянием и `R ≤ targetRetention` (blacklist уже исключён). */
  readonly due: readonly PlanDueExercise[];
  /** У упражнения есть неотменённые попытки. */
  hasAttempts(exerciseId: UnitId): boolean;
  /** Уроки фронтира (`getFrontier`). */
  readonly frontierLessons: readonly UnitId[];
  /**
   * Урок проходит порог Trane (`passesThreshold`). Начатый урок, не прошедший
   * порог, — «тупик» поиска Trane: его упражнения остаются кандидатами и без
   * просрочки, иначе следующие уроки закрыты, а план пуст, пока не забудется.
   */
  lessonPasses(lessonId: UnitId): boolean;
  /** Само упражнение, урок или курс в blacklist. */
  isExcluded(exerciseId: UnitId): boolean;
  /** Упражнения невыполненных шагов ремедиации по приоритету. */
  readonly remediation: readonly UnitId[];
}

export interface PlanRequest {
  readonly maxItems: number;
  /** Источник тай-брейков и перемешиваний; равный поток — равный план. */
  readonly rng: Rng;
  /** Проверка: пересчёт каждого провайдера на каждом шаге вместо ленивой кучи. */
  readonly naive?: boolean;
}

export interface PlanCover {
  readonly exerciseId: UnitId;
  readonly credit: number;
}

export interface PlanItem {
  readonly exerciseId: UnitId;
  readonly reason: ItemReason;
  readonly covers: readonly PlanCover[];
  /** Выигрыш жадного шага (0 — резерв под новое, ремедиация). */
  readonly gain: number;
}

export interface PlanDetail {
  readonly items: PlanItem[];
  /** Порядок жадного выбора до интерливинга. */
  readonly greedy: readonly PlanItem[];
  readonly dueCount: number;
  readonly newAvailable: number;
  readonly interleaveOk: boolean;
  /** Сколько просроченных покрыто полностью. */
  readonly dueCovered: number;
}

/**
 * `subtractive` — `остаток −= min(остаток, кредит)` (по умолчанию);
 * `multiplicative` — `остаток *= 1 − кредит`.
 */
export type ResidualUpdate = 'subtractive' | 'multiplicative';

export interface Planner {
  planDay(state: PlanState, request: PlanRequest): PlanItem[];
  planDayDetailed(state: PlanState, request: PlanRequest): PlanDetail;
}

const EPS = 1e-9;

interface Scored {
  readonly gain: number;
  readonly exercise: number;
}

/** Двоичная куча: наверху элемент, для которого `better` истинно против остальных. */
const createHeap = (better: (a: Scored, b: Scored) => boolean) => {
  const items: Scored[] = [];
  const push = (entry: Scored) => {
    let i = items.length;
    items.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!better(entry, items[parent] as Scored)) break;
      items[i] = items[parent] as Scored;
      i = parent;
    }
    items[i] = entry;
  };
  const pop = (): Scored => {
    const top = items[0] as Scored;
    const last = items.pop() as Scored;
    const size = items.length;
    if (size > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= size) break;
        if (
          child + 1 < size &&
          better(items[child + 1] as Scored, items[child] as Scored)
        ) {
          child++;
        }
        if (!better(items[child] as Scored, last)) break;
        items[i] = items[child] as Scored;
        i = child;
      }
      items[i] = last;
    }
    return top;
  };
  return { push, pop, peek: () => items[0], size: () => items.length };
};

/**
 * План дня (engine-ts.md §6a.2): просроченные по жадному взвешенному
 * покрытию (без кредит-модели вырождается в «наименьшая R первой»), резерв
 * `ceil(minNewFraction·maxItems)` под новое (недоделанные упражнения начатых
 * уроков, затем уроки фронтира по кругу между курсами), ремедиация перед новым
 * (входит в `maxItems`, вытесняя новое), повтор начатых уроков, не прошедших
 * порог Trane (`PlanState.lessonPasses`), интерливинг. Чистая функция состояния
 * и потока `rng`.
 */
export const createPlanner = (
  graph: PlanGraph,
  credit: CreditModel | null,
  options: PlannerOptions,
  residualUpdate: ResidualUpdate = 'subtractive',
): Planner => {
  const planDayDetailed = (
    state: PlanState,
    { maxItems, rng, naive = false }: PlanRequest,
  ): PlanDetail => {
    const { exerciseCount, lessonCount, lessonExercises, exerciseLesson } =
      graph;
    const excluded = (exercise: number) =>
      state.isExcluded(graph.exerciseIds[exercise] as UnitId);
    const attempted = (exercise: number) =>
      state.hasAttempts(graph.exerciseIds[exercise] as UnitId);

    // просроченные в каноническом порядке (по индексу упражнения)
    const due: { exercise: number; retrievability: number }[] = [];
    for (const item of state.due) {
      const exercise = graph.exerciseIndex.get(item.exerciseId);
      if (exercise === undefined) continue;
      due.push({ exercise, retrievability: item.retrievability });
    }
    due.sort((a, b) => a.exercise - b.exercise);

    const introduced = new Uint8Array(lessonCount);
    for (let lesson = 0; lesson < lessonCount; lesson++) {
      for (const exercise of lessonExercises[lesson] as readonly number[]) {
        if (attempted(exercise)) {
          introduced[lesson] = 1;
          break;
        }
      }
    }
    const frontier = new Uint8Array(lessonCount);
    for (const lessonId of state.frontierLessons) {
      const lesson = graph.lessonIndex.get(lessonId);
      if (lesson !== undefined && introduced[lesson] === 0)
        frontier[lesson] = 1;
    }

    const collectNew = (): number[] => {
      const found: number[] = [];
      for (let lesson = 0; lesson < lessonCount; lesson++) {
        if (introduced[lesson] !== 1) continue;
        for (const exercise of lessonExercises[lesson] as readonly number[]) {
          if (!attempted(exercise) && !excluded(exercise)) found.push(exercise);
        }
      }
      const perCourse: number[][] = graph.courseIds.map(() => []);
      for (let lesson = 0; lesson < lessonCount; lesson++) {
        if (frontier[lesson] === 1) {
          (perCourse[graph.lessonCourse[lesson] as number] as number[]).push(
            lesson,
          );
        }
      }
      const courses = perCourse
        .map((_, course) => course)
        .filter((course) => (perCourse[course] as number[]).length > 0);
      rng.shuffle(courses);
      const position = new Array<number>(perCourse.length).fill(0);
      let active = courses.length;
      while (active > 0) {
        active = 0;
        for (const course of courses) {
          const lessons = perCourse[course] as number[];
          const at = position[course] as number;
          if (at >= lessons.length) continue;
          for (const exercise of lessonExercises[
            lessons[at] as number
          ] as readonly number[]) {
            if (!excluded(exercise)) found.push(exercise);
          }
          position[course] = at + 1;
          if (at + 1 < lessons.length) active++;
        }
      }
      return found;
    };
    const newCandidates = collectNew();

    const reserve = Math.min(
      Math.ceil(options.minNewFraction * maxItems),
      newCandidates.length,
      maxItems,
    );

    // остатки просроченного
    const need = new Float64Array(exerciseCount);
    const residual = new Float64Array(exerciseCount);
    const dueByLesson = new Map<number, number[]>();
    for (const { exercise, retrievability } of due) {
      need[exercise] = 1 - retrievability;
      residual[exercise] = 1;
      const lesson = exerciseLesson[exercise] as number;
      const list = dueByLesson.get(lesson);
      if (list === undefined) dueByLesson.set(lesson, [exercise]);
      else list.push(exercise);
    }

    const cover = (provider: number, apply: boolean) => {
      let gain = 0;
      const covers: { exercise: number; credit: number }[] = [];
      const visit = (exercise: number, weight: number) => {
        const left = residual[exercise] as number;
        if (left <= EPS) return;
        const effective = weight < left ? weight : left;
        if (residualUpdate === 'subtractive') {
          gain += effective * (need[exercise] as number);
          if (apply) {
            const next = left - effective;
            residual[exercise] = next < EPS ? 0 : next;
          }
        } else {
          gain += left * weight * (need[exercise] as number);
          if (apply) {
            const next = left * (1 - weight);
            residual[exercise] = next < EPS ? 0 : next;
          }
        }
        if (apply) covers.push({ exercise, credit: weight });
      };
      if ((need[provider] as number) > 0) visit(provider, 1);
      if (credit !== null) {
        for (const { lesson, weight } of credit.of(
          exerciseLesson[provider] as number,
        )) {
          const list = dueByLesson.get(lesson);
          if (list !== undefined)
            for (const exercise of list) visit(exercise, weight);
        }
      }
      return { gain, covers };
    };

    const providerLessonOk = (lesson: number) =>
      introduced[lesson] === 1 || frontier[lesson] === 1;

    // тай-брейки в порядке id упражнений: детерминированы для данного потока
    const tie = new Float64Array(exerciseCount);
    for (let rank = 0; rank < exerciseCount; rank++) {
      tie[graph.exerciseByRank[rank] as number] = rng.random();
    }
    const better = (a: Scored, b: Scored) =>
      a.gain > b.gain ||
      (a.gain === b.gain &&
        (tie[a.exercise] as number) < (tie[b.exercise] as number));
    const heap = createHeap(better);

    const providers: number[] = [];
    if (due.length > 0) {
      const considered = new Set<number>();
      const consider = (lesson: number) => {
        if (considered.has(lesson) || !providerLessonOk(lesson)) return;
        considered.add(lesson);
        for (const exercise of lessonExercises[lesson] as readonly number[]) {
          providers.push(exercise);
          const { gain } = cover(exercise, false);
          if (gain > 0) heap.push({ gain, exercise });
        }
      };
      for (const lesson of dueByLesson.keys()) consider(lesson);
      if (credit !== null) {
        for (let lesson = 0; lesson < lessonCount; lesson++) {
          if (considered.has(lesson) || !providerLessonOk(lesson)) continue;
          for (const entry of credit.of(lesson)) {
            if (dueByLesson.has(entry.lesson)) {
              consider(lesson);
              break;
            }
          }
        }
      }
    }

    const idOf = (exercise: number) => graph.exerciseIds[exercise] as UnitId;
    const greedy: PlanItem[] = [];
    const chosen = new Set<number>();
    const greedyLimit = maxItems - reserve;
    while (
      greedy.length < greedyLimit &&
      (naive ? providers.length > 0 : heap.size() > 0)
    ) {
      let provider: number;
      let gain: number;
      if (naive) {
        provider = -1;
        gain = 0;
        for (const candidate of providers) {
          if (chosen.has(candidate)) continue;
          const candidateGain = cover(candidate, false).gain;
          if (
            candidateGain > 0 &&
            (provider < 0 ||
              better(
                { gain: candidateGain, exercise: candidate },
                { gain, exercise: provider },
              ))
          ) {
            provider = candidate;
            gain = candidateGain;
          }
        }
        if (provider < 0) break;
      } else {
        provider = heap.pop().exercise;
        if (chosen.has(provider)) continue;
        gain = cover(provider, false).gain;
        if (gain <= 0) continue;
        const top = heap.peek();
        if (top !== undefined && !better({ gain, exercise: provider }, top)) {
          heap.push({ gain, exercise: provider });
          continue;
        }
      }
      const result = cover(provider, true);
      chosen.add(provider);
      greedy.push({
        exerciseId: idOf(provider),
        reason: attempted(provider) ? 'review' : 'new',
        covers: result.covers.map((c) => ({
          exerciseId: idOf(c.exercise),
          credit: c.credit,
        })),
        gain,
      });
    }
    let dueCovered = 0;
    for (const { exercise } of due) {
      if ((residual[exercise] as number) <= EPS) dueCovered++;
    }

    const items: PlanItem[] = [...greedy];

    // ремедиация перед новым: не вытесняет просроченное, вытесняет новое
    const slots = maxItems - items.length;
    let remediationCount = 0;
    for (const exerciseId of state.remediation) {
      if (remediationCount >= slots) break;
      const exercise = graph.exerciseIndex.get(exerciseId);
      if (
        exercise === undefined ||
        chosen.has(exercise) ||
        excluded(exercise)
      ) {
        continue;
      }
      chosen.add(exercise);
      remediationCount++;
      items.push({
        exerciseId,
        reason: 'remediation',
        covers: [],
        gain: 0,
      });
    }

    let newCount = greedy.filter((item) => item.reason === 'new').length;
    const addNew = (limit: number) => {
      for (const exercise of newCandidates) {
        if (items.length >= maxItems || newCount >= limit) return;
        if (chosen.has(exercise)) continue;
        chosen.add(exercise);
        newCount++;
        items.push({
          exerciseId: idOf(exercise),
          reason: 'new',
          covers: [],
          gain: 0,
        });
      }
    };
    addNew(reserve);

    // повтор непройденных уроков (dead-end Trane): после резерва нового, до
    // добора новым; порядок — по тай-брейку, детерминирован для потока `rng`
    const practice: number[] = [];
    for (let lesson = 0; lesson < lessonCount; lesson++) {
      if (
        introduced[lesson] !== 1 ||
        state.lessonPasses(graph.lessonIds[lesson] as UnitId)
      ) {
        continue;
      }
      for (const exercise of lessonExercises[lesson] as readonly number[]) {
        if (attempted(exercise) && !excluded(exercise)) practice.push(exercise);
      }
    }
    practice.sort((a, b) => (tie[a] as number) - (tie[b] as number));
    for (const exercise of practice) {
      if (items.length >= maxItems) break;
      if (chosen.has(exercise)) continue;
      chosen.add(exercise);
      items.push({
        exerciseId: idOf(exercise),
        reason: 'review',
        covers: [],
        gain: 0,
      });
    }

    if (options.fillWithNew) addNew(maxItems);

    const entries = items.map(({ exerciseId }) => {
      const lesson = exerciseLesson[
        graph.exerciseIndex.get(exerciseId) as number
      ] as number;
      return {
        course: graph.lessonCourse[lesson] as number,
        tags: graph.lessonTags[lesson] as readonly string[],
      };
    });
    const ordered = interleave(entries, options, rng);
    return {
      items: ordered.order.map((i) => items[i] as PlanItem),
      greedy,
      dueCount: due.length,
      newAvailable: newCandidates.length,
      interleaveOk: ordered.ok,
      dueCovered,
    };
  };

  return {
    planDay: (state, request) => planDayDetailed(state, request).items,
    planDayDetailed,
  };
};
