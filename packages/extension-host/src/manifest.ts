import {
  EXTENSION_API_VERSION,
  EXTENSION_ID_PATTERN,
  EXTENSION_PLATFORMS,
  EXTENSION_TAGS,
  GITHUB_LOGIN_PATTERN,
  MAX_EXTENSION_DEPENDENCIES,
  MAX_EXTENSION_DESCRIPTION_LENGTH,
  MAX_EXTENSION_NAME_LENGTH,
} from '@dolphy-app/extension-api';
import type { ExtensionManifest } from '@dolphy-app/extension-api';
import type { ExtensionDiagnosticDto } from '@dolphy-app/engine-contract';
import { isSemver, parseRange } from '@dolphy-app/extension-catalog';
import { z } from 'zod';
import { localizedField } from './registrar-support.ts';

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
    main: safePath(['.mjs']).nullable().optional(),
    client: safePath(['.mjs']).nullable().optional(),
    name: localizedField(MAX_EXTENSION_NAME_LENGTH)
      .meta({
        description:
          'Name shown in the app: a string, or { "en": "...", "ru": "..." } (en is required and is the fallback).',
      })
      .optional(),
    description: localizedField(MAX_EXTENSION_DESCRIPTION_LENGTH)
      .meta({
        description:
          'What the extension does: a string, or { "en": "...", "ru": "..." } (en is required and is the fallback).',
      })
      .optional(),
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
    /** Вклады регистрирует код (`server`, `client`): ключ отвергается с подсказкой. */
    contributes: z
      .never({
        error:
          'contributions are registered in code (src/index.ts: server, client)',
      })
      .optional(),
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
  });

/** Применяет умолчания: части, которой нет, соответствует `null`. */
const normalizeManifest = (
  input: z.output<typeof manifestSchema>,
): ExtensionManifest => ({
  id: input.id,
  version: input.version,
  apiVersion: input.apiVersion,
  main: input.main ?? null,
  client: input.client ?? null,
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
});

interface FlatIssue {
  path: readonly PropertyKey[];
  message: string;
}

/** A text field (`name`, `description`) is a string or an object: report the branch the value was meant for. */
const flattenIssue = (
  issue: z.core.$ZodIssue,
  prefix: readonly PropertyKey[],
): FlatIssue[] => {
  const path = [...prefix, ...issue.path];
  if (issue.code !== 'invalid_union') return [{ path, message: issue.message }];
  const meant = issue.errors.find(
    (branch) =>
      !branch.some(
        (item) => item.code === 'invalid_type' && item.path.length === 0,
      ),
  );
  if (meant === undefined) {
    return [{ path, message: 'must be a string or { en, ru? }' }];
  }
  return meant.flatMap((item) => flattenIssue(item, path));
};

const zodIssues = (error: z.ZodError): string[] =>
  error.issues
    .flatMap((issue) => flattenIssue(issue, []))
    .map(({ path, message }) => `${path.join('.') || '/'}: ${message}`);

/** Разбор манифеста; ошибка — диагностика `manifest-invalid` (текст — `formatDiagnostic`). */
export const parseManifest = (
  raw: unknown,
):
  | { ok: true; manifest: ExtensionManifest }
  | { ok: false; diagnostic: ExtensionDiagnosticDto } => {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostic: {
        code: 'manifest-invalid',
        data: { issues: zodIssues(parsed.error) },
      },
    };
  }
  return { ok: true, manifest: normalizeManifest(parsed.data) };
};

/**
 * JSON Schema (2020-12) of `extension.json` for editors. It cannot express the
 * cross-field rules (duplicate platforms, tags and dependencies, a dependency
 * on the extension itself): `parseManifest` and `dolphy-ext validate` stay the
 * source of truth.
 */
export const manifestJsonSchema = (): Record<string, unknown> => ({
  ...z.toJSONSchema(manifestSchema, { io: 'input', unrepresentable: 'any' }),
  title: 'Dolphy extension manifest',
  description:
    'Editor aid for extension.json. It does not express cross-field rules (duplicate platforms, tags and dependencies); `dolphy-ext validate` and the app remain the source of truth.',
});
