import {
  DEFAULT_RENDERER,
  ELEMENT_NAME_PATTERN,
  EXTENSION_COMMAND_LIMITS,
  defaultElementName,
} from '@dolphy-app/extension-api';
import { z } from 'zod';
import {
  extensionId,
  idPrefixIssues,
  resolveModuleUrl,
  resolveSchema,
  safePath,
} from './support.ts';
import type { ContributionPoint } from './types.ts';

const schemaField = z.union([
  safePath(['.json']),
  z
    .record(z.string(), z.unknown())
    .refine((value) => Object.keys(value).length > 0, 'must not be empty'),
]);

export const exerciseTypes: ContributionPoint<'exerciseTypes'> = {
  key: 'exerciseTypes',
  needsMain: true,
  schema: z.strictObject({
    id: extensionId,
    title: z
      .string()
      .min(1)
      .max(EXTENSION_COMMAND_LIMITS.titleLength)
      .optional(),
    specSchema: schemaField,
    answerSchema: schemaField,
    element: z.string().optional(),
    renderer: safePath(['.js', '.mjs']).optional(),
  }),
  normalize: (entries) =>
    entries.map((type) => ({
      id: type.id,
      ...(type.title === undefined ? {} : { title: type.title }),
      specSchema: type.specSchema,
      answerSchema: type.answerSchema,
      element: type.element ?? defaultElementName(type.id),
      renderer: type.renderer ?? DEFAULT_RENDERER,
    })),
  check: (entries, owner) => [
    ...idPrefixIssues(
      'exerciseTypes',
      entries.map(({ id }) => id),
      owner,
    ),
    ...entries.flatMap((type, index) =>
      ELEMENT_NAME_PATTERN.test(type.element)
        ? []
        : [
            `contributes.exerciseTypes.${index}.element: invalid element name '${type.element}'`,
          ],
    ),
  ],
  resolve: async (entries, { dir, extensionId: owner, verifyFiles, ajv }) => {
    const resolved = [];
    for (const contribution of entries) {
      const rendererUrl = await resolveModuleUrl(
        owner,
        dir,
        contribution.renderer,
        DEFAULT_RENDERER,
        verifyFiles,
        'renderer',
      );
      resolved.push({
        id: contribution.id,
        title: contribution.title ?? null,
        specSchema: await resolveSchema(
          ajv,
          dir,
          contribution.specSchema,
          `specSchema of '${contribution.id}'`,
        ),
        answerSchema: await resolveSchema(
          ajv,
          dir,
          contribution.answerSchema,
          `answerSchema of '${contribution.id}'`,
        ),
        element: contribution.element,
        rendererUrl,
      });
    }
    return resolved;
  },
  claims: (resolved) =>
    resolved.flatMap((type) => [
      `exerciseType:${type.id}`,
      `element:${type.element}`,
    ]),
};
