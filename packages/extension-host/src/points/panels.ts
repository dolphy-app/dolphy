import {
  DEFAULT_PANEL,
  EXTENSION_COMMAND_LIMITS,
} from '@dolphy-app/extension-api';
import { z } from 'zod';
import {
  duplicateIssues,
  extensionId,
  idPrefixIssues,
  resolveModuleUrl,
  safePath,
} from './support.ts';
import type { ContributionPoint } from './types.ts';

const { panels: MAX_PANELS } = EXTENSION_COMMAND_LIMITS;

export const panels: ContributionPoint<'panels'> = {
  key: 'panels',
  needsMain: false,
  schema: z.strictObject({
    id: extensionId,
    title: z.string().min(1).max(EXTENSION_COMMAND_LIMITS.titleLength),
    module: safePath(['.js', '.mjs']).optional(),
  }),
  normalize: (entries) =>
    entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      module: entry.module ?? DEFAULT_PANEL,
    })),
  check: (entries, owner) => {
    const ids = entries.map(({ id }) => id);
    return [
      ...(entries.length > MAX_PANELS
        ? [`contributes.panels: at most ${MAX_PANELS} panels allowed`]
        : []),
      ...idPrefixIssues('panels', ids, owner),
      ...duplicateIssues('contributes.panels', 'id', ids),
    ];
  },
  resolve: async (entries, { dir, extensionId: owner, verifyFiles }) => {
    const resolved = [];
    for (const entry of entries) {
      resolved.push({
        id: entry.id,
        title: entry.title,
        rendererUrl: await resolveModuleUrl(
          owner,
          dir,
          entry.module,
          DEFAULT_PANEL,
          verifyFiles,
          'panel module',
        ),
      });
    }
    return resolved;
  },
  claims: (resolved) => resolved.map((panel) => `panel:${panel.id}`),
};
