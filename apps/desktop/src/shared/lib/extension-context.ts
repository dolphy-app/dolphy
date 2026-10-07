import { inject, provide } from 'vue';
import type { InjectionKey } from 'vue';
import { APP_KEY, EXTENSION_ID_KEY } from '@dolphy-app/extension-api';
import type { AppApi } from '@dolphy-app/extension-api';

export interface ExtensionApps {
  /** `AppApi` для компонентов и клиентской части расширения; один объект на расширение. */
  of(extensionId: string): AppApi;
}

export const EXTENSION_APPS_KEY: InjectionKey<ExtensionApps> =
  Symbol('extension-apps');

/**
 * Оболочка компонента расширения (панель, вид ответа, вставка, рендерер
 * markdown) отдаёт ему id расширения и его `AppApi`: `useRpc`, `useApp` и
 * `mountAt` знают, чьим расширением пользуются.
 */
export const provideExtensionContext = (extensionId: string): void => {
  const apps = inject(EXTENSION_APPS_KEY);
  if (!apps) throw new Error('extension apps are not provided');
  provide(EXTENSION_ID_KEY, extensionId);
  provide(APP_KEY, apps.of(extensionId));
};
