import {
  EXTENSION_ID_PATTERN,
  EXTENSION_PERMISSIONS,
  EXTENSION_PLATFORMS,
  GITHUB_LOGIN_PATTERN,
} from '@dolphy-app/extension-api';
import { z } from 'zod';
import { CatalogFormatError } from './errors.ts';
import { compareSemver, isSemver, parseRange } from './semver.ts';

export const CATALOG_SCHEMA_VERSION = 1 as const;

export const MAX_VERSIONS = 5;
export const MAX_FILES = 50;
export const MAX_TOTAL_BYTES = 10_000_000;
const MAX_PATH_LENGTH = 200;
export const CATALOG_FILE_EXTENSIONS: readonly string[] = [
  'json',
  'js',
  'mjs',
  'md',
  'txt',
];
const FILE_EXTENSIONS = new Set(CATALOG_FILE_EXTENSIONS);
const SHA256 = /^[0-9a-f]{64}$/;
/** Допустимые символы сегмента пути: без `:` (потоки NTFS), пробелов и управляющих символов. */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
/** Имена устройств Windows: недоступны как файлы, с расширением или без. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const semver = z.string().refine(isSemver, 'must be semver');
const timestamp = z.iso.datetime({ offset: true });
const httpsUrl = z
  .url()
  .refine((value) => value.startsWith('https://'), 'must be an https URL');

const isSafeSegment = (segment: string): boolean =>
  SEGMENT.test(segment) &&
  !segment.endsWith('.') &&
  !RESERVED_NAME.test(segment);

/** Путь файла версии: безопасные сегменты и расширение из `FILE_EXTENSIONS`. */
export const isSafeCatalogPath = (value: string): boolean => {
  if (value.length > MAX_PATH_LENGTH) return false;
  const segments = value.split('/');
  if (!segments.every(isSafeSegment)) return false;
  const name = segments[segments.length - 1] ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && FILE_EXTENSIONS.has(name.slice(dot + 1));
};

const filePath = z
  .string()
  .refine(isSafeCatalogPath, 'must be a safe relative path');

/**
 * Каталог файлов версии относительно адреса `index.json` (`extensions/<id>/<version>/`).
 * Абсолютный адрес не допускается: файлы версии по построению лежат на origin индекса,
 * а локальный каталог разработчика и e2e не требуют https.
 */
const baseUrl = z
  .string()
  .max(MAX_PATH_LENGTH)
  .refine(
    (value) =>
      value.endsWith('/') && value.slice(0, -1).split('/').every(isSafeSegment),
    'must be a relative directory path ending with /',
  );

const fileSchema = z.strictObject({
  path: filePath,
  size: z.number().int().min(0).max(MAX_TOTAL_BYTES),
  sha256: z.string().regex(SHA256, 'must be lowercase hex sha256'),
});

const extensionId = z
  .string()
  .max(64)
  .regex(EXTENSION_ID_PATTERN, 'invalid extension id');

const versionSchema = z.strictObject({
  version: semver,
  apiVersion: z.number().int().min(1),
  minAppVersion: semver.nullable(),
  permissions: z.array(z.enum(EXTENSION_PERMISSIONS)),
  publishedAt: timestamp,
  baseUrl,
  files: z
    .array(fileSchema)
    .max(MAX_FILES)
    .superRefine((files, ctx) => {
      // Имена сравниваются без учёта регистра: на macOS и Windows `Main.mjs` и `main.mjs` — один файл.
      const seen = new Set<string>();
      files.forEach((file, index) => {
        const key = file.path.toLowerCase();
        if (seen.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'path'],
            message: `duplicate path '${file.path}'`,
          });
        }
        seen.add(key);
      });
      files.forEach((file, index) => {
        const segments = file.path.toLowerCase().split('/');
        for (let depth = 1; depth < segments.length; depth++) {
          if (seen.has(segments.slice(0, depth).join('/'))) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'path'],
              message: `'${file.path}' lies inside a file`,
            });
            break;
          }
        }
      });
      if (!files.some((file) => file.path === 'extension.json')) {
        ctx.addIssue({ code: 'custom', message: 'extension.json is required' });
      }
      const total = files.reduce((sum, file) => sum + file.size, 0);
      if (total > MAX_TOTAL_BYTES) {
        ctx.addIssue({
          code: 'custom',
          message: `total size ${total} exceeds ${MAX_TOTAL_BYTES}`,
        });
      }
    }),
});

const contributesSchema = z.strictObject({
  exerciseTypes: z.array(z.string()),
  themes: z.array(z.string()),
  markdownRenderers: z.array(z.string()),
  gradePolicies: z.array(z.string()),
  settings: z.array(z.string()).optional(),
  events: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
  panels: z.array(z.string()).optional(),
});

const descendingUnique = (
  versions: readonly { version: string }[],
  ctx: z.RefinementCtx,
): void => {
  for (let i = 1; i < versions.length; i++) {
    const previous = versions[i - 1]?.version ?? '';
    const current = versions[i]?.version ?? '';
    if (previous === current) {
      ctx.addIssue({
        code: 'custom',
        path: [i, 'version'],
        message: `duplicate version '${current}'`,
      });
    } else if (isSemver(previous) && isSemver(current)) {
      if (compareSemver(previous, current) < 0) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'version'],
          message: 'versions must be sorted newest first',
        });
      }
    }
  }
};

const entrySchema = z.strictObject({
  id: extensionId,
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  author: z.string().regex(GITHUB_LOGIN_PATTERN, 'must be a GitHub login'),
  source: httpsUrl,
  platforms: z.array(z.enum(EXTENSION_PLATFORMS)),
  contributes: contributesSchema,
  versions: z
    .array(versionSchema)
    .min(1)
    .max(MAX_VERSIONS)
    .superRefine(descendingUnique),
});

const rangeText = z.string().superRefine((value, ctx) => {
  try {
    parseRange(value);
  } catch (error) {
    if (!(error instanceof CatalogFormatError)) throw error;
    ctx.addIssue({ code: 'custom', message: 'invalid version range' });
  }
});

const revokedSchema = z.strictObject({
  id: extensionId,
  versions: rangeText,
  reason: z.string().min(1).max(300),
});

export const indexSchema = z.strictObject({
  schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
  generatedAt: timestamp,
  extensions: z.array(entrySchema),
  revoked: z.array(revokedSchema),
});

export type CatalogIndex = z.infer<typeof indexSchema>;
export type CatalogEntry = z.infer<typeof entrySchema>;
export type CatalogVersion = z.infer<typeof versionSchema>;
export type CatalogFile = z.infer<typeof fileSchema>;
export type RevokedEntry = z.infer<typeof revokedSchema>;

export const parseIndex = (raw: unknown): CatalogIndex => {
  const parsed = indexSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new CatalogFormatError(
    parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '/'}: ${issue.message}`,
    ),
  );
};
