import {
  EXTENSION_COMMAND_LIMITS,
  EXTENSION_TRANSFER_LIMITS,
  TRANSFER_ACCEPT_PATTERN,
} from '@dolphy-app/extension-api';
import { z } from 'zod';
import { duplicateIssues, extensionId, idPrefixIssues } from './support.ts';
import type { ContributionPoint } from './types.ts';

const { importers: MAX_IMPORTERS, acceptExtensions: MAX_ACCEPT } =
  EXTENSION_TRANSFER_LIMITS;

export const importers: ContributionPoint<'importers'> = {
  key: 'importers',
  needsMain: true,
  schema: z.strictObject({
    id: extensionId,
    title: z.string().min(1).max(EXTENSION_COMMAND_LIMITS.titleLength),
    accept: z
      .array(
        z
          .string()
          .regex(
            TRANSFER_ACCEPT_PATTERN,
            "must be a lower-case file extension such as '.csv'",
          ),
      )
      .min(1)
      .max(MAX_ACCEPT),
    input: z.enum(['text', 'bytes']).optional(),
  }),
  normalize: (entries) =>
    entries.map((entry) => ({ ...entry, input: entry.input ?? 'text' })),
  check: (entries, owner) => {
    const ids = entries.map(({ id }) => id);
    return [
      ...(entries.length > MAX_IMPORTERS
        ? [`contributes.importers: at most ${MAX_IMPORTERS} importers allowed`]
        : []),
      ...idPrefixIssues('importers', ids, owner),
      ...duplicateIssues('contributes.importers', 'id', ids),
      ...entries.flatMap((entry, index) =>
        entry.accept.flatMap((extension, position) =>
          entry.accept.indexOf(extension) === position
            ? []
            : [
                `contributes.importers.${index}.accept.${position}: duplicate extension '${extension}'`,
              ],
        ),
      ),
    ];
  },
  resolve: async (entries) =>
    entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      accept: [...entry.accept],
      input: entry.input,
    })),
  claims: (resolved) => resolved.map((importer) => `importer:${importer.id}`),
};
