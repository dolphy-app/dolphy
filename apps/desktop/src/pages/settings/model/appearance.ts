import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTheme } from 'vuetify';
import type {
  LearningEngine,
  LocaleMode,
  ThemeContributionDto,
} from '@lms/engine-contract';
import { resolveLocale } from '@/shared/i18n';
import {
  effectiveThemeId,
  resolveThemeName,
} from '@/shared/lib/extension-themes.ts';

/** Тема и язык хранятся в БД движка; применяются сразу. */
export const useAppearanceSettings = (
  engine: LearningEngine,
  themes: readonly ThemeContributionDto[] = [],
) => {
  const vuetifyTheme = useTheme();
  const { locale } = useI18n({ useScope: 'global' });
  const mode = ref<string | null>(null);
  const localeMode = ref<LocaleMode | null>(null);
  const error = ref<string | null>(null);

  const applyLocale = (next: LocaleMode) => {
    locale.value = resolveLocale(next, navigator.language);
    document.documentElement.lang = locale.value;
  };

  onMounted(async () => {
    try {
      const ui = await engine.settings.getUi();
      // неизвестная тема показывается как «Системная», сохранённое не трогаем
      mode.value = effectiveThemeId(ui.theme, themes);
      localeMode.value = ui.locale;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
    }
  });

  /** `null` шлёт переключатель при снятии выбора; тема обязательна. */
  const select = async (next: string | null) => {
    if (next === null) return;
    const previous = mode.value;
    mode.value = next;
    vuetifyTheme.change(resolveThemeName(next, themes));
    error.value = null;
    try {
      await engine.settings.setUi({ theme: next });
    } catch (caught) {
      // не сохранилось — возвращаем прежний вид, чтобы экран не лгал
      mode.value = previous;
      if (previous) vuetifyTheme.change(resolveThemeName(previous, themes));
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
