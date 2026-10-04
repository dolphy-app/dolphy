import { inject, readonly, ref } from 'vue';
import type { Ref } from 'vue';
import type { LearningEngine, LocaleMode } from '@dolphy-app/engine-contract';
import { resolveLocale } from '@/shared/i18n';
import type { AppLocale } from '@/shared/i18n';
import { LOCALE_SELECTION_KEY } from './keys.ts';

/**
 * Сохранённый выбор языка (`settings.ui.locale`): единственный источник для
 * окна. Выбор применяется к интерфейсу сразу (`apply`), затем сохраняется;
 * режим `system` разрешается по языку системы.
 */
export interface LocaleSelection {
  readonly saved: Readonly<Ref<LocaleMode>>;
  /** Применяет выбор сразу, затем сохраняет; при отказе движка возвращает прежний и бросает ошибку. */
  select(next: LocaleMode): Promise<void>;
  dispose(): void;
}

export interface LocaleSelectionDeps {
  /** Меняет язык интерфейса и `<html lang>`. */
  apply(locale: AppLocale): void;
  /** Язык системы для режима `system`. */
  systemLanguage: () => string;
}

export const createLocaleSelection = (
  engine: LearningEngine,
  initial: LocaleMode,
  deps: LocaleSelectionDeps,
): LocaleSelection => {
  const saved = ref(initial);
  let saving = 0;

  const show = (mode: LocaleMode) => {
    saved.value = mode;
    deps.apply(resolveLocale(mode, deps.systemLanguage()));
  };

  const unsubscribe = engine.subscribe((event) => {
    if (event.type !== 'settings-changed' || event.scope !== 'ui') return;
    // слушатель не вызывает команды синхронно (API §7)
    queueMicrotask(() => {
      // собственный выбор ещё сохраняется: устаревшее чтение его не перебьёт
      if (saving > 0) return;
      engine.settings.getUi().then(
        (ui) => {
          if (saving === 0 && ui.locale !== saved.value) show(ui.locale);
        },
        (error) => console.error({ error }, 'ui locale was not reloaded'),
      );
    });
  });

  const select = async (next: LocaleMode): Promise<void> => {
    const previous = saved.value;
    show(next);
    saving += 1;
    try {
      await engine.settings.setUi({ locale: next });
    } catch (error) {
      show(previous);
      throw error;
    } finally {
      saving -= 1;
    }
  };

  return { saved: readonly(saved), select, dispose: unsubscribe };
};

export const useLocaleSelection = (): LocaleSelection => {
  const selection = inject(LOCALE_SELECTION_KEY);
  if (!selection) throw new Error('locale selection is not provided');
  return selection;
};
