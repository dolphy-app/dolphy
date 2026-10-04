import { buildKeymap } from './keymap.ts';
import type { UserBindingEntry, UserKeybindings } from './keymap.ts';
import { strokeKey, tryParseChord } from './keystroke.ts';
import type { Platform } from './platform.ts';
import { tryParseWhen, whenToText } from './when.ts';
import { validateBinding } from './validate.ts';

export const KEYBINDING_LIMITS = {
  commands: 512,
  entriesPerCommand: 8,
  commandLength: 200,
} as const;

/** Ключ команды в реестре окна: `app:<id>` или `extension:<extensionId>:<id>`. */
export const COMMAND_KEY_PATTERN = /^(app|extension):[A-Za-z0-9._:-]+$/;

export type UserIssueReason =
  'syntax' | 'typing' | 'conflict' | 'limit' | 'duplicate';

export interface UserIssue {
  readonly reason: UserIssueReason;
  /** Путь к полю: `commands`, `commands.<ключ>`, `commands.<ключ>[0].key`. */
  readonly field: string;
  readonly command: string;
  /** Вторая команда при `conflict`. */
  readonly other?: string;
  readonly message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const decodeEntry = (value: unknown): UserBindingEntry | null => {
  if (!isRecord(value) || typeof value.key !== 'string') return null;
  const when = value.when ?? null;
  if (when !== null && typeof when !== 'string') return null;
  return { key: value.key, when };
};

/**
 * Хранимое значение → пользовательские привязки. Терпимо к мусору: команды с
 * неверным ключом или не массивом и записи неверной формы отбрасываются,
 * лишнее сверх лимитов обрезается; разбор клавиш и условий — дело карты и
 * `validateUserKeybindings`.
 */
export const decodeUserKeybindings = (raw: unknown): UserKeybindings => {
  const result: Record<string, UserBindingEntry[]> = {};
  if (!isRecord(raw) || !isRecord(raw.commands)) return result;
  for (const [command, entries] of Object.entries(raw.commands)) {
    if (Object.keys(result).length >= KEYBINDING_LIMITS.commands) break;
    const valid =
      command.length <= KEYBINDING_LIMITS.commandLength &&
      COMMAND_KEY_PATTERN.test(command);
    if (!valid || !Array.isArray(entries)) continue;
    result[command] = entries
      .map(decodeEntry)
      .filter((entry) => entry !== null)
      .slice(0, KEYBINDING_LIMITS.entriesPerCommand);
  }
  return result;
};

const keyIdentity = (entry: UserBindingEntry, platform: Platform): string => {
  const chord = tryParseChord(entry.key, platform);
  const when = entry.when === null ? null : tryParseWhen(entry.when);
  return `${chord?.map(strokeKey).join(' ') ?? entry.key}|${
    when === null ? '' : whenToText(when)
  }`;
};

/**
 * Проверка набора пользователя на платформе хоста: лимиты, форма ключей
 * команд, клавиши и условия (`validateBinding`), повтор «клавиши + условие»
 * в одной команде и пересечения привязок разных команд. Пустой список — набор
 * верен.
 */
export const validateUserKeybindings = (
  user: UserKeybindings,
  platform: Platform,
): UserIssue[] => {
  const issues: UserIssue[] = [];
  const commands = Object.entries(user);
  if (commands.length > KEYBINDING_LIMITS.commands) {
    issues.push({
      reason: 'limit',
      field: 'commands',
      command: '',
      message: `at most ${KEYBINDING_LIMITS.commands} commands`,
    });
  }
  const valid: Record<string, UserBindingEntry[]> = {};
  for (const [command, entries] of commands) {
    const field = `commands.${command}`;
    if (
      command.length > KEYBINDING_LIMITS.commandLength ||
      !COMMAND_KEY_PATTERN.test(command)
    ) {
      issues.push({
        reason:
          command.length > KEYBINDING_LIMITS.commandLength ? 'limit' : 'syntax',
        field,
        command,
        message: 'invalid command key',
      });
      continue;
    }
    if (entries.length > KEYBINDING_LIMITS.entriesPerCommand) {
      issues.push({
        reason: 'limit',
        field,
        command,
        message: `at most ${KEYBINDING_LIMITS.entriesPerCommand} bindings per command`,
      });
    }
    const seen = new Set<string>();
    const accepted: UserBindingEntry[] = [];
    entries.forEach((entry, index) => {
      const problem = validateBinding(entry, [platform]);
      if (problem !== null) {
        issues.push({
          reason: problem.reason,
          field: `${field}[${index}].${problem.field}`,
          command,
          message: `${problem.field}: ${problem.detail}`,
        });
        return;
      }
      const identity = keyIdentity(entry, platform);
      if (seen.has(identity)) {
        issues.push({
          reason: 'duplicate',
          field: `${field}[${index}]`,
          command,
          message: 'the same key and condition are listed twice',
        });
        return;
      }
      seen.add(identity);
      accepted.push(entry);
    });
    valid[command] = accepted;
  }
  const keymap = buildKeymap({
    platform,
    defaults: [],
    extensions: [],
    user: valid,
  });
  for (const { winner, loser } of keymap.conflicts()) {
    issues.push({
      reason: 'conflict',
      field: `commands.${loser.command}`,
      command: loser.command,
      other: winner.command,
      message: `${loser.text} overlaps ${winner.text} of ${winner.command}`,
    });
  }
  return issues;
};
