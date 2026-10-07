import type { App, Component } from 'vue';
import type { Router } from 'vue-router';
import { z } from 'zod';
import type { ExtensionApps } from './extension-context.ts';
import type {
  AppApi,
  AppLocale,
  AppNotifyKind,
  AppTheme,
  JsonValue,
} from '@dolphy-app/extension-api';
import { ROUTE } from '@/shared/config/routes.ts';
import type { CommandRegistry } from './command-registry.ts';
import { mountShell, unmountShell } from './extension-injections.ts';

export interface ExtensionAppDeps {
  /** Основное приложение: `mountAt` рисует с его контекстом. */
  app: App;
  router: Pick<Router, 'push'>;
  /** Реестр команд окна: `runCommand` вызывает команду тем же путём, что палитра. */
  registry: Pick<CommandRegistry, 'list'>;
  /** Ставит курс в фокус (выбор хранится в настройках движка). */
  focusCourse(courseId: string): Promise<void>;
  /** Открывает панель расширения; свойства попадают в `usePanel().props`. */
  openPanel(
    extensionId: string,
    panelId: string,
    props: JsonValue | undefined,
  ): void;
  notify(message: string, kind: AppNotifyKind): void;
  /** Действующая тема окна; читается реактивно. */
  theme: () => AppTheme;
  locale: () => AppLocale;
  /** Где `mountAt` ищет цель-селектор; по умолчанию документ окна. */
  root?: ParentNode;
}

const componentSchema = z.custom<Component>(
  (value) =>
    typeof value === 'function' ||
    (typeof value === 'object' && value !== null),
  'must be a Vue component',
);

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Возможности окна для расширений (`useApp()`): явный список поверх роутера,
 * реестра команд и уведомлений приложения. Страниц урока и упражнения в окне
 * нет: `openLesson` и `openExercise` открывают сессию курса.
 */
export const createExtensionApp = (deps: ExtensionAppDeps): ExtensionApps => {
  const { app, router, registry } = deps;
  const root = deps.root ?? document;
  const cache = new Map<string, AppApi>();

  const go = (extensionId: string, what: string, run: () => Promise<unknown>) =>
    void run().catch((error: unknown) =>
      console.error({ error, extensionId }, `app.${what} failed`),
    );

  const create = (extensionId: string): AppApi => {
    const openSession = (courseId: string) =>
      go(extensionId, 'openSession', () =>
        router.push({ name: ROUTE.session, query: { course: courseId } }),
      );
    return {
      openCourse: (courseId) =>
        go(extensionId, 'openCourse', async () => {
          await deps.focusCourse(courseId);
          await router.push({ name: ROUTE.courses });
        }),
      openLesson: (courseId) => openSession(courseId),
      openExercise: (courseId) => openSession(courseId),
      openPanel: (targetExtensionId, panelId, props) =>
        deps.openPanel(
          targetExtensionId,
          panelId,
          props === undefined ? undefined : z.json().parse(props),
        ),
      openSettings: (target) =>
        go(extensionId, 'openSettings', () =>
          router.push(
            target === undefined
              ? { name: ROUTE.settingsExtensions }
              : {
                  name: ROUTE.settingsExtensionDetails,
                  params: { id: target },
                },
          ),
        ),
      notify: (message, kind = 'info') => deps.notify(message, kind),
      get theme() {
        return deps.theme();
      },
      get locale() {
        return deps.locale();
      },
      runCommand: async (commandKey) => {
        const command = registry.list.value.find(
          ({ key }) => key === commandKey,
        );
        if (command === undefined) {
          throw new Error(`unknown command '${commandKey}'`);
        }
        if (!command.enabled) {
          throw new Error(`command '${commandKey}' is disabled`);
        }
        await command.run();
      },
      mountAt: (target, component, props) => {
        let element: Element | null;
        try {
          element =
            typeof target === 'string' ? root.querySelector(target) : target;
        } catch (error) {
          throw new Error(
            `mountAt: invalid target '${String(target)}' (${errorText(error)})`,
          );
        }
        if (element === null) {
          throw new Error(`mountAt: no element matches '${String(target)}'`);
        }
        const host = mountShell(
          app,
          element.ownerDocument,
          {
            extensionId,
            injectionId: 'mountAt',
            component: componentSchema.parse(component),
            componentProps: props,
            handle: { target: element, position: 'append' },
          },
          (placed) => element.append(placed),
        );
        let mounted = true;
        return {
          dispose: () => {
            if (!mounted) return;
            mounted = false;
            unmountShell(host);
          },
        };
      },
    };
  };

  return {
    of: (extensionId) => {
      let api = cache.get(extensionId);
      if (api === undefined) {
        api = create(extensionId);
        cache.set(extensionId, api);
      }
      return api;
    },
  };
};
