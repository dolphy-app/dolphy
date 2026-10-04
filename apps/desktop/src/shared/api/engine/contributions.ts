import { inject, shallowRef } from 'vue';
import type { Ref } from 'vue';
import type {
  ContributionsDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import { CONTRIBUTIONS_KEY } from './keys.ts';

/** Вклады до первого ответа движка (и при сбое первого чтения). */
export const NO_CONTRIBUTIONS: ContributionsDto = {
  generation: 0,
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
  settings: [],
  commands: [],
  panels: [],
  importers: [],
  exporters: [],
  messages: {},
};

export type ContributionsRef = Readonly<Ref<Readonly<ContributionsDto>>>;

export interface ContributionsStore {
  readonly contributions: ContributionsRef;
  /**
   * Движок перезапущен (новый порт): `generation` начался с нуля, поэтому
   * «уже виденное» поколение сбрасывается и вклады читаются заново.
   */
  reconnected(): Promise<void>;
  /** Отписывается от событий движка. */
  dispose(): void;
}

/**
 * Реактивные вклады расширений. Читает их при создании и после каждого
 * `contributions-changed`. Ответ с поколением меньше уже виденного (из
 * события или принятого ответа) устарел и отбрасывается; после
 * переподключения отсчёт идёт заново, а ответы прежнего порта отбрасываются.
 * Сбой чтения не мешает работе: остаются прежние вклады, причина — в консоль.
 */
export const createContributionsStore = async (
  engine: LearningEngine,
): Promise<ContributionsStore> => {
  const state = shallowRef<ContributionsDto>(NO_CONTRIBUTIONS);
  let seen = -1;
  let epoch = 0;

  const refresh = async (): Promise<void> => {
    const startedIn = epoch;
    try {
      const next = await engine.extensions.contributions();
      if (startedIn !== epoch || next.generation < seen) return;
      seen = next.generation;
      state.value = next;
    } catch (error) {
      console.error({ error }, 'extension contributions were not loaded');
    }
  };

  const unsubscribe = engine.subscribe((event) => {
    if (event.type !== 'contributions-changed') return;
    seen = Math.max(seen, event.generation);
    // слушатель не вызывает команды синхронно (API §7)
    queueMicrotask(() => void refresh());
  });

  await refresh();
  return {
    contributions: state,
    reconnected: () => {
      epoch += 1;
      seen = -1;
      return refresh();
    },
    dispose: unsubscribe,
  };
};

export const useContributions = (): ContributionsRef =>
  inject(CONTRIBUTIONS_KEY, shallowRef(NO_CONTRIBUTIONS));
