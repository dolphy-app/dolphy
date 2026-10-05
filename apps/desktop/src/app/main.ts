import { createApp } from 'vue';
import { detectPlatform } from '@dolphy-app/keybindings';
import { EngineCallError } from '@dolphy-app/engine-rpc/client';
import App from './App.vue';
import { applyLocale, createDolphyI18n } from './providers/i18n.ts';
import { createDolphyQuery } from './providers/query.ts';
import { createDolphyVuetify } from './providers/vuetify.ts';
import { router } from './router';
import StartupError from './startup-error/StartupError.vue';
import { registerAppCommands } from '@/features/app-commands';
import { COURSE_SCOPE_KEY, createCourseScope } from '@/features/course-scope';
import {
  COURSE_UPDATES_KEY,
  createCourseUpdates,
} from '@/features/course-updates';
import {
  createKeybindingsService,
  createUserKeybindings,
  KEYBINDINGS_KEY,
} from '@/features/keybindings';
import {
  createExtensionTransfers,
  EXTENSION_TRANSFERS_KEY,
  syncTransferCommands,
} from '@/features/extension-transfers';
import {
  createExtensionCommands,
  describeCommandFailure,
  EXTENSION_COMMANDS_KEY,
} from '@/features/extension-commands';
import {
  CONTRIBUTIONS_KEY,
  connectEngine,
  createContributionsStore,
  createExtensionUpdatesStore,
  createLocaleSelection,
  createThemeSelection,
  ENGINE_KEY,
  EXTENSION_UPDATES_KEY,
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
  CONTEXT_KEYS_KEY,
  createContextKeys,
} from '@/shared/lib/context-keys.ts';
import {
  COMMAND_PALETTE_KEY,
  createCommandPalette,
} from '@/widgets/command-palette';
import { textOfExtension } from '@/shared/lib/extension-text.ts';
import { bindSyntaxPalette } from '@/shared/lib/syntax-binding.ts';
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
    const [{ theme, locale }, keybindingsSettings, contributions] =
      await Promise.all([
        engine.settings.getUi(),
        engine.settings.getKeybindings(),
        createContributionsStore(engine),
      ]);
    const extensionUpdates = createExtensionUpdatesStore(engine);
    const userKeybindings = createUserKeybindings(
      engine,
      keybindingsSettings.commands,
    );
    onReconnect(() => {
      void contributions.reconnected();
      void extensionUpdates.reconnected();
      void userKeybindings.reconnected();
    });
    const query = createDolphyQuery(engine);
    onReconnect(() => query.reconnected());
    const i18n = createDolphyI18n(resolveLocale(locale, navigator.language));
    const courseScope = await createCourseScope(engine);
    const courseUpdates = createCourseUpdates(engine, {
      courseNames: () =>
        new Map(courseScope.courses.value.map(({ id, name }) => [id, name])),
    });
    onReconnect(() => void courseUpdates.reconnected());
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
    // цвета подсветки кода следуют за темой: Markdown и редактор ответа
    bindSyntaxPalette(vuetify.theme);
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
    const translate = (key: string, params?: Record<string, unknown>) =>
      i18n.global.t(key as never, (params ?? {}) as never) as string;
    const extensionTransfers = createExtensionTransfers({
      engine: engine.extensions,
      platform: window.dolphy.platform,
      contributions: () => contributions.contributions.value,
      notify: (text) =>
        extensionCommands.notices.push({ kind: 'notify', text }),
      t: translate,
    });
    syncTransferCommands(
      registry,
      () => contributions.contributions.value,
      extensionTransfers,
      translate,
      () => i18n.global.locale.value,
    );
    const palette = createCommandPalette({ registry });
    const platform = detectPlatform(navigator);
    const contextKeys = createContextKeys(platform, document);
    const keybindings = createKeybindingsService({
      registry,
      user: userKeybindings,
      extensionBindings: () => extensionCommands.bindings.value,
      platform,
    });
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
      .use(query)
      .provide(ENGINE_KEY, engine)
      .provide(CONTRIBUTIONS_KEY, contributions.contributions)
      .provide(EXTENSION_UPDATES_KEY, extensionUpdates)
      .provide(THEME_SELECTION_KEY, themeSelection)
      .provide(LOCALE_SELECTION_KEY, localeSelection)
      .provide(COURSE_SCOPE_KEY, courseScope)
      .provide(COURSE_UPDATES_KEY, courseUpdates)
      .provide(COMMAND_REGISTRY_KEY, registry)
      .provide(COMMAND_PALETTE_KEY, palette)
      .provide(EXTENSION_COMMANDS_KEY, extensionCommands)
      .provide(EXTENSION_TRANSFERS_KEY, extensionTransfers)
      .provide(CONTEXT_KEYS_KEY, contextKeys)
      .provide(KEYBINDINGS_KEY, keybindings)
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
