import * as vue from 'vue';

type HostLoader = () => Promise<unknown>;

/**
 * Модули, которые окно отдаёт расширениям: расширение не везёт свои копии
 * `vue` и `vuetify`, а берёт у приложения (общая тема, язык, реактивность).
 * Имена совпадают с `HOST_MODULES` из `@dolphy-app/extension-tools`; `vue`
 * уже в стартовом чанке, Vuetify грузится по первому обращению.
 */
export const HOST_LOADERS: Readonly<Record<string, HostLoader>> = {
  vue: () => Promise.resolve(vue),
  vuetify: () => import('vuetify'),
  'vuetify/components': () => import('vuetify/components'),
  'vuetify/directives': () => import('vuetify/directives'),
};

export interface DolphyHost {
  require(name: string): Promise<unknown>;
}

declare global {
  var __dolphy: DolphyHost | undefined;
}

const requireHostModule = (name: string): Promise<unknown> => {
  const load = Object.hasOwn(HOST_LOADERS, name) ? HOST_LOADERS[name] : null;
  return load
    ? load()
    : Promise.reject(new Error(`unknown host module: ${name}`));
};

/** Ставит `globalThis.__dolphy` до загрузки любого модуля расширения. */
export const installHostModules = (): void => {
  globalThis.__dolphy = { require: requireHostModule };
};
