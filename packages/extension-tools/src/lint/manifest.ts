import type { Finding } from '../catalog/rules.ts';

/** A finding and the rule that produced it. */
export interface RuleFinding extends Finding {
  ruleId: string;
}

/** Fields of `extension.json` that `lint` looks at, as written by the author. */
export interface DeclaredFields {
  name: string | null;
  description: string | null;
  author: string | null;
  tags: readonly unknown[] | null;
}

export const MIN_DESCRIPTION_LENGTH = 20;

/** `CHECK-019`: a description is present but too short to tell what the extension does. */
export const shortDescription = (description: string | null): Finding[] =>
  description !== null &&
  description.trim() !== '' &&
  description.trim().length < MIN_DESCRIPTION_LENGTH
    ? [
        {
          severity: 'warning',
          field: 'description',
          message: `description is shorter than ${MIN_DESCRIPTION_LENGTH} characters: say what the extension does`,
        },
      ]
    : [];

const missing = (value: string | null): boolean =>
  value === null || value.trim() === '';

/** Publication metadata of a project: every problem is a warning. */
export const manifestFindings = (fields: DeclaredFields): RuleFinding[] => {
  const findings: RuleFinding[] = [];
  for (const field of ['name', 'author'] as const) {
    if (missing(fields[field])) {
      findings.push({
        ruleId: 'CHECK-003',
        severity: 'warning',
        field,
        message: `'${field}' is not set: the catalog requires it`,
      });
    }
  }
  if (missing(fields.description)) {
    findings.push({
      ruleId: 'CHECK-003',
      severity: 'warning',
      field: 'description',
      message: "'description' is not set: the catalog requires it",
    });
  }
  for (const finding of shortDescription(fields.description)) {
    findings.push({ ruleId: 'CHECK-019', ...finding });
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
