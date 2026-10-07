import type {
  JsonValue,
  NotifyEffect,
  OpenPanelEffect,
} from '@dolphy-app/extension-api';

/** A command result: the app shows a notification (1–500 characters, as is, no markup). */
export const notify = (text: string): NotifyEffect => ({ notify: text });

/** A command result: the app opens a panel of this extension (a panel id of `client.addPanel`); `props` reach the panel as `usePanel().props`. */
export const openPanel = (
  panelId: string,
  props?: JsonValue,
): OpenPanelEffect =>
  props === undefined ? { openPanel: panelId } : { openPanel: panelId, props };
