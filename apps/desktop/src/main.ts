import { createApp } from 'vue';
import { EngineCallError } from '@lms/engine-rpc/client';
import App from './App.vue';
import StartupError from './components/StartupError.vue';
import { connectEngine } from './engine/connect.ts';
import { ENGINE_KEY } from './engine/keys.ts';

import './style.css';

const showStartupError = (error: unknown) => {
  const incompatible =
    error instanceof EngineCallError && error.code === 'INCOMPATIBLE_CONTRACT';
  createApp(StartupError, {
    kind: incompatible ? 'update' : 'failed',
    message: error instanceof Error ? error.message : String(error),
  }).mount('#app');
};

const bootstrap = async () => {
  const { smoke } = window.lms;
  try {
    const engine = await connectEngine(); // UI монтируется после рукопожатия
    createApp(App).provide(ENGINE_KEY, engine).mount('#app');
    if (smoke) {
      const { runSmoke } = await import('./engine/smoke.ts');
      smoke.report(await runSmoke(engine, smoke));
    }
  } catch (error) {
    showStartupError(error);
    smoke?.report({ ok: false, error: String(error) });
  }
};

void bootstrap();
