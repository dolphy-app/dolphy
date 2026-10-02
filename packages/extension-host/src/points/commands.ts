import {
  EXTENSION_COMMAND_LIMITS,
  KEYBINDING_PATTERN,
} from '@dolphy-app/extension-api';
import { z } from 'zod';
import { duplicateIssues, extensionId, idPrefixIssues } from './support.ts';
import type { ContributionPoint } from './types.ts';

const { commands: MAX_COMMANDS } = EXTENSION_COMMAND_LIMITS;

export const commands: ContributionPoint<'commands'> = {
  key: 'commands',
  needsMain: true,
  // ключ `when` зарезервирован: strictObject отклоняет его как неизвестный
  schema: z.strictObject({
    id: extensionId,
    title: z.string().min(1).max(EXTENSION_COMMAND_LIMITS.titleLength),
    description: z
      .string()
      .min(1)
      .max(EXTENSION_COMMAND_LIMITS.descriptionLength)
      .optional(),
    category: z
      .string()
      .min(1)
      .max(EXTENSION_COMMAND_LIMITS.categoryLength)
      .optional(),
    keybinding: z
      .string()
      .regex(KEYBINDING_PATTERN, 'must look like Mod+Shift+L')
      .optional(),
    palette: z.boolean().optional(),
  }),
  normalize: (entries) =>
    entries.map((entry) => ({ ...entry, palette: entry.palette ?? true })),
  check: (entries, owner) => {
    const ids = entries.map(({ id }) => id);
    return [
      ...(entries.length > MAX_COMMANDS
        ? [`contributes.commands: at most ${MAX_COMMANDS} commands allowed`]
        : []),
      ...idPrefixIssues('commands', ids, owner),
      ...duplicateIssues('contributes.commands', 'id', ids),
    ];
  },
  resolve: async (entries) =>
    entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      description: entry.description ?? null,
      category: entry.category ?? null,
      keybinding: entry.keybinding ?? null,
      palette: entry.palette,
    })),
  claims: (resolved) => resolved.map((command) => `command:${command.id}`),
};
