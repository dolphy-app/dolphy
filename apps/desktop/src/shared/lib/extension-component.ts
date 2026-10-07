import type { Component } from 'vue';
import type { ExtensionClientModule } from '@dolphy-app/extension-api';
import { moduleUrlOf } from './extension-url.ts';

export type LoadExtensionModule = (url: string) => Promise<unknown>;

export const importExtensionModule: LoadExtensionModule = (url) =>
  import(/* @vite-ignore */ url);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Компонент расширения: `default[table][id]` из его браузерного модуля.
 * Форму самого компонента проверяет рендер, здесь — что он есть.
 */
export const loadExtensionComponent = async (
  source: { rendererUrl: string; revision: string },
  table: keyof ExtensionClientModule,
  id: string,
  loadModule: LoadExtensionModule,
): Promise<Component> => {
  const module = await loadModule(moduleUrlOf(source));
  const tables = isRecord(module) ? module['default'] : undefined;
  const components = isRecord(tables) ? tables[table] : undefined;
  const component = isRecord(components) ? components[id] : undefined;
  if (
    component === undefined ||
    component === null ||
    (typeof component !== 'object' && typeof component !== 'function')
  ) {
    throw new Error(`module has no ${table} component '${id}'`);
  }
  // компонент автор отдаёт как Vue-компонент
  return component as Component;
};
