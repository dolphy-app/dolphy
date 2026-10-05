import { computed, inject, shallowRef } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type {
  ExtensionUpdateDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import { EXTENSION_UPDATES_KEY } from './keys.ts';

/** С этого числа значок показывает «9+». */
const BADGE_CAP = 9;

/** Текст значка обновлений: число, от 9 и больше — «9+»; `null` — значка нет. */
export const updatesBadgeText = (count: number): string | null => {
  if (count <= 0) return null;
  return count >= BADGE_CAP ? `${BADGE_CAP}+` : String(count);
};

export interface ExtensionUpdates {
  readonly updates: Readonly<Ref<readonly ExtensionUpdateDto[]>>;
  /** Число доступных обновлений. */
  readonly count: ComputedRef<number>;
}

export interface ExtensionUpdatesStore extends ExtensionUpdates {
  /** Движок перезапущен (новый порт): число читается заново, ответы прежнего порта отбрасываются. */
  reconnected(): Promise<void>;
  /** Отписывается от событий движка. */
  dispose(): void;
}

/**
 * Доступные обновления установленных из каталога расширений (`extensions.updates()`)
 * для значка на «Настройках» и вкладке «Расширения». Читает их при создании, после
 * каждого `extensions-changed` (установка, удаление и находка обновлений стартовой
 * проверкой) и после переподключения. Устаревший ответ отбрасывается; сбой чтения
 * оставляет прежнее число, причина — в консоль.
 */
export const createExtensionUpdatesStore = (
  engine: LearningEngine,
): ExtensionUpdatesStore => {
  const state = shallowRef<readonly ExtensionUpdateDto[]>([]);
  let latest = 0;

  const refresh = async (): Promise<void> => {
    latest += 1;
    const request = latest;
    try {
      const next = await engine.extensions.updates();
      if (request === latest) state.value = next;
    } catch (error) {
      if (request === latest) {
        console.error({ error }, 'extension updates were not loaded');
      }
    }
  };

  const unsubscribe = engine.subscribe((event) => {
    if (event.type !== 'extensions-changed') return;
    // слушатель не вызывает команды синхронно (API §7)
    queueMicrotask(() => void refresh());
  });

  void refresh();
  return {
    updates: state,
    count: computed(() => state.value.length),
    reconnected: refresh,
    dispose: unsubscribe,
  };
};

const NO_UPDATES: ExtensionUpdates = {
  updates: shallowRef([]),
  count: computed(() => 0),
};

export const useExtensionUpdates = (): ExtensionUpdates =>
  inject(EXTENSION_UPDATES_KEY, NO_UPDATES);
