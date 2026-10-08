import { createApp } from 'vue';
import { detectPlatform } from '@dolphy-app/keybindings';
import { EngineCallError } from '@dolphy-app/engine-rpc/client';
import {
  ENGINE_KEY as EXTENSION_ENGINE_KEY,
  resolveLocalizedText,
} from '@dolphy-app/extension-api';
import App from './App.vue';
import { applyLocale, createDolphyI18n } from './providers/i18n.ts';
import { createDolphyQuery } from './providers/query.ts';
import { createDolphyVuetify } from './providers/vuetify.ts';
import { router } from './router';
import StartupError from './startup-error/StartupError.vue';
import { registerAppCommands } from '@/features/app-commands';
import {
  createOnboardingTour,
  ONBOARDING_TOUR_KEY,
} from '@/features/onboarding-tour';
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
  createNotices,
  createPanelProps,
  describeCommandFailure,
  EXTENSION_COMMANDS_KEY,
  panelKey,
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
import {
  createInstall,
  createInstallLinks,
  INSTALL_KEY,
} from '@/pages/settings';
import { ROUTE } from '@/shared/config/routes.ts';
import { FALLBACK_LOCALE, LOCALES, resolveLocale } from '@/shared/i18n';
import { installHostModules } from '@/shared/lib/host-modules.ts';
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
import {
  createExtensionClients,
  EXTENSION_CLIENTS_KEY,
} from '@/shared/lib/extension-clients.ts';
import { createExtensionApp } from '@/shared/lib/extension-app.ts';
import { EXTENSION_APPS_KEY } from '@/shared/lib/extension-context.ts';
import { themeIdOfVuetify } from '@/shared/lib/extension-themes.ts';
import {
  createExtensionWhen,
  EXTENSION_WHEN_KEY,
} from '@/shared/lib/extension-when.ts';
import { createInjectionMounter } from '@/shared/lib/extension-injections.ts';
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
  installHostModules();
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
    const registry = createCommandRegistry();
    const notices = createNotices();
    const panelProps = createPanelProps();
    const openPanelPage = ({
      extensionId,
      panelId,
    }: {
      extensionId: string;
      panelId: string;
    }) =>
      void router.push({
        name: ROUTE.extensionPanel,
        params: { extensionId, panelId },
      });
    const app = createApp(App);
    // `AppApi` расширений: возможности окна, которые расширение вправе вызывать
    const extensionApps = createExtensionApp({
      app,
      router,
      registry,
      focusCourse: (courseId) => courseScope.select(courseId),
      openPanel: (extensionId, panelId, props) => {
        panelProps.set(panelKey(extensionId, panelId), props);
        openPanelPage({ extensionId, panelId });
      },
      notify: (text, level) => notices.push({ kind: 'notify', text, level }),
      theme: () => {
        const { dark } = vuetify.theme.current.value;
        return { id: themeIdOfVuetify(vuetify.theme.name.value, dark), dark };
      },
      locale: () =>
        LOCALES.find((item) => item === i18n.global.locale.value) ??
        FALLBACK_LOCALE,
    });
    // клиентские части расширений: окно импортирует их `client.mjs` и держит реестр вкладов
    const clients = createExtensionClients({
      contributions: () => contributions.contributions.value,
      apps: extensionApps,
      engine,
    });
    bindExtensionThemes(
      vuetify.theme,
      themeSelection.saved,
      () => clients.themes.value,
    );
    // цвета подсветки кода следуют за темой: Markdown и редактор ответа
    bindSyntaxPalette(vuetify.theme);
    // условия `when` команд, панелей и виджетов расширений: значения читаются у источников при каждом вычислении
    const extensionWhen = createExtensionWhen({
      route: () => router.currentRoute.value.name,
      courseActive: () => courseScope.activeId.value !== null,
      locale: () => i18n.global.locale.value,
      dark: () => vuetify.theme.current.value.dark,
    });
    const extensionCommands = createExtensionCommands({
      registry,
      engine: engine.extensions,
      contributions: () => contributions.contributions.value,
      clients,
      locale: () => i18n.global.locale.value,
      when: extensionWhen,
      notices,
      panelProps,
      openPanel: openPanelPage,
    });
    const onboardingTour = createOnboardingTour({
      engine,
      currentRoute: () => router.currentRoute.value.name,
      navigate: async (name) => {
        if (router.currentRoute.value.name !== name)
          await router.push({ name });
      },
    });
    const translate = (key: string, params?: Record<string, unknown>) =>
      i18n.global.t(key as never, (params ?? {}) as never) as string;
    // установка и обновление расширений: одно состояние на окно, диалог в App.vue;
    // ссылка `dolphy://extensions/install/<id>` только открывает диалог, ставит «Установить»
    const install = createInstall(engine);
    const installLinks = createInstallLinks({
      engine,
      install,
      notify: ({ key, params }) =>
        extensionCommands.notices.push({
          kind: 'notify',
          text: translate(`settings.extensions.link.${key}`, params),
        }),
      textOf: (text) => resolveLocalizedText(text, i18n.global.locale.value),
      openPage: (id) =>
        void router.push({
          name: ROUTE.settingsExtensionDetails,
          params: { id },
        }),
    });
    const extensionTransfers = createExtensionTransfers({
      engine: engine.extensions,
      platform: window.dolphy.platform,
      contributions: () => contributions.contributions.value,
      locale: () => i18n.global.locale.value,
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
      startTour: () => onboardingTour.start(),
      canStartTour: () => onboardingTour.canStart(),
      t: i18n.global.t,
      themeSelection,
      localeSelection,
      themes: () => clients.themes.value,
      locale: () => i18n.global.locale.value,
      reportFailure: (error) =>
        extensionCommands.notices.push({
          kind: 'failure',
          failure: describeCommandFailure(error),
        }),
    });
    app
      .use(i18n)
      .use(vuetify)
      .use(router)
      .use(query)
      .provide(ENGINE_KEY, engine)
      .provide(EXTENSION_ENGINE_KEY, engine)
      .provide(EXTENSION_APPS_KEY, extensionApps)
      .provide(CONTRIBUTIONS_KEY, contributions.contributions)
      .provide(EXTENSION_UPDATES_KEY, extensionUpdates)
      .provide(THEME_SELECTION_KEY, themeSelection)
      .provide(LOCALE_SELECTION_KEY, localeSelection)
      .provide(COURSE_SCOPE_KEY, courseScope)
      .provide(COURSE_UPDATES_KEY, courseUpdates)
      .provide(COMMAND_REGISTRY_KEY, registry)
      .provide(COMMAND_PALETTE_KEY, palette)
      .provide(EXTENSION_CLIENTS_KEY, clients)
      .provide(EXTENSION_COMMANDS_KEY, extensionCommands)
      .provide(EXTENSION_WHEN_KEY, extensionWhen)
      .provide(EXTENSION_TRANSFERS_KEY, extensionTransfers)
      .provide(INSTALL_KEY, install)
      .provide(CONTEXT_KEYS_KEY, contextKeys)
      .provide(KEYBINDINGS_KEY, keybindings)
      .provide(ONBOARDING_TOUR_KEY, onboardingTour);
    app.mount('#app');
    // компоненты расширений в DOM окна: после монтирования, чтобы цели уже были на месте
    const injections = createInjectionMounter({ app, clients });
    window.addEventListener('pagehide', () => injections.dispose(), {
      once: true,
    });
    // подписка после монтирования: ссылка, принятая до загрузки окна, приходит сразу
    window.dolphy.deepLink.onInstall(({ id }) => void installLinks.handle(id));
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
