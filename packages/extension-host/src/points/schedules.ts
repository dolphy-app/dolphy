import {
  DEFAULT_SCHEDULE_AT,
  EXTENSION_SCHEDULE_LIMITS,
  SCHEDULE_AT_PATTERN,
} from '@dolphy-app/extension-api';
import { z } from 'zod';
import { duplicateIssues, extensionId, idPrefixIssues } from './support.ts';
import type { ContributionPoint } from './types.ts';

const { schedules: MAX_SCHEDULES } = EXTENSION_SCHEDULE_LIMITS;

export const schedules: ContributionPoint<'schedules'> = {
  key: 'schedules',
  needsMain: true,
  schema: z.discriminatedUnion('every', [
    z.strictObject({
      id: extensionId,
      every: z.literal('daily'),
      at: z
        .string()
        .regex(SCHEDULE_AT_PATTERN, "must be a time such as '09:00'")
        .optional(),
    }),
    z.strictObject({ id: extensionId, every: z.literal('hourly') }),
  ]),
  normalize: (entries) =>
    entries.map((entry) =>
      entry.every === 'daily'
        ? { id: entry.id, every: 'daily', at: entry.at ?? DEFAULT_SCHEDULE_AT }
        : { id: entry.id, every: 'hourly' },
    ),
  check: (entries, owner) => {
    const ids = entries.map(({ id }) => id);
    return [
      ...(entries.length > MAX_SCHEDULES
        ? [`contributes.schedules: at most ${MAX_SCHEDULES} schedules allowed`]
        : []),
      ...idPrefixIssues('schedules', ids, owner),
      ...duplicateIssues('contributes.schedules', 'id', ids),
    ];
  },
  resolve: async (entries) =>
    entries.map((entry) => ({
      id: entry.id,
      every: entry.every,
      at: entry.every === 'daily' ? entry.at : null,
    })),
  claims: (resolved) => resolved.map((schedule) => `schedule:${schedule.id}`),
};
