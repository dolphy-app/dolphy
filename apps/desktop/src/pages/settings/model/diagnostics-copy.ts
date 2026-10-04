import { onScopeDispose, ref } from 'vue';
import type { LearningEngine } from '@dolphy-app/engine-contract';
import type { AppInfo } from '../../../../shared/bridge.ts';
import { diagnosticsReport } from '../lib/diagnostics-report.ts';

export type DiagnosticsCopyState = 'idle' | 'copying' | 'copied' | 'failed';

/** Откуда берутся сведения о приложении и куда пишется текст; в тестах подменяется. */
export interface DiagnosticsCopyEnv {
  appInfo(): Promise<AppInfo>;
  writeText(text: string): Promise<void>;
}

/** Сколько показывается «Скопировано», затем кнопка возвращается в исходный вид. */
export const COPIED_MS = 3000;

const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

/**
 * «Скопировать диагностику»: собирает сведения движка и приложения, строит
 * отчёт чистой функцией и кладёт текст в буфер обмена. Отказ записи или
 * чтения сведений — состояние `failed` с текстом ошибки.
 */
export const useDiagnosticsCopy = (
  engine: LearningEngine,
  env: DiagnosticsCopyEnv,
) => {
  const state = ref<DiagnosticsCopyState>('idle');
  const error = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const copy = async () => {
    if (state.value === 'copying') return;
    clearTimeout(timer);
    state.value = 'copying';
    error.value = null;
    try {
      const [app, engineInfo, diagnostics, extensions] = await Promise.all([
        env.appInfo(),
        engine.diagnostics(),
        engine.extensions.diagnostics(),
        engine.extensions.list(),
      ]);
      await env.writeText(
        diagnosticsReport({
          app,
          engine: engineInfo,
          diagnostics,
          extensions,
        }),
      );
      state.value = 'copied';
      timer = setTimeout(() => {
        state.value = 'idle';
      }, COPIED_MS);
    } catch (caught) {
      error.value = errorText(caught);
      state.value = 'failed';
    }
  };

  onScopeDispose(() => clearTimeout(timer));
  return { state, error, copy };
};
