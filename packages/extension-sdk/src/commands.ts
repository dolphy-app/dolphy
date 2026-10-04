import type {
  JsonValue,
  NotifyEffect,
  OpenPanelEffect,
} from '@dolphy-app/extension-api';
import type { ResolvedIds } from './ids.ts';

/** A command result: the app shows a notification (1–500 characters, as is, no markup). */
export const notify = (text: string): NotifyEffect => ({ notify: text });

/** A command result: the app opens a panel of this extension (a declared panel id); `props` reach the panel as `ctx.props`. */
export const openPanel = (
  panelId: ResolvedIds['panels'],
  props?: JsonValue,
): OpenPanelEffect =>
  props === undefined ? { openPanel: panelId } : { openPanel: panelId, props };
