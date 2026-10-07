import {
  DEFAULT_MAIN,
  EXTENSION_API_VERSION,
  EXTENSION_PLATFORMS,
  EXTENSION_TAGS,
  GITHUB_LOGIN_PATTERN,
  MAX_EXTENSION_DEPENDENCIES,
} from '@dolphy-app/extension-api';
import type {
  ExtensionManifest,
  ExtensionManifestInput,
} from '@dolphy-app/extension-api';
import type { ExtensionDiagnosticDto } from '@dolphy-app/engine-contract';
import { isSemver, parseRange } from '@dolphy-app/extension-catalog';
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

/** Диапазон версий в том же виде, что `versions` отзыва и устаревания в каталоге. */
const versionRange = z.string().superRefine((value, ctx) => {
  try {
    parseRange(value);
  } catch {
    ctx.addIssue({
      code: 'custom',
      message:
        "range must be space-separated comparators such as '>=1.2.0 <2.0.0'",
    });
  }
});

export const manifestSchema = z
  .strictObject({
    /** Ссылка на JSON Schema для редактора; приложением и инструментами игнорируется. */
    $schema: z.string().optional(),
    id: extensionId,
    version: z.string().refine(isSemver, 'version must be semver'),
    apiVersion: z.literal(EXTENSION_API_VERSION),
    main: safePath(['.mjs']).optional(),
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
    icon: safePath(['.png', '.webp']).optional(),
    tags: z
      .array(
        z.enum(EXTENSION_TAGS, {
          error: `tag must be one of: ${EXTENSION_TAGS.join(', ')}`,
        }),
      )
      .max(5, 'at most 5 tags')
      .optional(),
    dependencies: z
      .array(
        z.strictObject({ id: extensionId, range: versionRange.optional() }),
      )
      .max(
        MAX_EXTENSION_DEPENDENCIES,
        `at most ${MAX_EXTENSION_DEPENDENCIES} dependencies`,
      )
      .optional(),
    contributes: contributesSchema,
  })
  .superRefine((manifest, ctx) => {
    const { platforms = [] } = manifest;
    platforms.forEach((platform, index) => {
      if (platforms.indexOf(platform) !== index) {
        ctx.addIssue({
          code: 'custom',
          path: ['platforms', index],
          message: `duplicate platform '${platform}'`,
        });
      }
    });
    const { tags = [] } = manifest;
    tags.forEach((tag, index) => {
      if (tags.indexOf(tag) !== index) {
        ctx.addIssue({
          code: 'custom',
          path: ['tags', index],
          message: `duplicate tag '${tag}'`,
        });
      }
    });
    const { dependencies = [] } = manifest;
    dependencies.forEach(({ id }, index) => {
      if (id === manifest.id) {
        ctx.addIssue({
          code: 'custom',
          path: ['dependencies', index, 'id'],
          message: 'an extension cannot depend on itself',
        });
      } else if (dependencies.findIndex((item) => item.id === id) !== index) {
        ctx.addIssue({
          code: 'custom',
          path: ['dependencies', index, 'id'],
          message: `duplicate dependency '${id}'`,
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

/** Применяет умолчания: `main`, `renderer`, пустые точки. */
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
    name: input.name ?? null,
    description: input.description ?? null,
    author: input.author ?? null,
    platforms: [...(input.platforms ?? [])],
    minAppVersion: input.minAppVersion ?? null,
    tags: [...(input.tags ?? [])],
    dependencies: (input.dependencies ?? []).map(({ id, range }) => ({
      id,
      range: range ?? null,
    })),
    icon: input.icon ?? null,
    contributes: contributes as ExtensionManifest['contributes'],
  };
};

const zodIssues = (error: z.ZodError): string[] =>
  error.issues.map(
    (issue) => `${issue.path.join('.') || '/'}: ${issue.message}`,
  );

/** Сообщения о нарушениях в нормализованном манифесте. */
const normalizedIssues = (manifest: ExtensionManifest): string[] => [
  ...CONTRIBUTION_POINTS.flatMap((point) =>
    point.check(manifest.contributes[point.key] as never, manifest.id),
  ),
];

const invalid = (
  issues: string[],
): { ok: false; diagnostic: ExtensionDiagnosticDto } => ({
  ok: false,
  diagnostic: { code: 'manifest-invalid', data: { issues } },
});

/** Разбор манифеста; ошибка — диагностика `manifest-invalid` (текст — `formatDiagnostic`). */
export const parseManifest = (
  raw: unknown,
):
  | { ok: true; manifest: ExtensionManifest }
  | { ok: false; diagnostic: ExtensionDiagnosticDto } => {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) return invalid(zodIssues(parsed.error));
  const manifest = normalizeManifest(parsed.data as ExtensionManifestInput);
  const issues = normalizedIssues(manifest);
  if (issues.length > 0) return invalid(issues);
  return { ok: true, manifest };
};

/**
 * JSON Schema (2020-12) of `extension.json` for editors. It cannot express the
 * cross-field rules (`id` prefix, at least one contribution, the
 * per-point checks): `parseManifest`
 * and `dolphy-ext validate` stay the source of truth.
 */
export const manifestJsonSchema = (): Record<string, unknown> => ({
  ...z.toJSONSchema(manifestSchema, { io: 'input', unrepresentable: 'any' }),
  title: 'Dolphy extension manifest',
  description:
    'Editor aid for extension.json. It does not express cross-field rules (id prefix, at least one contribution, per-point checks); `dolphy-ext validate` and the app remain the source of truth.',
});
