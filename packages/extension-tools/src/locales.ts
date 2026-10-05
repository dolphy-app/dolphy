import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  EXTENSION_LOCALES,
  FALLBACK_LOCALE,
  LOCALES_DIR,
  localeFile,
  localizableStrings,
  localizeManifest,
  parseLocaleText,
  placeholderKey,
  resolveText,
} from '@dolphy-app/extension-api';
import type {
  ExtensionLocale,
  LocaleTable,
  LocaleTables,
} from '@dolphy-app/extension-api';
import { parseManifest } from '@dolphy-app/extension-host';
import type { Finding } from './catalog/rules.ts';

export interface LocaleCheckInput {
  /** `extension.json` as written by the author (parsed JSON of any shape). */
  manifest: unknown;
  /** Every file of the extension, as paths relative to its root with `/`. */
  files: readonly string[];
  /** Text of a file; `null` when there is no such file. */
  read(file: string): Promise<string | null>;
}

type Loaded =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'table'; table: LocaleTable };

const error = (field: string, message: string): Finding => ({
  severity: 'error',
  field,
  message,
});

const warning = (field: string, message: string): Finding => ({
  severity: 'warning',
  field,
  message,
});

/** Paths of the manifest strings that are `%key%` placeholders, by key (first use first). */
const usesOf = (manifest: unknown): Map<string, string[]> => {
  const uses = new Map<string, string[]>();
  for (const { path: where, value } of localizableStrings(manifest)) {
    const key = placeholderKey(value);
    if (key === null) continue;
    uses.set(key, [...(uses.get(key) ?? []), where]);
  }
  return uses;
};

const loadTables = async (
  input: LocaleCheckInput,
  findings: Finding[],
): Promise<Record<ExtensionLocale, Loaded>> => {
  const loaded = {} as Record<ExtensionLocale, Loaded>;
  for (const locale of EXTENSION_LOCALES) {
    const file = localeFile(locale);
    const text = await input.read(file);
    if (text === null) {
      loaded[locale] = { kind: 'absent' };
      continue;
    }
    const parsed = parseLocaleText(text);
    if (parsed.ok) {
      loaded[locale] = { kind: 'table', table: parsed.table };
      continue;
    }
    loaded[locale] = { kind: 'invalid' };
    for (const issue of parsed.issues) findings.push(error(file, issue));
  }
  return loaded;
};

const tablesOf = (loaded: Record<ExtensionLocale, Loaded>): LocaleTables =>
  Object.fromEntries(
    EXTENSION_LOCALES.flatMap((locale) => {
      const entry = loaded[locale];
      return entry.kind === 'table' ? [[locale, entry.table]] : [];
    }),
  );

/** Errors about the text a language produces: the manifest with that text must still be valid. */
const resultFindings = (
  manifest: unknown,
  tables: LocaleTables,
  locale: ExtensionLocale,
  uses: ReadonlyMap<string, string[]>,
): Finding[] => {
  const parsed = parseManifest(localizeManifest(manifest, tables, locale));
  if (parsed.ok) return [];
  const issues = parsed.diagnostic.data['issues'];
  if (!Array.isArray(issues)) return [];
  const keyAt = new Map(
    [...uses].flatMap(([key, paths]) => paths.map((where) => [where, key])),
  );
  return issues.flatMap((issue) => {
    const where = [...keyAt.keys()].find((candidate) =>
      issue.startsWith(`${candidate}:`),
    );
    if (where === undefined) return [];
    const reason = issue.slice(where.length + 1).trim();
    return [
      error(
        where,
        `the ${locale} text of '%${keyAt.get(where)}%' is not valid for this field: ${reason}`,
      ),
    ];
  });
};

/**
 * Checks the translations of an extension: `locales/en.json` is required when
 * the manifest has a `%key%`; every key needs a text in `en`; the text of a
 * language must fit the limit of its field; files must have a valid shape.
 * A key the manifest does not use and an unsupported file are warnings.
 */
export const localeFindings = async (
  input: LocaleCheckInput,
): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const uses = usesOf(input.manifest);
  const loaded = await loadTables(input, findings);
  const english = loaded[FALLBACK_LOCALE];
  const englishFile = localeFile(FALLBACK_LOCALE);

  if (uses.size > 0 && english.kind === 'absent') {
    findings.push(
      error(
        englishFile,
        `${englishFile} is required: the manifest uses %key% placeholders`,
      ),
    );
  }
  if (english.kind === 'table') {
    for (const [key, paths] of uses) {
      if (!Object.hasOwn(english.table, key)) {
        findings.push(
          error(paths[0] as string, `'%${key}%' has no text in ${englishFile}`),
        );
      }
    }
  }
  const tables = tablesOf(loaded);
  // the chain of a language falls back to en: without a usable en only a language alone can be judged
  for (const locale of EXTENSION_LOCALES) {
    if (loaded[locale].kind !== 'table') continue;
    findings.push(...resultFindings(input.manifest, tables, locale, uses));
  }

  for (const locale of EXTENSION_LOCALES) {
    const entry = loaded[locale];
    if (entry.kind !== 'table') continue;
    for (const key of Object.keys(entry.table)) {
      if (!uses.has(key)) {
        findings.push(
          warning(
            localeFile(locale),
            `key '${key}' is not used by extension.json`,
          ),
        );
      }
    }
  }
  const supported = new Set<string>(EXTENSION_LOCALES.map(localeFile));
  for (const file of input.files) {
    if (file.startsWith(`${LOCALES_DIR}/`) && !supported.has(file)) {
      findings.push(
        warning(
          file,
          `${file} is not a translation file (${[...supported].join(', ')}): the app ignores it`,
        ),
      );
    }
  }
  return findings;
};

/** Text of a file in `dir`, or `null` when it is not a regular file. */
export const readFileOrNull = async (
  dir: string,
  file: string,
): Promise<string | null> => {
  const target = path.join(dir, file);
  const info = await stat(target).catch(() => null);
  return info?.isFile() === true ? readFile(target, 'utf8') : null;
};

/** The `en` table of an extension directory; `null` when it is absent or broken. */
export const readEnglishTable = async (
  dir: string,
): Promise<LocaleTable | null> => {
  const text = await readFileOrNull(dir, localeFile(FALLBACK_LOCALE));
  if (text === null) return null;
  const parsed = parseLocaleText(text);
  return parsed.ok ? parsed.table : null;
};

/** A manifest string in English: the catalog and the checks of publication metadata show this text. */
export const englishText = (
  value: string,
  table: LocaleTable | null,
): string =>
  table === null ? value : resolveText(value, { en: table }, FALLBACK_LOCALE);
