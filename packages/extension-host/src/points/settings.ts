import type { SettingContribution } from '@dolphy-app/extension-api';
import { z } from 'zod';
import { duplicateIssues, extensionId, idPrefixIssues } from './support.ts';
import type { ContributionPoint, ResolvedSetting } from './types.ts';

/** Потолок длины строкового значения: даже в UTF-8 (3 байта на единицу) остаётся в пределах 64 КиБ хранилища. */
const MAX_STRING_LENGTH = 10_000;
const MAX_OPTIONS = 64;

const base = {
  id: extensionId,
  label: z.string().min(1).max(60),
  description: z.string().min(1).max(500).optional(),
};

const option = z.strictObject({
  value: z.string().min(1).max(100),
  label: z.string().min(1).max(60),
});

const schema = z.discriminatedUnion('type', [
  z.strictObject({
    ...base,
    type: z.literal('boolean'),
    default: z.boolean(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('string'),
    default: z.string(),
    maxLength: z.number().int().min(1).max(MAX_STRING_LENGTH).optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('number'),
    default: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('enum'),
    default: z.string(),
    options: z.array(option).min(1).max(MAX_OPTIONS),
  }),
]);

/** Нарушения `default` и границ одного определения (путь — до поля). */
const constraintIssues = (
  setting: SettingContribution,
  at: string,
): string[] => {
  const issue = (field: string, message: string): string =>
    `${at}.${field}: ${message}`;
  switch (setting.type) {
    case 'boolean':
      return [];
    case 'string': {
      const limit = setting.maxLength ?? MAX_STRING_LENGTH;
      return setting.default.length > limit
        ? [issue('default', `default is longer than ${limit} characters`)]
        : [];
    }
    case 'number': {
      const { min, max, integer = false } = setting;
      const issues: string[] = [];
      if (min !== undefined && max !== undefined && min > max) {
        issues.push(issue('min', 'min is greater than max'));
      }
      if (integer && !Number.isInteger(setting.default)) {
        issues.push(issue('default', 'default must be an integer'));
      }
      if (min !== undefined && setting.default < min) {
        issues.push(issue('default', `default is less than min ${min}`));
      }
      if (max !== undefined && setting.default > max) {
        issues.push(issue('default', `default is greater than max ${max}`));
      }
      return issues;
    }
    default: {
      const values = setting.options.map(({ value }) => value);
      return [
        ...duplicateIssues(`${at}.options`, 'value', values),
        ...(values.includes(setting.default)
          ? []
          : [
              issue('default', `default '${setting.default}' is not an option`),
            ]),
      ];
    }
  }
};

const resolveSetting = (setting: SettingContribution): ResolvedSetting => {
  const common = {
    id: setting.id,
    label: setting.label,
    description: setting.description ?? null,
  };
  switch (setting.type) {
    case 'boolean':
      return { ...common, type: 'boolean', default: setting.default };
    case 'string':
      return {
        ...common,
        type: 'string',
        default: setting.default,
        maxLength: setting.maxLength ?? null,
      };
    case 'number':
      return {
        ...common,
        type: 'number',
        default: setting.default,
        min: setting.min ?? null,
        max: setting.max ?? null,
        integer: setting.integer ?? false,
      };
    default:
      return {
        ...common,
        type: 'enum',
        default: setting.default,
        options: setting.options.map(({ value, label }) => ({ value, label })),
      };
  }
};

export const settings: ContributionPoint<'settings'> = {
  key: 'settings',
  needsMain: false,
  schema,
  normalize: (entries) => entries,
  check: (entries, owner) => [
    ...idPrefixIssues(
      'settings',
      entries.map(({ id }) => id),
      owner,
    ),
    ...duplicateIssues(
      'contributes.settings',
      'id',
      entries.map(({ id }) => id),
    ),
    ...entries.flatMap((entry, index) =>
      constraintIssues(entry, `contributes.settings.${index}`),
    ),
  ],
  resolve: async (entries) => entries.map(resolveSetting),
  claims: (resolved) => resolved.map((setting) => `setting:${setting.id}`),
};
