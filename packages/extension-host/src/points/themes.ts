import {
  BUILTIN_THEME_IDS,
  THEME_COLOR_KEYS,
  THEME_VARIABLE_KEYS,
} from '@spirula/extension-api';
import { z } from 'zod';
import { extensionId, idPrefixIssues } from './support.ts';
import type { ContributionPoint } from './types.ts';

const HEX_COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

const hexColor = z.string().regex(HEX_COLOR, 'must be #rrggbb or #rrggbbaa');

const unknownKeys = (
  record: Record<string, unknown>,
  allowed: readonly string[],
): string[] => Object.keys(record).filter((key) => !allowed.includes(key));

const rejectUnknownKeys =
  (allowed: readonly string[], noun: string) =>
  (value: Record<string, unknown>, ctx: z.RefinementCtx): void => {
    const unknown = unknownKeys(value, allowed);
    if (unknown.length === 0) return;
    ctx.addIssue({
      code: 'custom',
      message: `unknown ${noun} keys: ${unknown.join(', ')}`,
    });
  };

const colors = z
  .record(z.string(), hexColor)
  .refine((value) => Object.keys(value).length > 0, 'must not be empty')
  .superRefine(rejectUnknownKeys(THEME_COLOR_KEYS, 'color'));

const isVariableValid = (key: string, value: string | number): boolean =>
  key === 'border-color'
    ? typeof value === 'string' && HEX_COLOR.test(value)
    : typeof value === 'number' && value >= 0 && value <= 1;

const variables = z
  .record(z.string(), z.union([z.string(), z.number()]))
  .superRefine(rejectUnknownKeys(THEME_VARIABLE_KEYS, 'variable'))
  .refine(
    (value) =>
      Object.entries(value).every(([key, item]) => isVariableValid(key, item)),
    'border-color must be a hex color, other variables numbers in [0, 1]',
  );

export const themes: ContributionPoint<'themes'> = {
  key: 'themes',
  needsMain: false,
  schema: z.strictObject({
    id: extensionId.refine(
      (id) => !(BUILTIN_THEME_IDS as readonly string[]).includes(id),
      'id is reserved for a built-in theme',
    ),
    label: z.string().min(1).max(60),
    dark: z.boolean(),
    colors,
    variables: variables.optional(),
  }),
  normalize: (entries) => entries,
  check: (entries, owner) =>
    idPrefixIssues(
      'themes',
      entries.map(({ id }) => id),
      owner,
    ),
  resolve: async (entries) =>
    entries.map((theme) => ({
      id: theme.id,
      label: theme.label,
      dark: theme.dark,
      colors: { ...theme.colors },
      variables: { ...theme.variables },
    })),
  claims: (resolved) => resolved.map((theme) => `theme:${theme.id}`),
};
