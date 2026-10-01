import { computed, onMounted, ref, toValue } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  LearningEngine,
  LocaleMode,
  ThemeContributionDto,
} from '@dolphy-app/engine-contract';
import type { ThemeSelection } from '@/shared/api/engine/theme-selection.ts';
import { resolveLocale } from '@/shared/i18n';
import { effectiveThemeId } from '@/shared/lib/extension-themes.ts';

/**
 * Тема и язык хранятся в БД движка; применяются сразу. Тему применяет окно
 * (`bindExtensionThemes`) по `selection.saved`: настройки показывают тот же
 * выбор, а пропавшая тема расширения выглядит как «Как в системе».
 */
export const useAppearanceSettings = (
  engine: LearningEngine,
  selection: ThemeSelection,
  themes: MaybeRefOrGetter<readonly ThemeContributionDto[]>,
) => {
  const { locale } = useI18n({ useScope: 'global' });
  const mode = computed(() =>
    effectiveThemeId(selection.saved.value, toValue(themes)),
  );
  const localeMode = ref<LocaleMode | null>(null);
  const error = ref<string | null>(null);

  const applyLocale = (next: LocaleMode) => {
    locale.value = resolveLocale(next, navigator.language);
    document.documentElement.lang = locale.value;
  };

  onMounted(async () => {
    try {
      localeMode.value = (await engine.settings.getUi()).locale;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
    }
  });

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
    const previous = localeMode.value;
    localeMode.value = next;
    applyLocale(next);
    error.value = null;
    try {
      await engine.settings.setUi({ locale: next });
    } catch (caught) {
      localeMode.value = previous;
      if (previous) applyLocale(previous);
      error.value = caught instanceof Error ? caught.message : String(caught);
    }
  };

  return { mode, localeMode, error, select, selectLocale };
};
