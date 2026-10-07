import { watch } from 'vue';
import type { Ref, WatchStopHandle } from 'vue';
import type { ThemeDefinition } from 'vuetify';
import {
  baseThemeOf,
  resolveThemeName,
  toVuetifyTheme,
  vuetifyThemeName,
} from './extension-themes.ts';
import type { ClientTheme } from './extension-client-registrations.ts';

/** Часть `vuetify.theme`, которой пользуется привязка. */
export interface ThemeRegistry {
  readonly themes: Ref<Record<string, ThemeDefinition>>;
  change(name: string): unknown;
}

/**
 * Держит темы расширений в реестре Vuetify в соответствии с реестром клиентских
 * частей и применяет сохранённый выбор: пока тема не зарегистрирована (клиентская
 * часть ещё грузится) или исчезла, выбор показывает «Как в системе» до её
 * удаления из реестра (иначе Vuetify остался бы с неизвестным именем), а когда
 * тема появляется, применяется. Сохранённый id не меняется. Синхронно, чтобы
 * промежуточные состояния не мигали.
 */
export const bindExtensionThemes = (
  registry: ThemeRegistry,
  saved: Readonly<Ref<string>>,
  themes: () => readonly ClientTheme[],
): WatchStopHandle => {
  let registered = new Set<string>();
  return watch(
    [saved, themes],
    ([id, contributed]) => {
      const next = new Map(
        contributed.map((item) => [
          vuetifyThemeName(item.id),
          toVuetifyTheme(item, baseThemeOf(item)),
        ]),
      );
      for (const [name, definition] of next) {
        registry.themes.value[name] = definition;
      }
      registry.change(resolveThemeName(id, contributed));
      for (const name of registered) {
        if (!next.has(name)) delete registry.themes.value[name];
      }
      registered = new Set(next.keys());
    },
    { immediate: true, flush: 'sync' },
  );
};
