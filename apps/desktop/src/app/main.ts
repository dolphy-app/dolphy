import { createApp } from 'vue';
import { EngineCallError } from '@lms/engine-rpc/client';
import App from './App.vue';
import { createLmsI18n } from './providers/i18n.ts';
import { createLmsVuetify } from './providers/vuetify.ts';
import { router } from './router';
import StartupError from './startup-error/StartupError.vue';
import { connectEngine, ENGINE_KEY } from '@/shared/api/engine';
import { resolveLocale } from '@/shared/i18n';

import './styles/global.css';

// движок недоступен — настроек из БД нет: язык системы, тема системы
const showStartupError = (error: unknown) => {
  const incompatible =
    error instanceof EngineCallError && error.code === 'INCOMPATIBLE_CONTRACT';
  const i18n = createLmsI18n(resolveLocale('system', navigator.language));
  createApp(StartupError, {
    kind: incompatible ? 'update' : 'failed',
    message: error instanceof Error ? error.message : String(error),
  })
    .use(i18n)
    .use(createLmsVuetify('system', i18n))
    .mount('#app');
};

const bootstrap = async () => {
  const smoke = __LMS_SMOKE_BUILD__ ? window.lms.smoke : undefined;
  try {
    const engine = await connectEngine(); // UI монтируется после рукопожатия
    const { theme, locale } = await engine.settings.getUi();
    const i18n = createLmsI18n(resolveLocale(locale, navigator.language));
    createApp(App)
      .use(i18n)
      .use(createLmsVuetify(theme, i18n))
      .use(router)
      .provide(ENGINE_KEY, engine)
      .mount('#app');
    if (__LMS_SMOKE_BUILD__ && smoke) {
      const { runSmoke } = await import('./smoke/run-smoke.ts');
      smoke.report(await runSmoke(engine, smoke));
    }
  } catch (error) {
    showStartupError(error);
    if (__LMS_SMOKE_BUILD__) smoke?.report({ ok: false, error: String(error) });
  }
};

void bootstrap();
