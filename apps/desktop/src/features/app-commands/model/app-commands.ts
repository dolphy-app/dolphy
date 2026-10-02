import type { ComposerTranslation } from 'vue-i18n';
import type { RouteLocationRaw } from 'vue-router';
import type {
  LocaleMode,
  ThemeContributionDto,
} from '@dolphy-app/engine-contract';
import type { LocaleSelection } from '@/shared/api/engine/locale-selection.ts';
import type { ThemeSelection } from '@/shared/api/engine/theme-selection.ts';
import { ROUTE } from '@/shared/config/routes.ts';
import { syncCommands } from '@/shared/lib/command-registry.ts';
import type {
  CommandDescriptor,
  CommandRegistry,
  SyncedCommand,
} from '@/shared/lib/command-registry.ts';
import { effectiveThemeId } from '@/shared/lib/extension-themes.ts';

export interface AppCommandsDeps {
  registry: CommandRegistry;
  router: { push(to: RouteLocationRaw): Promise<unknown> };
  /** Переводчик окна: названия читаются при каждом чтении списка, язык меняется на лету. */
  t: ComposerTranslation;
  themeSelection: Pick<ThemeSelection, 'saved' | 'select'>;
  localeSelection: Pick<LocaleSelection, 'saved' | 'select'>;
  /** Темы расширений; читается реактивно (`contributions-changed`). */
  themes: () => readonly ThemeContributionDto[];
  /** Сбой выполнения команды (например, настройка не сохранилась): приложение показывает уведомление. */
  reportFailure(error: unknown): void;
}

const DESTINATIONS = [
  { id: 'dailyPlan', route: ROUTE.dailyPlan, keybinding: undefined },
  { id: 'courses', route: ROUTE.courses, keybinding: undefined },
  { id: 'graph', route: ROUTE.graph, keybinding: undefined },
  { id: 'settings', route: ROUTE.settings, keybinding: 'Mod+,' },
  {
    id: 'settingsLearning',
    route: ROUTE.settingsLearning,
    keybinding: undefined,
  },
  {
    id: 'settingsLibrary',
    route: ROUTE.settingsLibrary,
    keybinding: undefined,
  },
  {
    id: 'settingsAppearance',
    route: ROUTE.settingsAppearance,
    keybinding: undefined,
  },
  {
    id: 'settingsExtensions',
    route: ROUTE.settingsExtensions,
    keybinding: undefined,
  },
  { id: 'settingsAbout', route: ROUTE.settingsAbout, keybinding: undefined },
] as const;

const BUILTIN_THEMES = ['system', 'light', 'dark'] as const;
const LOCALE_MODES: readonly LocaleMode[] = ['system', 'ru', 'en'];

/**
 * Регистрирует команды самого приложения: переходы, смена темы и языка.
 * Команды тем строятся по реактивному списку (встроенные и темы включённых
 * расширений) и появляются и исчезают вместе с ним. Возвращает снятие всех
 * записей.
 */
export const registerAppCommands = (deps: AppCommandsDeps): (() => void) => {
  const { registry, t } = deps;

  // выполнение: сбой уходит в уведомление, а не в необработанный промис
  const guarded = (action: () => unknown): (() => Promise<void>) => {
    return async () => {
      try {
        await action();
      } catch (error) {
        deps.reportFailure(error);
      }
    };
  };

  const app = (
    id: string,
    descriptor: Omit<CommandDescriptor, 'key' | 'source'>,
  ): CommandDescriptor => ({ key: `app:${id}`, source: 'app', ...descriptor });

  const disposers = DESTINATIONS.map(({ id, route, keybinding }) =>
    registry.register(
      app(`go:${id}`, {
        title: () => t(`appCommands.go.${id}`),
        category: () => t('appCommands.category.go'),
        keybinding,
        run: guarded(() => deps.router.push({ name: route })),
      }),
    ),
  );

  const themeCommand = (id: string, name: () => string): CommandDescriptor =>
    app(`theme:${id}`, {
      title: () => t('appCommands.theme', { name: name() }),
      category: () => t('appCommands.category.theme'),
      checked: () =>
        effectiveThemeId(deps.themeSelection.saved.value, deps.themes()) === id,
      run: guarded(() => deps.themeSelection.select(id)),
    });

  const themes = (): SyncedCommand[] => [
    ...BUILTIN_THEMES.map((id) => ({
      descriptor: themeCommand(id, () => t(`settings.appearance.theme.${id}`)),
      revision: id,
    })),
    ...deps.themes().map(({ id, label }) => ({
      descriptor: themeCommand(id, () => label),
      revision: label,
    })),
  ];
  const stopThemes = syncCommands(registry, themes);

  for (const mode of LOCALE_MODES) {
    disposers.push(
      registry.register(
        app(`locale:${mode}`, {
          title: () =>
            t('appCommands.language', {
              name: t(`settings.appearance.language.${mode}`),
            }),
          category: () => t('appCommands.category.language'),
          checked: () => deps.localeSelection.saved.value === mode,
          run: guarded(() => deps.localeSelection.select(mode)),
        }),
      ),
    );
  }

  return () => {
    stopThemes();
    for (const dispose of disposers) dispose();
  };
};
