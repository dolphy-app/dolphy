import {
  DEFAULT_MAIN,
  DEFAULT_RENDERER,
  ELEMENT_NAME_PATTERN,
  EXTENSION_API_VERSION,
  EXTENSION_ID_PATTERN,
  defaultElementName,
} from '@lms/extension-api';
import type {
  ExtensionManifest,
  ExtensionManifestInput,
} from '@lms/extension-api';
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

const schemaField = z.union([
  safePath(['.json']),
  z
    .record(z.string(), z.unknown())
    .refine((value) => Object.keys(value).length > 0, 'must not be empty'),
]);

const exerciseTypeSchema = z.strictObject({
  id: extensionId,
  specSchema: schemaField,
  answerSchema: schemaField,
  element: z.string().optional(),
  renderer: safePath(['.js', '.mjs']).optional(),
});

export const manifestSchema = z
  .strictObject({
    id: extensionId,
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'version must be semver'),
    apiVersion: z.literal(EXTENSION_API_VERSION),
    main: safePath(['.mjs']).optional(),
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

/** Применяет умолчания: `main`, `renderer`, `element`. */
export const normalizeManifest = (
  input: ExtensionManifestInput,
): ExtensionManifest => ({
  id: input.id,
  version: input.version,
  apiVersion: input.apiVersion,
  main: input.main ?? DEFAULT_MAIN,
  contributes: {
    exerciseTypes: input.contributes.exerciseTypes.map((type) => ({
      id: type.id,
      specSchema: type.specSchema,
      answerSchema: type.answerSchema,
      element: type.element ?? defaultElementName(type.id),
      renderer: type.renderer ?? DEFAULT_RENDERER,
    })),
  },
});

const formatIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.join('.') || '/'}: ${issue.message}`)
    .join('; ');

/** Сообщения о нарушениях в нормализованном манифесте (`element` после умолчаний). */
const normalizedIssues = (manifest: ExtensionManifest): string[] =>
  manifest.contributes.exerciseTypes.flatMap((type, index) =>
    ELEMENT_NAME_PATTERN.test(type.element)
      ? []
      : [
          `contributes.exerciseTypes.${index}.element: invalid element name '${type.element}'`,
        ],
  );

export const parseManifest = (
  raw: unknown,
):
  | { ok: true; manifest: ExtensionManifest }
  | { ok: false; message: string } => {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: formatIssues(parsed.error) };
  }
  const manifest = normalizeManifest(parsed.data as ExtensionManifestInput);
  const issues = normalizedIssues(manifest);
  if (issues.length > 0) return { ok: false, message: issues.join('; ') };
  return { ok: true, manifest };
};
