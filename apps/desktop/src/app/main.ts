import { createApp } from 'vue';
import { EngineCallError } from '@spirula/engine-rpc/client';
import App from './App.vue';
import { createSpirulaI18n } from './providers/i18n.ts';
import { createSpirulaVuetify } from './providers/vuetify.ts';
import { router } from './router';
import StartupError from './startup-error/StartupError.vue';
import { COURSE_SCOPE_KEY, createCourseScope } from '@/features/course-scope';
import {
  CONTRIBUTIONS_KEY,
  connectEngine,
  ENGINE_KEY,
  loadContributions,
} from '@/shared/api/engine';
import { resolveLocale } from '@/shared/i18n';

import './styles/global.css';

// движок недоступен — настроек из БД нет: язык системы, тема системы
const showStartupError = (error: unknown) => {
  const incompatible =
    error instanceof EngineCallError && error.code === 'INCOMPATIBLE_CONTRACT';
  const i18n = createSpirulaI18n(resolveLocale('system', navigator.language));
  createApp(StartupError, {
    kind: incompatible ? 'update' : 'failed',
    message: error instanceof Error ? error.message : String(error),
  })
    .use(i18n)
    .use(createSpirulaVuetify('system', i18n))
    .mount('#app');
};

const bootstrap = async () => {
  const smoke = __SPIRULA_SMOKE_BUILD__ ? window.spirula.smoke : undefined;
  try {
    const engine = await connectEngine(); // UI монтируется после рукопожатия
    const [{ theme, locale }, contributions] = await Promise.all([
      engine.settings.getUi(),
      loadContributions(engine),
    ]);
    const i18n = createSpirulaI18n(resolveLocale(locale, navigator.language));
    const courseScope = await createCourseScope(engine);
    createApp(App)
      .use(i18n)
      .use(createSpirulaVuetify(theme, i18n, contributions.themes))
      .use(router)
      .provide(ENGINE_KEY, engine)
      .provide(CONTRIBUTIONS_KEY, contributions)
      .provide(COURSE_SCOPE_KEY, courseScope)
      .mount('#app');
    if (__SPIRULA_SMOKE_BUILD__ && smoke) {
      const { runSmoke } = await import('./smoke/run-smoke.ts');
      smoke.report(await runSmoke(engine, smoke));
    }
  } catch (error) {
    showStartupError(error);
    if (__SPIRULA_SMOKE_BUILD__)
      smoke?.report({ ok: false, error: String(error) });
  }
};

void bootstrap();
