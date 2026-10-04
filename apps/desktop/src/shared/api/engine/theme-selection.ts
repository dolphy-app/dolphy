import { inject, readonly, ref } from 'vue';
import type { Ref } from 'vue';
import type { LearningEngine } from '@dolphy-app/engine-contract';
import { THEME_SELECTION_KEY } from './keys.ts';

/**
 * Сохранённый выбор темы (`settings.ui.theme`): единственный источник для
 * окна. Применяет его к Vuetify `bindExtensionThemes`; пока темы расширения
 * нет, окно показывает системную, а сохранённый id остаётся нетронутым.
 */
export interface ThemeSelection {
  readonly saved: Readonly<Ref<string>>;
  /** Применяет выбор сразу, затем сохраняет; при отказе движка возвращает прежний и бросает ошибку. */
  select(next: string): Promise<void>;
  dispose(): void;
}

export const createThemeSelection = (
  engine: LearningEngine,
  initial: string,
): ThemeSelection => {
  const saved = ref(initial);
  let saving = 0;

  const unsubscribe = engine.subscribe((event) => {
    if (event.type !== 'settings-changed' || event.scope !== 'ui') return;
    // слушатель не вызывает команды синхронно (API §7)
    queueMicrotask(() => {
      // собственный выбор ещё сохраняется: устаревшее чтение его не перебьёт
      if (saving > 0) return;
      engine.settings.getUi().then(
        (ui) => {
          if (saving === 0) saved.value = ui.theme;
        },
        (error) => console.error({ error }, 'ui theme was not reloaded'),
      );
    });
  });

  const select = async (next: string): Promise<void> => {
    const previous = saved.value;
    saved.value = next;
    saving += 1;
    try {
      await engine.settings.setUi({ theme: next });
    } catch (error) {
      saved.value = previous;
      throw error;
    } finally {
      saving -= 1;
    }
  };

  return { saved: readonly(saved), select, dispose: unsubscribe };
};

export const useThemeSelection = (): ThemeSelection => {
  const selection = inject(THEME_SELECTION_KEY);
  if (!selection) throw new Error('theme selection is not provided');
  return selection;
};
