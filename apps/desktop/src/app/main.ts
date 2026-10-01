import { createApp } from 'vue';
import { EngineCallError } from '@dolphy-app/engine-rpc/client';
import App from './App.vue';
import { createDolphyI18n } from './providers/i18n.ts';
import { createDolphyVuetify } from './providers/vuetify.ts';
import { router } from './router';
import StartupError from './startup-error/StartupError.vue';
import { COURSE_SCOPE_KEY, createCourseScope } from '@/features/course-scope';
import {
  CONTRIBUTIONS_KEY,
  connectEngine,
  createContributionsStore,
  createThemeSelection,
  ENGINE_KEY,
  THEME_SELECTION_KEY,
} from '@/shared/api/engine';
import { resolveLocale } from '@/shared/i18n';
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
    bindExtensionThemes(
      vuetify.theme,
      themeSelection.saved,
      () => contributions.contributions.value.themes,
    );
    createApp(App)
      .use(i18n)
      .use(vuetify)
      .use(router)
      .provide(ENGINE_KEY, engine)
      .provide(CONTRIBUTIONS_KEY, contributions.contributions)
      .provide(THEME_SELECTION_KEY, themeSelection)
      .provide(COURSE_SCOPE_KEY, courseScope)
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
