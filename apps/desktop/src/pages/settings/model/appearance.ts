import { computed, ref, toValue } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import type { LocaleMode } from '@dolphy-app/engine-contract';
import type { LocaleSelection } from '@/shared/api/engine/locale-selection.ts';
import type { ThemeSelection } from '@/shared/api/engine/theme-selection.ts';
import type { ClientTheme } from '@/shared/lib/extension-clients.ts';
import { effectiveThemeId } from '@/shared/lib/extension-themes.ts';

/**
 * Тема и язык хранятся в БД движка; применяются сразу. Тему применяет окно
 * (`bindExtensionThemes`) по `selection.saved`, язык — `localeSelection`:
 * настройки показывают тот же выбор, что и команды палитры, а пропавшая тема
 * расширения выглядит как «Как в системе».
 */
export const useAppearanceSettings = (
  selection: ThemeSelection,
  localeSelection: LocaleSelection,
  themes: MaybeRefOrGetter<readonly Pick<ClientTheme, 'id'>[]>,
) => {
  const mode = computed(() =>
    effectiveThemeId(selection.saved.value, toValue(themes)),
  );
  const error = ref<string | null>(null);

  /** `null` шлёт переключатель при снятии выбора; тема обязательна. */
  const select = async (next: string | null) => {
    if (next === null) return;
    error.value = null;
    try {
      await selection.select(next);
    } catch (caught) {
      // не сохранилось — выбор уже возвращён, чтобы экран не лгал
      error.value = caught instanceof Error ? caught.message : String(caught);
    }
  };

  const selectLocale = async (next: LocaleMode | null) => {
    if (next === null) return;
    error.value = null;
    try {
      await localeSelection.select(next);
    } catch (caught) {
      // не сохранилось — выбор уже возвращён, чтобы экран не лгал
      error.value = caught instanceof Error ? caught.message : String(caught);
    }
  };

  return {
    mode,
    localeMode: localeSelection.saved,
    error,
    select,
    selectLocale,
  };
};
