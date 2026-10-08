import { compareSemver, isSemver } from '@dolphy-app/extension-catalog';
import type { Finding } from '../catalog/rules.ts';

/** A finding and the rule that produced it. */
export interface RuleFinding extends Finding {
  ruleId: string;
}

/**
 * `name` or `description` of `extension.json` as written: a string, or an
 * object with texts by language.
 */
export interface DeclaredText {
  /** The string itself or `en` of the object; `null` — the object has no `en` text. */
  en: string | null;
  /** `ru` of the object; `null` — none. */
  ru: string | null;
  /** The value is an object: the apps before `LOCALIZED_TEXT_MIN_APP_VERSION` reject it. */
  isLocalized: boolean;
}

/** Fields of `extension.json` that `lint` looks at, as written by the author. */
export interface DeclaredFields {
  name: DeclaredText | null;
  description: DeclaredText | null;
  author: string | null;
  tags: readonly unknown[] | null;
  minAppVersion: string | null;
}

export const MIN_DESCRIPTION_LENGTH = 20;

/** The first app that reads a localized `name` or `description` of a manifest. */
export const LOCALIZED_TEXT_MIN_APP_VERSION = '0.7.0';

/** `null` — neither a string nor an object. */
export const declaredText = (value: unknown): DeclaredText | null => {
  if (typeof value === 'string') {
    return { en: value, ru: null, isLocalized: false };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const { en, ru } = value as Record<string, unknown>;
  return {
    en: typeof en === 'string' ? en : null,
    ru: typeof ru === 'string' ? ru : null,
    isLocalized: true,
  };
};

/** The texts of a field with their paths: `description`, or `description.en` and `description.ru`. */
export const declaredLanguages = (
  field: string,
  text: DeclaredText,
): { field: string; text: string }[] => {
  const languages: { field: string; text: string }[] = [];
  if (text.en !== null) {
    languages.push({
      field: text.isLocalized ? `${field}.en` : field,
      text: text.en,
    });
  }
  if (text.ru !== null) languages.push({ field: `${field}.ru`, text: text.ru });
  return languages;
};

/** `CHECK-019`: a description is present but too short to tell what the extension does. */
export const shortDescription = (
  description: DeclaredText | null,
): Finding[] =>
  description === null
    ? []
    : declaredLanguages('description', description)
        .filter(
          ({ text }) =>
            text.trim() !== '' && text.trim().length < MIN_DESCRIPTION_LENGTH,
        )
        .map(({ field }) => ({
          severity: 'warning',
          field,
          message: `${field} is shorter than ${MIN_DESCRIPTION_LENGTH} characters: say what the extension does`,
        }));

/** `CHECK-032`: the manifest has a localized text but does not require an app that reads it. */
export const localizedTextNeedsApp = (
  fields: Pick<DeclaredFields, 'name' | 'description'>,
  minAppVersion: string | null,
): Finding[] =>
  (fields.name?.isLocalized === true ||
    fields.description?.isLocalized === true) &&
  (minAppVersion === null ||
    !isSemver(minAppVersion) ||
    compareSemver(minAppVersion, LOCALIZED_TEXT_MIN_APP_VERSION) < 0)
    ? [
        {
          severity: 'error',
          field: 'minAppVersion',
          message: `a localized name or description is rejected by apps before ${LOCALIZED_TEXT_MIN_APP_VERSION}: set minAppVersion to ${LOCALIZED_TEXT_MIN_APP_VERSION} or newer`,
        },
      ]
    : [];

const isBlank = (value: string | null): boolean =>
  value === null || value.trim() === '';

const isMissing = (text: DeclaredText | null): boolean =>
  text === null || isBlank(text.en);

const unsetFinding = (field: string): RuleFinding => ({
  ruleId: 'CHECK-003',
  severity: 'warning',
  field,
  message: `'${field}' is not set: the catalog requires it`,
});

/** The field of the main (English) text: `name`, or `name.en` for an object. */
const mainField = (field: string, text: DeclaredText | null): string =>
  text?.isLocalized === true ? `${field}.en` : field;

/** Publication metadata of a project: every problem is a warning. */
export const manifestFindings = (fields: DeclaredFields): RuleFinding[] => {
  const findings: RuleFinding[] = [];
  if (isMissing(fields.name)) {
    findings.push(unsetFinding(mainField('name', fields.name)));
  }
  if (isBlank(fields.author)) findings.push(unsetFinding('author'));
  if (isMissing(fields.description)) {
    findings.push(unsetFinding(mainField('description', fields.description)));
  }
  for (const finding of shortDescription(fields.description)) {
    findings.push({ ruleId: 'CHECK-019', ...finding });
  }
  for (const finding of localizedTextNeedsApp(fields, fields.minAppVersion)) {
    findings.push({ ruleId: 'CHECK-032', ...finding, severity: 'warning' });
  }
  if (fields.tags === null || fields.tags.length === 0) {
    findings.push({
      ruleId: 'LINT-001',
      severity: 'warning',
      field: 'tags',
      message:
        "'tags' is not set: the catalog lists the extension without tags",
    });
  }
  return findings;
};
