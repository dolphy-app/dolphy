import {
  DEFAULT_MAIN,
  EXTENSION_API_VERSION,
  EXTENSION_PERMISSIONS,
} from '@lms/extension-api';
import type {
  ExtensionManifest,
  ExtensionManifestInput,
} from '@lms/extension-api';
import { z } from 'zod';
import { CONTRIBUTION_POINTS } from './points/index.ts';
import { extensionId, safePath } from './points/support.ts';

type Entries = Record<string, readonly unknown[] | undefined>;

const contributesSchema = z.strictObject(
  Object.fromEntries(
    CONTRIBUTION_POINTS.map((point) => [
      point.key,
      z.array(point.schema).optional(),
    ]),
  ),
);

const entriesOf = (contributes: unknown, key: string): readonly unknown[] =>
  (contributes as Entries)[key] ?? [];

const isEmpty = (contributes: unknown): boolean =>
  CONTRIBUTION_POINTS.every(
    (point) => entriesOf(contributes, point.key).length === 0,
  );

export const manifestSchema = z
  .strictObject({
    id: extensionId,
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'version must be semver'),
    apiVersion: z.literal(EXTENSION_API_VERSION),
    main: safePath(['.mjs']).optional(),
    permissions: z.array(z.enum(EXTENSION_PERMISSIONS)).optional(),
    contributes: contributesSchema,
  })
  .superRefine((manifest, ctx) => {
    const { permissions = [] } = manifest;
    permissions.forEach((permission, index) => {
      if (permissions.indexOf(permission) !== index) {
        ctx.addIssue({
          code: 'custom',
          path: ['permissions', index],
          message: `duplicate permission '${permission}'`,
        });
      }
    });
    if (isEmpty(manifest.contributes)) {
      ctx.addIssue({
        code: 'custom',
        path: ['contributes'],
        message: 'at least one contribution is required',
      });
    }
  });

/** Код нужен, если есть записи в точке, которая его требует. */
const needsMain = (contributes: unknown): boolean =>
  CONTRIBUTION_POINTS.some(
    (point) => point.needsMain && entriesOf(contributes, point.key).length > 0,
  );

/** Применяет умолчания: `main`, `renderer`, `element`, пустые точки. */
export const normalizeManifest = (
  input: ExtensionManifestInput,
): ExtensionManifest => {
  const contributes = Object.fromEntries(
    CONTRIBUTION_POINTS.map((point) => [
      point.key,
      point.normalize(entriesOf(input.contributes, point.key) as never),
    ]),
  );
  return {
    id: input.id,
    version: input.version,
    apiVersion: input.apiVersion,
    main: input.main ?? (needsMain(input.contributes) ? DEFAULT_MAIN : null),
    permissions: [...(input.permissions ?? [])],
    contributes: contributes as ExtensionManifest['contributes'],
  };
};

const formatIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.join('.') || '/'}: ${issue.message}`)
    .join('; ');

/** Сообщения о нарушениях в нормализованном манифесте. */
const normalizedIssues = (manifest: ExtensionManifest): string[] =>
  CONTRIBUTION_POINTS.flatMap((point) =>
    point.check(manifest.contributes[point.key] as never, manifest.id),
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
