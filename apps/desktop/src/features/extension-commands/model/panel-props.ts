import { shallowReactive } from 'vue';
import type { JsonValue } from '@dolphy-app/extension-api';

export const panelKey = (extensionId: string, panelId: string): string =>
  `${extensionId}:${panelId}`;

/**
 * Свойства открытой панели, присланные `openPanel(id, props)`. Реактивны:
 * повторный `openPanel` на уже открытую панель обновляет её без пересоздания
 * рамки. Страница панели убирает запись, когда закрывается.
 */
export interface PanelProps {
  get(key: string): JsonValue | undefined;
  set(key: string, props: JsonValue | undefined): void;
  clear(key: string): void;
}

export const createPanelProps = (): PanelProps => {
  const byKey = shallowReactive(new Map<string, JsonValue | undefined>());
  return {
    get: (key) => byKey.get(key),
    set: (key, props) => {
      byKey.set(key, props);
    },
    clear: (key) => {
      byKey.delete(key);
    },
  };
};
