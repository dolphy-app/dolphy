import type { LocalizedText } from '@dolphy-app/extension-api';
import {
  EXTENSION_COMMAND_LIMITS,
  EXTENSION_ID_PATTERN,
  WhenError,
  parseWhen,
} from '@dolphy-app/extension-api';
import { z } from 'zod';

/** Идентификатор вклада: форма проверяется схемой, принадлежность расширению — `checkOwnId`. */
export const idField = z
  .string()
  .max(64)
  .regex(EXTENSION_ID_PATTERN, 'invalid id');

/** Подпись: строка или `{ en, ru? }`; каждый текст 1..`max` символов. */
export const localizedField = (max: number) => {
  const text = z.string().min(1).max(max);
  return z
    .union([text, z.strictObject({ en: text, ru: text.optional() })])
    .transform((value): LocalizedText => {
      if (typeof value === 'string') return value;
      return value.ru === undefined
        ? { en: value.en }
        : { en: value.en, ru: value.ru };
    });
};

/** Условие видимости: длина здесь, разбор — `whenProblem`. */
export const whenField = z
  .string()
  .min(1)
  .max(EXTENSION_COMMAND_LIMITS.whenLength);

/** Значение — функция (схема не копирует её, только проверяет тип). */
export const functionField = z.custom<(...args: never[]) => unknown>(
  (value) => typeof value === 'function',
  'must be a function',
);

/** Ошибка разбора условия `when` с позицией в тексте или `null`. */
export const whenProblem = (when: string): string | null => {
  try {
    parseWhen(when);
    return null;
  } catch (error) {
    if (!(error instanceof WhenError)) throw error;
    return `invalid "when" (${error.detail} at ${error.position})`;
  }
};

/** Нарушения схемы одной регистрации в виде `путь: сообщение`. */
export const schemaIssues = (error: z.ZodError): string[] =>
  error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });

/** Ошибка регистрации: `вид 'id': нарушение; нарушение`. Бросается из вызова `register*`, чтобы трасса вела в код автора. */
export class RegistrationError extends Error {
  constructor(kind: string, id: unknown, issues: readonly string[]) {
    super(
      `${kind}${typeof id === 'string' ? ` '${id}'` : ''}: ${issues.join('; ')}`,
    );
    this.name = 'RegistrationError';
  }
}

/** Разбирает значение схемой; нарушение — `RegistrationError`. */
export const parseRegistration = <T extends z.ZodType>(
  kind: string,
  schema: T,
  value: unknown,
): z.output<T> => {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const id = (value as { id?: unknown } | null | undefined)?.id;
  throw new RegistrationError(kind, id, schemaIssues(parsed.error));
};

/** `id` равен id расширения или начинается с него и точки. */
export const ownIdIssue = (id: string, owner: string): string[] =>
  id === owner || id.startsWith(`${owner}.`)
    ? []
    : [`id must be '${owner}' or start with '${owner}.'`];
