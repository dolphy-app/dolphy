import {
  ELEMENT_NAME_PATTERN,
  EXTENSION_API_VERSION,
  EXTENSION_ID_PATTERN,
} from '@lms/extension-api';
import type { ExtensionManifest } from '@lms/extension-api';
import { z } from 'zod';

/** Относительный путь внутри каталога расширения: без `..`, `\` и ведущего `/`. */
const isSafeRelativePath = (value: string): boolean =>
  value.length > 0 &&
  !value.includes('\\') &&
  !value.startsWith('/') &&
  !value.split('/').includes('..');

const safePath = (extensions: readonly string[]) =>
  z
    .string()
    .refine(isSafeRelativePath, 'must be a safe relative path')
    .refine(
      (value) => extensions.some((ext) => value.endsWith(ext)),
      `must end with ${extensions.join(' or ')}`,
    );

const extensionId = z
  .string()
  .max(64)
  .regex(EXTENSION_ID_PATTERN, 'invalid extension id');

const exerciseTypeSchema = z.strictObject({
  id: extensionId,
  specSchema: safePath(['.json']),
  answerSchema: safePath(['.json']),
  element: z.string().regex(ELEMENT_NAME_PATTERN, 'invalid element name'),
  renderer: safePath(['.js', '.mjs']),
});

export const manifestSchema = z
  .strictObject({
    id: extensionId,
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'version must be semver'),
    apiVersion: z.literal(EXTENSION_API_VERSION),
    main: safePath(['.mjs']),
    contributes: z.strictObject({
      exerciseTypes: z.array(exerciseTypeSchema).min(1),
    }),
  })
  .superRefine((manifest, ctx) => {
    manifest.contributes.exerciseTypes.forEach((type, index) => {
      if (type.id !== manifest.id && !type.id.startsWith(`${manifest.id}.`)) {
        ctx.addIssue({
          code: 'custom',
          path: ['contributes', 'exerciseTypes', index, 'id'],
          message: `exercise type id must be '${manifest.id}' or start with '${manifest.id}.'`,
        });
      }
    });
  });

export const parseManifest = (
  raw: unknown,
):
  | { ok: true; manifest: ExtensionManifest }
  | { ok: false; message: string } => {
  const parsed = manifestSchema.safeParse(raw);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return {
    ok: false,
    message: parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '/'}: ${issue.message}`)
      .join('; '),
  };
};
