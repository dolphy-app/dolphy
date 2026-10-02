import type {
  JsonValue,
  NotifyEffect,
  OpenPanelEffect,
} from '@dolphy-app/extension-api';

/** Результат команды: приложение покажет уведомление (текст 1–500 символов, как есть, без разметки). */
export const notify = (text: string): NotifyEffect => ({ notify: text });

/** Результат команды: приложение откроет панель этого расширения; `props` попадут в `ctx.props` панели. */
export const openPanel = (
  panelId: string,
  props?: JsonValue,
): OpenPanelEffect =>
  props === undefined ? { openPanel: panelId } : { openPanel: panelId, props };
