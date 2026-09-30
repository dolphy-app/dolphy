import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTheme } from 'vuetify';
import type {
  LearningEngine,
  LocaleMode,
  ThemeMode,
} from '@lms/engine-contract';
import { resolveLocale } from '@/shared/i18n';

/** Тема и язык хранятся в БД движка; применяются сразу. */
export const useAppearanceSettings = (engine: LearningEngine) => {
  const vuetifyTheme = useTheme();
  const { locale } = useI18n({ useScope: 'global' });
  const mode = ref<ThemeMode | null>(null);
  const localeMode = ref<LocaleMode | null>(null);
  const error = ref<string | null>(null);

  const applyLocale = (next: LocaleMode) => {
    locale.value = resolveLocale(next, navigator.language);
    document.documentElement.lang = locale.value;
  };

  onMounted(async () => {
    try {
      const ui = await engine.settings.getUi();
      mode.value = ui.theme;
      localeMode.value = ui.locale;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
    }
  });

  /** `null` шлёт переключатель при снятии выбора; режим обязателен. */
  const select = async (next: ThemeMode | null) => {
    if (next === null) return;
    const previous = mode.value;
    mode.value = next;
    vuetifyTheme.change(next);
    error.value = null;
    try {
      await engine.settings.setUi({ theme: next });
    } catch (caught) {
      // не сохранилось — возвращаем прежний вид, чтобы экран не лгал
      mode.value = previous;
      if (previous) vuetifyTheme.change(previous);
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
