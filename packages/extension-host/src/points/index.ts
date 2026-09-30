import { exerciseTypes } from './exercise-types.ts';
import { gradePolicies } from './grade-policies.ts';
import { markdownRenderers } from './markdown-renderers.ts';
import { themes } from './themes.ts';
import type { ContributionPoint, PointKey } from './types.ts';

/** Реестр точек вклада: порядок значим для диагностики и разбора. */
export const CONTRIBUTION_POINTS: readonly ContributionPoint[] = [
  exerciseTypes,
  themes,
  markdownRenderers,
  gradePolicies,
] as readonly ContributionPoint[];

export const POINT_KEYS: readonly PointKey[] = CONTRIBUTION_POINTS.map(
  ({ key }) => key,
);

export type * from './types.ts';
