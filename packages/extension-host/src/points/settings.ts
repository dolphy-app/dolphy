import {
  COLOR_SETTING_PATTERN,
  SETTING_LIMITS,
} from '@dolphy-app/extension-api';
import type { SettingContribution } from '@dolphy-app/extension-api';
import { z } from 'zod';
import { duplicateIssues, extensionId, idPrefixIssues } from './support.ts';
import type { ContributionPoint, ResolvedSetting } from './types.ts';

/** Потолок длины строкового значения: даже в UTF-8 (3 байта на единицу) остаётся в пределах 64 КиБ хранилища. */
const MAX_STRING_LENGTH = SETTING_LIMITS.stringLength;
const MAX_OPTIONS = 64;

const base = {
  id: extensionId,
  label: z.string().min(1).max(60),
  description: z.string().min(1).max(500).optional(),
  group: z.string().min(1).max(SETTING_LIMITS.groupLength).optional(),
  order: z.number().int().min(0).max(SETTING_LIMITS.orderMax).optional(),
  visibleWhen: z
    .strictObject({
      setting: extensionId,
      equals: z.union([z.boolean(), z.string(), z.number()]),
    })
    .optional(),
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
    type: z.literal('text'),
    default: z.string(),
    maxLength: z.number().int().min(1).max(MAX_STRING_LENGTH).optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('color'),
    default: z.string().regex(COLOR_SETTING_PATTERN, 'must be #rrggbb'),
  }),
  z.strictObject({
    ...base,
    type: z.literal('list'),
    default: z.array(z.string()),
    maxItems: z.number().int().min(1).max(SETTING_LIMITS.listItems).optional(),
    itemMaxLength: z
      .number()
      .int()
      .min(1)
      .max(SETTING_LIMITS.listItemLength)
      .optional(),
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
    case 'color':
      return [];
    case 'list': {
      const maxItems = setting.maxItems ?? SETTING_LIMITS.listItems;
      const itemMax = setting.itemMaxLength ?? SETTING_LIMITS.listItemLength;
      return [
        ...(setting.default.length > maxItems
          ? [issue('default', `default has more than ${maxItems} items`)]
          : []),
        ...(setting.default.some((item) => item.length > itemMax)
          ? [
              issue(
                'default',
                `default has an item longer than ${itemMax} characters`,
              ),
            ]
          : []),
      ];
    }
    case 'text':
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

/** Нарушения `visibleWhen` всех определений: цель есть, это не сама настройка, не `list`, без цепочек, тип `equals` совпадает. */
const visibleWhenIssues = (
  entries: readonly SettingContribution[],
): string[] => {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return entries.flatMap((entry, index) => {
    const { visibleWhen } = entry;
    if (visibleWhen === undefined) return [];
    const at = `contributes.settings.${index}.visibleWhen`;
    const target = byId.get(visibleWhen.setting);
    if (target === undefined) {
      return [`${at}.setting: unknown setting '${visibleWhen.setting}'`];
    }
    if (target.id === entry.id) {
      return [`${at}.setting: a setting cannot depend on itself`];
    }
    if (target.type === 'list') {
      return [
        `${at}.setting: '${target.id}' is a list and cannot be a condition`,
      ];
    }
    if (target.visibleWhen !== undefined) {
      return [
        `${at}.setting: '${target.id}' has its own visibleWhen; chains and cycles are not allowed`,
      ];
    }
    const expected =
      target.type === 'boolean' || target.type === 'number'
        ? target.type
        : 'string';
    return typeof visibleWhen.equals === expected
      ? []
      : [`${at}.equals: must be a ${expected} to match '${target.id}'`];
  });
};

const resolveSetting = (setting: SettingContribution): ResolvedSetting => {
  const common = {
    id: setting.id,
    label: setting.label,
    description: setting.description ?? null,
    group: setting.group ?? null,
    order: setting.order ?? 0,
    visibleWhen:
      setting.visibleWhen === undefined ? null : { ...setting.visibleWhen },
  };
  switch (setting.type) {
    case 'boolean':
      return { ...common, type: 'boolean', default: setting.default };
    case 'color':
      return {
        ...common,
        type: 'color',
        default: setting.default.toLowerCase(),
      };
    case 'text':
      return {
        ...common,
        type: 'text',
        default: setting.default,
        maxLength: setting.maxLength ?? null,
      };
    case 'list':
      return {
        ...common,
        type: 'list',
        default: [...setting.default],
        maxItems: setting.maxItems ?? SETTING_LIMITS.listItems,
        itemMaxLength: setting.itemMaxLength ?? SETTING_LIMITS.listItemLength,
      };
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
    ...visibleWhenIssues(entries),
  ],
  resolve: async (entries) => entries.map(resolveSetting),
  claims: (resolved) => resolved.map((setting) => `setting:${setting.id}`),
};
