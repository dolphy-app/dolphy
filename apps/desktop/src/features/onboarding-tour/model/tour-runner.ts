import { reactive } from 'vue';
import type { TourStatus } from '@dolphy-app/engine-contract';
import type { TourDefinition, TourStep } from '../lib/tours.ts';

/*
 * Машина состояний тура без DOM. Модель шагов (цель, переход, хук перед
 * шагом, start/next/previous/skip/finish, ожидание цели) взята у vue-tour
 * (pulsardev/vue-tour, MIT) и переписана под Vue 3: цель ищется на каждом
 * шаге заново, а не один раз при создании, отсутствующая цель пропускает шаг.
 */

export interface TourRunnerDeps {
  /** Ждёт элемент цели; `null` — не появился за отведённое время. */
  findTarget(target: string): Promise<HTMLElement | null>;
  /** Переходит на страницу шага (если ученик не на ней). */
  navigate(route: string): Promise<void>;
  /** Тур закончился: `completed` — дошёл до конца, `skipped` — прерван. */
  onEnd(tourId: string, outcome: TourStatus): void;
}

export interface TourRunnerState {
  tour: TourDefinition | null;
  /** Индекс показанного шага. */
  index: number;
  /** Цель показанного шага; `null` — шаг без цели. */
  element: HTMLElement | null;
  /** Идёт переход к шагу: кнопки не принимают повторных нажатий. */
  busy: boolean;
}

export interface TourRunner {
  readonly state: TourRunnerState;
  readonly running: boolean;
  readonly step: TourStep | null;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  start(tour: TourDefinition): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  skip(): void;
}

type Landing = 'landed' | 'exhausted' | 'stale';

export const createTourRunner = (deps: TourRunnerDeps): TourRunner => {
  const state = reactive<TourRunnerState>({
    tour: null,
    index: 0,
    element: null,
    busy: false,
  });
  // каждый переход получает номер: ответ устаревшего перехода игнорируется
  const sequence = { current: 0 };
  const progress = { shown: false };

  /** Ищет ближайший показываемый шаг от `from` в направлении `direction`. */
  const land = async (
    tour: TourDefinition,
    from: number,
    direction: 1 | -1,
    token: number,
  ): Promise<Landing> => {
    for (let i = from; i >= 0 && i < tour.steps.length; i += direction) {
      const step = tour.steps[i] as TourStep;
      if (step.route !== undefined) await deps.navigate(step.route);
      if (token !== sequence.current) return 'stale';
      let element: HTMLElement | null = null;
      if (step.target !== undefined) {
        element = await deps.findTarget(step.target);
        if (token !== sequence.current) return 'stale';
        // цели нет (нет курсов, скрыт переключатель): шаг пропускается
        if (element === null) continue;
      }
      state.index = i;
      state.element = element;
      progress.shown = true;
      return 'landed';
    }
    return 'exhausted';
  };

  const end = (outcome: TourStatus) => {
    const tour = state.tour;
    sequence.current += 1;
    state.tour = null;
    state.element = null;
    state.index = 0;
    state.busy = false;
    progress.shown = false;
    if (tour !== null) deps.onEnd(tour.id, outcome);
  };

  const move = async (direction: 1 | -1) => {
    const tour = state.tour;
    if (tour === null || state.busy) return;
    sequence.current += 1;
    const token = sequence.current;
    const target = state.index + direction;
    state.busy = true;
    const landing = await land(tour, target, direction, token);
    if (landing === 'stale') return;
    state.busy = false;
    if (landing === 'exhausted') {
      if (direction === 1) end(progress.shown ? 'completed' : 'skipped');
      // назад показывать нечего: остаёмся на текущем шаге (страница могла смениться)
      else {
        sequence.current += 1;
        state.busy = true;
        const back = await land(tour, state.index, 1, sequence.current);
        if (back !== 'stale') state.busy = false;
      }
    }
  };

  return {
    state,
    get running() {
      return state.tour !== null;
    },
    get step() {
      return state.tour?.steps[state.index] ?? null;
    },
    get isFirst() {
      return state.index === 0;
    },
    get isLast() {
      return state.tour !== null && state.index === state.tour.steps.length - 1;
    },
    start: async (tour) => {
      if (state.tour !== null) return;
      sequence.current += 1;
      const token = sequence.current;
      state.tour = tour;
      state.index = 0;
      state.element = null;
      state.busy = true;
      progress.shown = false;
      const landing = await land(tour, 0, 1, token);
      if (landing === 'stale') return;
      state.busy = false;
      // ни один шаг показать не удалось
      if (landing === 'exhausted') end('skipped');
    },
    next: () => move(1),
    previous: () => move(-1),
    skip: () => end('skipped'),
  };
};
