import {
  DEFAULT_EXTENSION_ICON,
  EXTENSION_COMMAND_LIMITS,
  EXTENSION_ICONS,
} from '@dolphy-app/extension-api';
import type {
  CommandRegistration,
  RegisteredCommand,
} from '@dolphy-app/extension-api';
import { validateBinding } from '@dolphy-app/keybindings';
import type { BindingProblem } from '@dolphy-app/keybindings';
import { z } from 'zod';
import {
  RegistrationError,
  functionField,
  idField,
  localizedField,
  ownIdIssue,
  parseRegistration,
  whenField,
  whenProblem,
} from './registrar-support.ts';

const PLATFORMS = ['mac', 'windows', 'linux'] as const;

const keyText = z.string().min(1);

const schema = z.strictObject({
  id: idField,
  title: localizedField(EXTENSION_COMMAND_LIMITS.titleLength),
  description: localizedField(
    EXTENSION_COMMAND_LIMITS.descriptionLength,
  ).optional(),
  category: localizedField(EXTENSION_COMMAND_LIMITS.categoryLength).optional(),
  keybindings: z
    .array(
      z.strictObject({
        key: keyText,
        mac: keyText.optional(),
        windows: keyText.optional(),
        linux: keyText.optional(),
        when: whenField.optional(),
      }),
    )
    .max(EXTENSION_COMMAND_LIMITS.keybindingsPerCommand)
    .optional(),
  palette: z.boolean().optional(),
  when: whenField.optional(),
  icon: z.enum(EXTENSION_ICONS).optional(),
  run: functionField,
});

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

const bindingIssues = (command: z.output<typeof schema>): string[] => {
  const { keybindings = [] } = command;
  const issues: string[] = [];
  const seen = new Set<string>();
  keybindings.forEach((binding, position) => {
    const path = `keybindings.${position}`;
    const when = binding.when ?? null;
    issues.push(...keyIssues(path, 'key', binding.key, when, true));
    for (const platform of PLATFORMS) {
      const override = binding[platform];
      if (override === undefined) continue;
      issues.push(...keyIssues(path, platform, override, when, false));
    }
    const identity = `${binding.key.trim()}\u0000${when?.trim() ?? ''}`;
    if (seen.has(identity)) {
      issues.push(`${path}.key: duplicate binding '${binding.key}'`);
    }
    seen.add(identity);
  });
  if (keybindings.length > 0 && command.palette === false) {
    issues.push('palette: keybindings need palette: true');
  }
  return issues;
};

/** Проверяет `CommandRegistration` и возвращает метаданные в нормализованном виде. */
export const registerCommandMetadata = (
  reg: CommandRegistration,
  owner: string,
): RegisteredCommand => {
  const command = parseRegistration('command', schema, reg);
  const whenIssue =
    command.when === undefined ? null : whenProblem(command.when);
  const issues = [
    ...ownIdIssue(command.id, owner),
    ...bindingIssues(command),
    ...(whenIssue === null ? [] : [`when: ${whenIssue}`]),
  ];
  if (issues.length > 0) {
    throw new RegistrationError('command', command.id, issues);
  }
  return {
    id: command.id,
    title: command.title,
    description: command.description ?? null,
    category: command.category ?? null,
    palette: command.palette ?? true,
    icon: command.icon ?? DEFAULT_EXTENSION_ICON,
    keybindings: (command.keybindings ?? []).map((binding) => ({
      key: binding.key,
      mac: binding.mac ?? null,
      windows: binding.windows ?? null,
      linux: binding.linux ?? null,
      when: binding.when ?? null,
    })),
    when: command.when ?? null,
  };
};
