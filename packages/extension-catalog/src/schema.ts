import {
  EXTENSION_ID_PATTERN,
  EXTENSION_PERMISSIONS,
  EXTENSION_PLATFORMS,
} from '@spirula-app/extension-api';
import { z } from 'zod';
import { CatalogFormatError } from './errors.ts';
import { compareSemver, isSemver, parseRange } from './semver.ts';

export const CATALOG_SCHEMA_VERSION = 1 as const;

export const MAX_VERSIONS = 5;
export const MAX_FILES = 50;
export const MAX_TOTAL_BYTES = 10_000_000;
const MAX_PATH_LENGTH = 200;
const FILE_EXTENSIONS = new Set(['json', 'js', 'mjs', 'md', 'txt']);
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const SHA256 = /^[0-9a-f]{64}$/;

const semver = z.string().refine(isSemver, 'must be semver x.y.z');
const timestamp = z.iso.datetime({ offset: true });
const httpsUrl = z
  .url()
  .refine((value) => value.startsWith('https://'), 'must be an https URL');

const isSafePath = (value: string): boolean => {
  if (value.length > MAX_PATH_LENGTH || value.includes('\\')) return false;
  const segments = value.split('/');
  if (segments.some((s) => s === '' || s.startsWith('.'))) return false;
  const name = segments[segments.length - 1] ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && FILE_EXTENSIONS.has(name.slice(dot + 1));
};

const filePath = z.string().refine(isSafePath, 'must be a safe relative path');

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
  baseUrl: httpsUrl.refine((v) => v.endsWith('/'), 'must end with /'),
  files: z
    .array(fileSchema)
    .max(MAX_FILES)
    .superRefine((files, ctx) => {
      const seen = new Set<string>();
      files.forEach((file, index) => {
        if (seen.has(file.path)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'path'],
            message: `duplicate path '${file.path}'`,
          });
        }
        seen.add(file.path);
      });
      if (!seen.has('extension.json')) {
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
  author: z.string().regex(GITHUB_LOGIN, 'must be a GitHub login'),
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
