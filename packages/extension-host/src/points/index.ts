import { commands } from './commands.ts';
import { exerciseTypes } from './exercise-types.ts';
import { events } from './events.ts';
import { exporters } from './exporters.ts';
import { gradePolicies } from './grade-policies.ts';
import { importers } from './importers.ts';
import { markdownRenderers } from './markdown-renderers.ts';
import { panels } from './panels.ts';
import { settings } from './settings.ts';
import { themes } from './themes.ts';
import { widgets } from './widgets.ts';
import type { ContributionPoint, PointKey } from './types.ts';

/** Реестр точек вклада: порядок значим для диагностики и разбора. */
export const CONTRIBUTION_POINTS: readonly ContributionPoint[] = [
  exerciseTypes,
  themes,
  markdownRenderers,
  gradePolicies,
  settings,
  events,
  commands,
  panels,
  widgets,
  importers,
  exporters,
] as readonly ContributionPoint[];

export const POINT_KEYS: readonly PointKey[] = CONTRIBUTION_POINTS.map(
  ({ key }) => key,
);

export type * from './types.ts';
