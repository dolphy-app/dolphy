import {
  COLOR_SETTING_PATTERN,
  SETTING_LIMITS,
} from '@dolphy-app/extension-api';
import type {
  RegisteredSetting,
  SettingDefinition,
} from '@dolphy-app/extension-api';
import { z } from 'zod';
import {
  RegistrationError,
  idField,
  localizedField,
  ownIdIssue,
  parseRegistration,
} from './registrar-support.ts';

const base = {
  id: idField,
  label: localizedField(SETTING_LIMITS.labelLength),
  description: localizedField(SETTING_LIMITS.descriptionLength).optional(),
  group: localizedField(SETTING_LIMITS.groupLength).optional(),
  order: z.number().int().min(0).max(SETTING_LIMITS.orderMax).optional(),
  visibleWhen: z
    .strictObject({
      setting: idField,
      equals: z.union([z.boolean(), z.string(), z.number()]),
    })
    .optional(),
};

const option = z.strictObject({
  value: z.string().min(1).max(SETTING_LIMITS.optionValueLength),
  label: localizedField(SETTING_LIMITS.labelLength),
});

const maxLength = z
  .number()
  .int()
  .min(1)
  .max(SETTING_LIMITS.stringLength)
  .optional();

const definitionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...base,
    type: z.literal('boolean'),
    default: z.boolean(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('string'),
    default: z.string(),
    maxLength,
  }),
  z.strictObject({
    ...base,
    type: z.literal('text'),
    default: z.string(),
    maxLength,
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
    default: z.number().finite(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    integer: z.boolean().optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('enum'),
    default: z.string(),
    options: z.array(option).min(1).max(SETTING_LIMITS.options),
  }),
]);

type ParsedSetting = z.output<typeof definitionSchema>;

/** Нарушения `default` и границ одного определения. */
const constraintIssues = (setting: ParsedSetting): string[] => {
  switch (setting.type) {
    case 'boolean':
    case 'color':
      return [];
    case 'list': {
      const maxItems = setting.maxItems ?? SETTING_LIMITS.listItems;
      const itemMax = setting.itemMaxLength ?? SETTING_LIMITS.listItemLength;
      return [
        ...(setting.default.length > maxItems
          ? [`default has more than ${maxItems} items`]
          : []),
        ...(setting.default.some((item) => item.length > itemMax)
          ? [`default has an item longer than ${itemMax} characters`]
          : []),
      ];
    }
    case 'text':
    case 'string': {
      const limit = setting.maxLength ?? SETTING_LIMITS.stringLength;
      return setting.default.length > limit
        ? [`default is longer than ${limit} characters`]
        : [];
    }
    case 'number': {
      const { min, max, integer = false } = setting;
      const issues: string[] = [];
      if (min !== undefined && max !== undefined && min > max) {
        issues.push('min is greater than max');
      }
      if (integer && !Number.isInteger(setting.default)) {
        issues.push('default must be an integer');
      }
      if (min !== undefined && setting.default < min) {
        issues.push(`default is less than min ${min}`);
      }
      if (max !== undefined && setting.default > max) {
        issues.push(`default is greater than max ${max}`);
      }
      return issues;
    }
    default: {
      const values = setting.options.map(({ value }) => value);
      return [
        ...values.flatMap((value, index) =>
          values.indexOf(value) === index
            ? []
            : [`options.${index}.value: duplicate value '${value}'`],
        ),
        ...(values.includes(setting.default)
          ? []
          : [`default '${setting.default}' is not an option`]),
      ];
    }
  }
};
/** Что `visibleWhen` знает о цели: определение этого или прежнего вызова. */
interface ConditionTarget {
  id: string;
  type: ParsedSetting['type'];
  conditional: boolean;
}

/** `visibleWhen`: цель есть, это не сама настройка, не `list`, без цепочек, тип `equals` совпадает. */
const visibleWhenIssues = (
  setting: ParsedSetting,
  byId: ReadonlyMap<string, ConditionTarget>,
): string[] => {
  const { visibleWhen } = setting;
  if (visibleWhen === undefined) return [];
  const target = byId.get(visibleWhen.setting);
  if (target === undefined) {
    return [`visibleWhen.setting: unknown setting '${visibleWhen.setting}'`];
  }
  if (target.id === setting.id) {
    return ['visibleWhen.setting: a setting cannot depend on itself'];
  }
  if (target.type === 'list') {
    return [
      `visibleWhen.setting: '${target.id}' is a list and cannot be a condition`,
    ];
  }
  if (target.conditional) {
    return [
      `visibleWhen.setting: '${target.id}' has its own visibleWhen; chains and cycles are not allowed`,
    ];
  }
  const expected =
    target.type === 'boolean' || target.type === 'number'
      ? target.type
      : 'string';
  return typeof visibleWhen.equals === expected
    ? []
    : [`visibleWhen.equals: must be a ${expected} to match '${target.id}'`];
};

const normalize = (setting: ParsedSetting): RegisteredSetting => {
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
    case 'string':
      return {
        ...common,
        type: 'string',
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

/**
 * Проверяет определения очередного `registerSettings` вместе с уже
 * зарегистрированными (`existing`: уникальность id, цели `visibleWhen`) и
 * возвращает их в нормализованном виде.
 */
export const registerSettingDefinitions = (
  defs: readonly SettingDefinition[],
  owner: string,
  existing: readonly RegisteredSetting[],
): RegisteredSetting[] => {
  if (!Array.isArray(defs)) {
    throw new RegistrationError('settings', undefined, [
      'registerSettings expects an array of definitions',
    ]);
  }
  const parsed = defs.map((def) =>
    parseRegistration('setting', definitionSchema, def),
  );
  const known = new Set(existing.map(({ id }) => id));
  const byId = new Map<string, ParsedSetting>();
  for (const setting of parsed) {
    const issues = ownIdIssue(setting.id, owner);
    if (known.has(setting.id) || byId.has(setting.id)) {
      issues.push(`duplicate setting '${setting.id}'`);
    }
    if (issues.length > 0) {
      throw new RegistrationError('setting', setting.id, issues);
    }
    byId.set(setting.id, setting);
  }
  // цель `visibleWhen` — определение этого или прежнего вызова
  const targets = new Map<string, ConditionTarget>();
  for (const item of existing) {
    targets.set(item.id, {
      id: item.id,
      type: item.type,
      conditional: item.visibleWhen !== null,
    });
  }
  for (const item of parsed) {
    targets.set(item.id, {
      id: item.id,
      type: item.type,
      conditional: item.visibleWhen !== undefined,
    });
  }
  for (const setting of parsed) {
    const issues = [
      ...constraintIssues(setting),
      ...visibleWhenIssues(setting, targets),
    ];
    if (issues.length > 0) {
      throw new RegistrationError('setting', setting.id, issues);
    }
  }
  return parsed.map(normalize);
};
