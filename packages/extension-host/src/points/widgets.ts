import {
  DEFAULT_WIDGET,
  EXTENSION_COMMAND_LIMITS,
  EXTENSION_WIDGET_LIMITS,
  EXTENSION_WIDGET_SLOTS,
} from '@dolphy-app/extension-api';
import { z } from 'zod';
import {
  duplicateIssues,
  extensionId,
  idPrefixIssues,
  resolveModuleUrl,
  safePath,
  whenField,
  whenIssues,
} from './support.ts';
import type { ContributionPoint } from './types.ts';

const {
  widgets: MAX_WIDGETS,
  minHeight: MIN_HEIGHT,
  maxHeight: MAX_HEIGHT,
} = EXTENSION_WIDGET_LIMITS;

const height = z.number().int().min(MIN_HEIGHT).max(MAX_HEIGHT);

export const widgets: ContributionPoint<'widgets'> = {
  key: 'widgets',
  needsMain: false,
  schema: z.strictObject({
    id: extensionId,
    title: z.string().min(1).max(EXTENSION_COMMAND_LIMITS.titleLength),
    slot: z.enum(EXTENSION_WIDGET_SLOTS),
    minHeight: height.optional(),
    maxHeight: height.optional(),
    module: safePath(['.js', '.mjs']).optional(),
    when: whenField.optional(),
  }),
  normalize: (entries) =>
    entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      slot: entry.slot,
      minHeight: entry.minHeight ?? MIN_HEIGHT,
      maxHeight: entry.maxHeight ?? MAX_HEIGHT,
      module: entry.module ?? DEFAULT_WIDGET,
      ...(entry.when === undefined ? {} : { when: entry.when }),
    })),
  check: (entries, owner) => {
    const ids = entries.map(({ id }) => id);
    return [
      ...(entries.length > MAX_WIDGETS
        ? [`contributes.widgets: at most ${MAX_WIDGETS} widgets allowed`]
        : []),
      ...idPrefixIssues('widgets', ids, owner),
      ...duplicateIssues('contributes.widgets', 'id', ids),
      ...entries.flatMap((entry, index) => whenIssues('widgets', index, entry.when)),
      ...entries.flatMap((entry, index) =>
        entry.minHeight > entry.maxHeight
          ? [
              `contributes.widgets.${index}.minHeight: minHeight (${entry.minHeight}) must not exceed maxHeight (${entry.maxHeight})`,
            ]
          : [],
      ),
    ];
  },
  resolve: async (entries, { dir, extensionId: owner, verifyFiles }) => {
    const resolved = [];
    for (const entry of entries) {
      resolved.push({
        id: entry.id,
        title: entry.title,
        slot: entry.slot,
        minHeight: entry.minHeight,
        maxHeight: entry.maxHeight,
        when: entry.when ?? null,
        rendererUrl: await resolveModuleUrl(
          owner,
          dir,
          entry.module,
          DEFAULT_WIDGET,
          verifyFiles,
          'widget module',
        ),
      });
    }
    return resolved;
  },
  claims: (resolved) => resolved.map((widget) => `widget:${widget.id}`),
};
