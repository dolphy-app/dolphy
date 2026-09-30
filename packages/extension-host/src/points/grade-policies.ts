import { z } from 'zod';
import { extensionId, idPrefixIssues } from './support.ts';
import type { ContributionPoint } from './types.ts';

const BUILTIN_POLICY_ID = 'passAtN';

export const gradePolicies: ContributionPoint<'gradePolicies'> = {
  key: 'gradePolicies',
  needsMain: true,
  schema: z.strictObject({
    id: extensionId.refine(
      (id) => id !== BUILTIN_POLICY_ID,
      `id '${BUILTIN_POLICY_ID}' is reserved for the built-in policy`,
    ),
    label: z.string().min(1).max(60),
  }),
  normalize: (entries) => entries,
  check: (entries, owner) =>
    idPrefixIssues(
      'gradePolicies',
      entries.map(({ id }) => id),
      owner,
    ),
  resolve: async (entries) => entries.map(({ id, label }) => ({ id, label })),
  claims: (resolved) => resolved.map((policy) => `gradePolicy:${policy.id}`),
};
