/**
 * Manifest localization. A string that is entirely `%key%` in a localizable
 * manifest field is replaced by the value of `key` from `locales/<language>.json`.
 * The functions are pure: the app window, the engine and the tools share them.
 */

/** Languages of `locales/<language>.json` (the app interface languages). */
export const EXTENSION_LOCALES = ['ru', 'en'] as const;
export type ExtensionLocale = (typeof EXTENSION_LOCALES)[number];

/** The root of the fallback chain and the only language of the catalog. */
export const FALLBACK_LOCALE: ExtensionLocale = 'en';

/** Directory of the translation tables inside an extension. */
export const LOCALES_DIR = 'locales';

/** `locales/<language>.json` for a language. */
export const localeFile = (locale: ExtensionLocale): string =>
  `${LOCALES_DIR}/${locale}.json`;

/** Key of a translation (without the `%` signs). */
export const LOCALE_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

const PLACEHOLDER_PATTERN = /^%([A-Za-z0-9_.-]{1,64})%$/;

/** Limits of a translation file; the values are checked at discovery and by the tools. */
export const LOCALE_LIMITS = Object.freeze({
  /** Size of the file in bytes. */
  fileBytes: 64 * 1024,
  keys: 500,
  /** Longest value in UTF-16 code units. */
  valueLength: 500,
});

/** A flat object of translations: key → text. */
export type LocaleTable = Readonly<Record<string, string>>;

/** Tables of one extension by language; a language without a file is absent. */
export type LocaleTables = Partial<Record<ExtensionLocale, LocaleTable>>;

export const isExtensionLocale = (value: string): value is ExtensionLocale =>
  (EXTENSION_LOCALES as readonly string[]).includes(value);

/** The key of `%key%`; `null` if the string is not a placeholder as a whole. */
export const placeholderKey = (value: string): string | null =>
  PLACEHOLDER_PATTERN.exec(value)?.[1] ?? null;

const lookup = (
  table: LocaleTable | undefined,
  key: string,
): string | undefined =>
  table !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;

/**
 * Text for `locale`: a plain string is returned as is; `%key%` is taken from
 * the table of `locale`, then from `en`, then stays `%key%`.
 */
export const resolveText = (
  value: string,
  tables: LocaleTables | undefined,
  locale: string,
): string => {
  const key = placeholderKey(value);
  if (key === null || tables === undefined) return value;
  const own = isExtensionLocale(locale)
    ? lookup(tables[locale], key)
    : undefined;
  return own ?? lookup(tables[FALLBACK_LOCALE], key) ?? value;
};

export type ParsedLocaleTable =
  { ok: true; table: LocaleTable } | { ok: false; issues: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks the parsed content of a translation file; every problem is an English message. */
export const parseLocaleTable = (json: unknown): ParsedLocaleTable => {
  if (!isRecord(json)) {
    return { ok: false, issues: ['must be a flat object of strings'] };
  }
  const entries = Object.entries(json);
  const issues: string[] = [];
  if (entries.length > LOCALE_LIMITS.keys) {
    issues.push(
      `${entries.length} keys exceed the limit of ${LOCALE_LIMITS.keys}`,
    );
  }
  const table: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const [key, value] of entries) {
    if (!LOCALE_KEY_PATTERN.test(key)) {
      issues.push(`key '${key}' must match ${LOCALE_KEY_PATTERN}`);
    } else if (typeof value !== 'string') {
      issues.push(`'${key}' must be a string`);
    } else if (value.length > LOCALE_LIMITS.valueLength) {
      issues.push(
        `'${key}' is longer than ${LOCALE_LIMITS.valueLength} characters`,
      );
    } else table[key] = value;
  }
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, table: { ...table } };
};

/** Size of the text in UTF-8, without `TextEncoder`: the package has no DOM or Node types. */
const utf8Length = (text: string): number => {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
};

/** Checks the text of a translation file: size, JSON syntax and content. */
export const parseLocaleText = (text: string): ParsedLocaleTable => {
  const bytes = utf8Length(text);
  if (bytes > LOCALE_LIMITS.fileBytes) {
    return {
      ok: false,
      issues: [`${bytes} bytes exceed the limit of ${LOCALE_LIMITS.fileBytes}`],
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      issues: [
        `is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  return parseLocaleTable(json);
};

/** Fields of the manifest that accept `%key%`, by contribution point. */
export const LOCALIZED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  exerciseTypes: ['title'],
  markdownRenderers: ['title'],
  themes: ['label'],
  gradePolicies: ['label'],
  settings: ['label', 'description', 'group'],
  commands: ['title', 'description', 'category'],
  panels: ['title'],
  widgets: ['title'],
};

/** Fields of the manifest root that accept `%key%`. */
export const LOCALIZED_ROOT_FIELDS: readonly string[] = ['name', 'description'];

/** A localizable string of a manifest: where it is and what it says. */
export interface LocalizedString {
  /** Dotted path in the manifest, such as `contributes.settings.0.options.1.label`. */
  path: string;
  value: string;
}

type Holder = Record<string, unknown>;
type Visit = (holder: Holder, field: string, path: string) => void;

const visitFields = (
  holder: unknown,
  fields: readonly string[],
  prefix: string,
  visit: Visit,
): void => {
  if (!isRecord(holder)) return;
  for (const field of fields) {
    if (typeof holder[field] === 'string') {
      visit(holder, field, `${prefix}.${field}`);
    }
  }
};

const visitLocalizable = (manifest: unknown, visit: Visit): void => {
  if (!isRecord(manifest)) return;
  for (const field of LOCALIZED_ROOT_FIELDS) {
    if (typeof manifest[field] === 'string') visit(manifest, field, field);
  }
  const { contributes } = manifest;
  if (!isRecord(contributes)) return;
  for (const [point, fields] of Object.entries(LOCALIZED_FIELDS)) {
    const entries = contributes[point];
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry: unknown, index) => {
      const prefix = `contributes.${point}.${index}`;
      visitFields(entry, fields, prefix, visit);
      if (point !== 'settings' || !isRecord(entry)) return;
      const { options } = entry;
      if (!Array.isArray(options)) return;
      options.forEach((option: unknown, optionIndex) =>
        visitFields(
          option,
          ['label'],
          `${prefix}.options.${optionIndex}`,
          visit,
        ),
      );
    });
  }
};

/** Every localizable string of a raw or normalized manifest, in manifest order. */
export const localizableStrings = (manifest: unknown): LocalizedString[] => {
  const found: LocalizedString[] = [];
  visitLocalizable(manifest, (holder, field, path) =>
    found.push({ path, value: holder[field] as string }),
  );
  return found;
};

/** Distinct keys of the `%key%` strings of a manifest, in manifest order. */
export const placeholderKeys = (manifest: unknown): string[] => [
  ...new Set(
    localizableStrings(manifest).flatMap(({ value }) => {
      const key = placeholderKey(value);
      return key === null ? [] : [key];
    }),
  ),
];

/**
 * A copy of the manifest with every placeholder replaced by its text in
 * `locale` (chain: `locale`, `en`); a key without a text stays `%key%`.
 */
export const localizeManifest = <T>(
  manifest: T,
  tables: LocaleTables,
  locale: string,
): T => {
  // a manifest is JSON, so a round trip is a deep copy
  const copy = JSON.parse(JSON.stringify(manifest)) as T;
  visitLocalizable(copy, (holder, field) => {
    holder[field] = resolveText(holder[field] as string, tables, locale);
  });
  return copy;
};
