import { reactive, ref } from 'vue';
import type { LearningEngine, TourStatus } from '@dolphy-app/engine-contract';

export interface TourProgress {
  /** Исходы туров по id; нет записи — тур ещё не предлагали. */
  readonly statuses: Readonly<Record<string, TourStatus>>;
  /** Сохранённое прочитано (или чтение не удалось): предлагать туры можно. */
  readonly loaded: Readonly<{ value: boolean }>;
  hydrate(): Promise<void>;
  /** Запоминает исход; отказ движка не ломает интерфейс (остаётся до закрытия окна). */
  record(id: string, status: TourStatus): Promise<void>;
}

/**
 * Исходы туров в настройках интерфейса (`UiSettingsDto.tours`). Фабрика
 * отдельно от композабла: тесту не нужен `window.dolphy`.
 */
export const createTourProgress = (
  engine: Pick<LearningEngine, 'settings'>,
): TourProgress => {
  const statuses = reactive<Record<string, TourStatus>>({});
  const loaded = ref(false);
  const hydration: { promise: Promise<void> | null } = { promise: null };

  const hydrate = () => {
    hydration.promise ??= engine.settings.getUi().then(
      (ui) => {
        // исход, записанный раньше ответа движка, не затирается
        for (const [id, status] of Object.entries(ui.tours ?? {})) {
          statuses[id] ??= status;
        }
        loaded.value = true;
      },
      (error) => {
        // без записей тур предложат снова: это лучше, чем не предложить никогда
        console.error({ error }, 'tour outcomes were not loaded');
        loaded.value = true;
      },
    );
    return hydration.promise;
  };

  return {
    statuses,
    loaded,
    hydrate,
    record: async (id, status) => {
      statuses[id] = status;
      try {
        await engine.settings.setUi({ tours: { [id]: status } });
      } catch (error) {
        console.error({ error, id }, 'tour outcome was not saved');
      }
    },
  };
};
