import { LEARNING_EVENT_NAMES } from '@dolphy-app/extension-api';
import { z } from 'zod';
import { duplicateIssues } from './support.ts';
import type { ContributionPoint } from './types.ts';

export const events: ContributionPoint<'events'> = {
  key: 'events',
  needsMain: true,
  schema: z.strictObject({ event: z.enum(LEARNING_EVENT_NAMES) }),
  normalize: (entries) => entries,
  check: (entries) =>
    duplicateIssues(
      'contributes.events',
      'event',
      entries.map(({ event }) => event),
    ),
  resolve: async (entries) => entries.map(({ event }) => ({ event })),
  // подписка на событие не уникальна: её могут объявить несколько расширений
  claims: () => [],
};
