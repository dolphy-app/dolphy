import {
  EXTENSION_COMMAND_LIMITS,
  EXTENSION_TRANSFER_LIMITS,
} from '@dolphy-app/extension-api';
import { z } from 'zod';
import { duplicateIssues, extensionId, idPrefixIssues } from './support.ts';
import type { ContributionPoint } from './types.ts';

const { exporters: MAX_EXPORTERS } = EXTENSION_TRANSFER_LIMITS;

export const exporters: ContributionPoint<'exporters'> = {
  key: 'exporters',
  needsMain: true,
  schema: z.strictObject({
    id: extensionId,
    title: z.string().min(1).max(EXTENSION_COMMAND_LIMITS.titleLength),
    scope: z.enum(['course', 'progress']),
  }),
  normalize: (entries) => entries.map((entry) => ({ ...entry })),
  check: (entries, owner) => {
    const ids = entries.map(({ id }) => id);
    return [
      ...(entries.length > MAX_EXPORTERS
        ? [`contributes.exporters: at most ${MAX_EXPORTERS} exporters allowed`]
        : []),
      ...idPrefixIssues('exporters', ids, owner),
      ...duplicateIssues('contributes.exporters', 'id', ids),
    ];
  },
  resolve: async (entries) =>
    entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      scope: entry.scope,
    })),
  claims: (resolved) => resolved.map((exporter) => `exporter:${exporter.id}`),
};
