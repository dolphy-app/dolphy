import {
  DEFAULT_EXTENSION_ICON,
  EXTENSION_COMMAND_LIMITS,
  EXTENSION_ICONS,
  KEYBINDING_PATTERN,
} from '@dolphy-app/extension-api';
import { validateBinding } from '@dolphy-app/keybindings';
import type { BindingProblem } from '@dolphy-app/keybindings';
import { z } from 'zod';
import type { CommandContribution } from '@dolphy-app/extension-api';
import {
  duplicateIssues,
  extensionId,
  idPrefixIssues,
  whenField,
  whenIssues,
} from './support.ts';
import type { ContributionPoint } from './types.ts';

const { commands: MAX_COMMANDS, keybindingsPerCommand: MAX_KEYBINDINGS } =
  EXTENSION_COMMAND_LIMITS;

const PLATFORMS = ['mac', 'windows', 'linux'] as const;

const keyText = z.string().min(1);

/** Описание проблемы привязки для сообщения манифеста. */
const problemText = (problem: BindingProblem): string => {
  if (problem.reason === 'typing') {
    return 'a key that types text needs a "when" inactive while inputFocus (for example "!inputFocus")';
  }
  if (problem.field === 'when') {
    return `invalid "when" (${problem.detail} at ${problem.position})`;
  }
  return `invalid key (${problem.detail}); it must be valid on mac, windows and linux`;
};

/** Проблемы одной строки клавиш: поле `field` записи, `when` — условие записи. */
const keyIssues = (
  path: string,
  field: string,
  key: string,
  when: string | null,
  reportWhen: boolean,
): string[] => {
  const problem = validateBinding({ key, when }, PLATFORMS);
  if (problem === null) return [];
  if (problem.field === 'when' && problem.reason === 'syntax' && !reportWhen) {
    return [];
  }
  const target = problem.field === 'when' && reportWhen ? 'when' : field;
  return [`${path}.${target}: ${problemText(problem)}`];
};

const bindingIssues = (entry: CommandContribution, index: number): string[] => {
  const base = `contributes.commands.${index}`;
  const { keybinding, keybindings = [] } = entry;
  const issues: string[] = [];
  const seen = new Set<string>();
  const remember = (path: string, key: string, when: string | null) => {
    const id = `${key.trim()}\u0000${when?.trim() ?? ''}`;
    if (seen.has(id)) {
      issues.push(`${path}: duplicate binding '${key}' in one command`);
    }
    seen.add(id);
  };
  if (keybinding !== undefined) {
    const path = `${base}.keybinding`;
    const problem = validateBinding({ key: keybinding, when: null }, PLATFORMS);
    if (problem !== null) issues.push(`${path}: ${problemText(problem)}`);
    remember(path, keybinding, null);
  }
  keybindings.forEach((binding, position) => {
    const path = `${base}.keybindings.${position}`;
    const when = binding.when ?? null;
    issues.push(...keyIssues(path, 'key', binding.key, when, true));
    for (const platform of PLATFORMS) {
      const override = binding[platform];
      if (override === undefined) continue;
      issues.push(...keyIssues(path, platform, override, when, false));
    }
    remember(`${path}.key`, binding.key, when);
  });
  const bound = keybinding !== undefined || keybindings.length > 0;
  if (bound && entry.palette === false) {
    issues.push(`${base}.palette: keybindings need palette: true`);
  }
  return issues;
};

export const commands: ContributionPoint<'commands'> = {
  key: 'commands',
  needsMain: true,
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
    keybindings: z
      .array(
        z.strictObject({
          key: keyText,
          mac: keyText.optional(),
          windows: keyText.optional(),
          linux: keyText.optional(),
          when: z
            .string()
            .min(1)
            .max(EXTENSION_COMMAND_LIMITS.whenLength)
            .optional(),
        }),
      )
      .max(MAX_KEYBINDINGS)
      .optional(),
    palette: z.boolean().optional(),
    // условие видимости команды; условия записей `keybindings` — отдельный язык пакета `@dolphy-app/keybindings`
    when: whenField.optional(),
    icon: z.enum(EXTENSION_ICONS).optional(),
  }),
  normalize: (entries) =>
    entries.map((entry) => ({
      ...entry,
      palette: entry.palette ?? true,
      icon: entry.icon ?? DEFAULT_EXTENSION_ICON,
    })),
  check: (entries, owner) => {
    const ids = entries.map(({ id }) => id);
    return [
      ...(entries.length > MAX_COMMANDS
        ? [`contributes.commands: at most ${MAX_COMMANDS} commands allowed`]
        : []),
      ...idPrefixIssues('commands', ids, owner),
      ...duplicateIssues('contributes.commands', 'id', ids),
      ...entries.flatMap(bindingIssues),
      ...entries.flatMap((entry, index) =>
        whenIssues('commands', index, entry.when),
      ),
    ];
  },
  resolve: async (entries) =>
    entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      description: entry.description ?? null,
      category: entry.category ?? null,
      keybinding: entry.keybinding ?? null,
      keybindings: (entry.keybindings ?? []).map((binding) => ({
        key: binding.key,
        mac: binding.mac ?? null,
        windows: binding.windows ?? null,
        linux: binding.linux ?? null,
        when: binding.when ?? null,
      })),
      palette: entry.palette,
      when: entry.when ?? null,
      icon: entry.icon,
    })),
  claims: (resolved) => resolved.map((command) => `command:${command.id}`),
};
