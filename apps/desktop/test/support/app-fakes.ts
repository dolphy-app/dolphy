import { vi } from 'vitest';
import { defineComponent, h, inject } from 'vue';
import type { ExtensionEngine } from '@dolphy-app/engine-contract';
import { APP_KEY, EXTENSION_ID_KEY } from '@dolphy-app/extension-api';
import type { AppApi } from '@dolphy-app/extension-api';
import type { ExtensionApps } from '@/shared/lib/extension-context.ts';

/** `AppApi` на шпионах; `patch` заменяет часть. */
export const fakeAppApi = (patch: Partial<AppApi> = {}): AppApi => ({
  openCourse: vi.fn(),
  openLesson: vi.fn(),
  openExercise: vi.fn(),
  openPanel: vi.fn(),
  openSettings: vi.fn(),
  notify: vi.fn(),
  theme: { id: 'light', dark: false },
  locale: 'en',
  runCommand: vi.fn(async () => {}),
  mountAt: vi.fn(() => ({ dispose: vi.fn() })),
  ...patch,
});

/** `ExtensionApps`: один `AppApi` на всех расширений, запросы `of` записываются. */
export const fakeApps = (api: AppApi = fakeAppApi()) => {
  const requested: string[] = [];
  const apps: ExtensionApps = {
    of: (extensionId) => {
      requested.push(extensionId);
      return api;
    },
  };
  return { apps, api, requested };
};

/** Движок, у которого нет ни одного метода: тест, которому он нужен, подставляет свой. */
export const fakeEngine = (patch: object = {}): ExtensionEngine =>
  patch as ExtensionEngine;

/** Что компонент расширения получил от оболочки окна. */
export interface ContextSeen {
  id?: unknown;
  app?: unknown;
}

/** Компонент, который записывает `EXTENSION_ID_KEY` и `APP_KEY` из своего контекста. */
export const contextProbe = (seen: ContextSeen) =>
  defineComponent({
    setup() {
      seen.id = inject(EXTENSION_ID_KEY, null);
      seen.app = inject(APP_KEY, null);
      return () => h('i', { 'data-testid': 'context-probe' });
    },
  });
