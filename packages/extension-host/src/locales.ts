import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  EXTENSION_LOCALES,
  FALLBACK_LOCALE,
  LOCALE_LIMITS,
  localeFile,
  parseLocaleText,
  placeholderKeys,
} from '@dolphy-app/extension-api';
import type {
  ExtensionLocale,
  ExtensionManifest,
  LocaleTables,
} from '@dolphy-app/extension-api';
import type { ExtensionDiagnosticDto } from '@dolphy-app/engine-contract';

export interface LoadedLocales {
  /** Tables of the languages whose file is present and valid. */
  messages: LocaleTables;
  /** `locale.invalid-file` for a broken file, `locale.missing-key` for a key `en` lacks. */
  warnings: ExtensionDiagnosticDto[];
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type Read =
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'table'; table: Record<string, string> };

const readTable = async (
  dir: string,
  locale: ExtensionLocale,
): Promise<Read> => {
  const file = path.join(dir, localeFile(locale));
  const info = await lstat(file).catch((error: NodeJS.ErrnoException) =>
    error.code === 'ENOENT' ? null : error,
  );
  if (info === null) return { kind: 'absent' };
  if (info instanceof Error) {
    return { kind: 'invalid', reason: errorText(info) };
  }
  // a link or a directory is not a translation file; a huge file is not read at all
  if (!info.isFile())
    return { kind: 'invalid', reason: 'is not a regular file' };
  if (info.size > LOCALE_LIMITS.fileBytes) {
    return {
      kind: 'invalid',
      reason: `${info.size} bytes exceed the limit of ${LOCALE_LIMITS.fileBytes}`,
    };
  }
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    return { kind: 'invalid', reason: errorText(error) };
  }
  const parsed = parseLocaleText(text);
  return parsed.ok
    ? { kind: 'table', table: { ...parsed.table } }
    : { kind: 'invalid', reason: parsed.issues.join('; ') };
};

/**
 * Reads `locales/<language>.json` of an extension. A broken file is ignored with
 * a warning, the extension keeps working; a `%key%` of the manifest that `en`
 * does not translate is a warning too (the window shows the raw `%key%`).
 */
export const loadLocales = async (
  dir: string,
  manifest: ExtensionManifest,
): Promise<LoadedLocales> => {
  const messages: Record<string, Record<string, string>> = {};
  const warnings: ExtensionDiagnosticDto[] = [];
  for (const locale of EXTENSION_LOCALES) {
    const read = await readTable(dir, locale);
    if (read.kind === 'table') messages[locale] = read.table;
    else if (read.kind === 'invalid') {
      warnings.push({
        code: 'locale.invalid-file',
        data: { file: localeFile(locale), reason: read.reason },
      });
    }
  }
  const english = messages[FALLBACK_LOCALE];
  for (const key of placeholderKeys(manifest)) {
    if (english === undefined || !Object.hasOwn(english, key)) {
      warnings.push({ code: 'locale.missing-key', data: { key } });
    }
  }
  return { messages, warnings };
};
