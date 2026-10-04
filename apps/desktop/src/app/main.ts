import { createApp } from 'vue';
import { EngineCallError } from '@dolphy-app/engine-rpc/client';
import App from './App.vue';
import { applyLocale, createDolphyI18n } from './providers/i18n.ts';
import { createDolphyVuetify } from './providers/vuetify.ts';
import { router } from './router';
import StartupError from './startup-error/StartupError.vue';
import { registerAppCommands } from '@/features/app-commands';
import { COURSE_SCOPE_KEY, createCourseScope } from '@/features/course-scope';
import {
  createExtensionCommands,
  describeCommandFailure,
  EXTENSION_COMMANDS_KEY,
} from '@/features/extension-commands';
import {
  CONTRIBUTIONS_KEY,
  connectEngine,
  createContributionsStore,
  createLocaleSelection,
  createThemeSelection,
  ENGINE_KEY,
  LOCALE_SELECTION_KEY,
  THEME_SELECTION_KEY,
} from '@/shared/api/engine';
import { ROUTE } from '@/shared/config/routes.ts';
import { resolveLocale } from '@/shared/i18n';
import {
  COMMAND_REGISTRY_KEY,
  createCommandRegistry,
} from '@/shared/lib/command-registry.ts';
import {
  COMMAND_PALETTE_KEY,
  createCommandPalette,
} from '@/widgets/command-palette';
import { textOfExtension } from '@/shared/lib/extension-text.ts';
import { bindExtensionThemes } from '@/shared/lib/theme-registry.ts';

import './styles/global.css';

// движок недоступен — настроек из БД нет: язык системы, тема системы
const showStartupError = (error: unknown) => {
  const incompatible =
    error instanceof EngineCallError && error.code === 'INCOMPATIBLE_CONTRACT';
  const i18n = createDolphyI18n(resolveLocale('system', navigator.language));
  createApp(StartupError, {
    kind: incompatible ? 'update' : 'failed',
    message: error instanceof Error ? error.message : String(error),
  })
    .use(i18n)
    .use(createDolphyVuetify(i18n))
    .mount('#app');
};

const bootstrap = async () => {
  const smoke = __DOLPHY_SMOKE_BUILD__ ? window.dolphy.smoke : undefined;
  try {
    // UI монтируется после рукопожатия
    const { engine, onReconnect } = await connectEngine();
    const [{ theme, locale }, contributions] = await Promise.all([
      engine.settings.getUi(),
      createContributionsStore(engine),
    ]);
    onReconnect(() => void contributions.reconnected());
    const i18n = createDolphyI18n(resolveLocale(locale, navigator.language));
    const courseScope = await createCourseScope(engine);
    const vuetify = createDolphyVuetify(i18n);
    const themeSelection = createThemeSelection(engine, theme);
    const localeSelection = createLocaleSelection(engine, locale, {
      apply: (next) => applyLocale(i18n, next),
      systemLanguage: () => navigator.language,
    });
    bindExtensionThemes(
      vuetify.theme,
      themeSelection.saved,
      () => contributions.contributions.value.themes,
    );
    const registry = createCommandRegistry();
    const extensionCommands = createExtensionCommands({
      registry,
      engine: engine.extensions,
      contributions: () => contributions.contributions.value,
      locale: () => i18n.global.locale.value,
      openPanel: ({ extensionId, panelId }) =>
        void router.push({
          name: ROUTE.extensionPanel,
          params: { extensionId, panelId },
        }),
    });
    const palette = createCommandPalette({ registry });
    registerAppCommands({
      registry,
      openPalette: () => palette.open(),
      router,
      t: i18n.global.t,
      themeSelection,
      localeSelection,
      themes: () => contributions.contributions.value.themes,
      extensionText: (value, extensionId) =>
        textOfExtension(
          value,
          extensionId,
          contributions.contributions.value,
          i18n.global.locale.value,
        ),
      reportFailure: (error) =>
        extensionCommands.notices.push({
          kind: 'failure',
          failure: describeCommandFailure(error),
        }),
    });
    createApp(App)
      .use(i18n)
      .use(vuetify)
      .use(router)
      .provide(ENGINE_KEY, engine)
      .provide(CONTRIBUTIONS_KEY, contributions.contributions)
      .provide(THEME_SELECTION_KEY, themeSelection)
      .provide(LOCALE_SELECTION_KEY, localeSelection)
      .provide(COURSE_SCOPE_KEY, courseScope)
      .provide(COMMAND_REGISTRY_KEY, registry)
      .provide(COMMAND_PALETTE_KEY, palette)
      .provide(EXTENSION_COMMANDS_KEY, extensionCommands)
      .mount('#app');
    if (__DOLPHY_SMOKE_BUILD__ && smoke) {
      const { runSmoke } = await import('./smoke/run-smoke.ts');
      smoke.report(await runSmoke(engine, smoke));
    }
  } catch (error) {
    showStartupError(error);
    if (__DOLPHY_SMOKE_BUILD__)
      smoke?.report({ ok: false, error: String(error) });
  }
};

void bootstrap();
