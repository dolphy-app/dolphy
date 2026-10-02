import {
  DEFAULT_MAIN,
  EXTENSION_API_VERSION,
  EXTENSION_PERMISSIONS,
  EXTENSION_PLATFORMS,
  GITHUB_LOGIN_PATTERN,
} from '@dolphy-app/extension-api';
import type {
  ExtensionManifest,
  ExtensionManifestInput,
} from '@dolphy-app/extension-api';
import { isSemver } from '@dolphy-app/extension-catalog';
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
    version: z.string().refine(isSemver, 'version must be semver'),
    apiVersion: z.literal(EXTENSION_API_VERSION),
    main: safePath(['.mjs']).optional(),
    permissions: z.array(z.enum(EXTENSION_PERMISSIONS)).optional(),
    name: z.string().min(1).max(80).optional(),
    description: z.string().min(1).max(500).optional(),
    author: z
      .string()
      .regex(GITHUB_LOGIN_PATTERN, 'must be a GitHub login')
      .optional(),
    platforms: z.array(z.enum(EXTENSION_PLATFORMS)).optional(),
    minAppVersion: z
      .string()
      .refine(isSemver, 'minAppVersion must be semver x.y.z')
      .optional(),
    contributes: contributesSchema,
  })
  .superRefine((manifest, ctx) => {
    const { permissions = [], platforms = [] } = manifest;
    platforms.forEach((platform, index) => {
      if (platforms.indexOf(platform) !== index) {
        ctx.addIssue({
          code: 'custom',
          path: ['platforms', index],
          message: `duplicate platform '${platform}'`,
        });
      }
    });
    permissions.forEach((permission, index) => {
      if (permissions.indexOf(permission) !== index) {
        ctx.addIssue({
          code: 'custom',
          path: ['permissions', index],
          message: `duplicate permission '${permission}'`,
        });
      }
    });
    if (
      entriesOf(manifest.contributes, 'events').length > 0 &&
      !permissions.includes('learning.events')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['permissions'],
        message: "contributes.events requires the 'learning.events' permission",
      });
    }
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
    name: input.name ?? null,
    description: input.description ?? null,
    author: input.author ?? null,
    platforms: [...(input.platforms ?? [])],
    minAppVersion: input.minAppVersion ?? null,
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
