import {
  EXTENSION_ID_PATTERN,
  EXTENSION_PERMISSIONS,
  EXTENSION_PLATFORMS,
  EXTENSION_TAGS,
  GITHUB_LOGIN_PATTERN,
} from '@dolphy-app/extension-api';
import type { ExtensionTag } from '@dolphy-app/extension-api';
import { z } from 'zod';
import {
  CATALOG_FILE_EXTENSIONS,
  ICON_URI_PATTERN,
  LEGACY_FILE_EXTENSIONS,
  MAX_FILES_V2,
  MAX_ICON_URI_LENGTH,
  extensionOf,
  sizeProblem,
} from './assets.ts';
import { CatalogFormatError } from './errors.ts';
import { compareSemver, isSemver, parseRange } from './semver.ts';

/** Format of `index.json`: parsed by every released app, strictly. */
export const LEGACY_SCHEMA_VERSION = 1 as const;
/** Format of `index.v2.json`: asset file types, icons, up to `MAX_FILES_V2` files. */
export const CATALOG_SCHEMA_VERSION = 2 as const;

export const MAX_VERSIONS = 5;
export const MAX_FILES = 50;
export const MAX_TOTAL_BYTES = 10_000_000;
/** Longest contribution title in `titles` (the manifest limit of `label`/`title`). */
const MAX_TITLE_LENGTH = 60;
/** Most tags of a version. */
export const MAX_TAGS = 5;
/** Contribution points whose entries carry a human title in the manifest (`label` or `title`). */
export const TITLED_POINTS = [
  'themes',
  'gradePolicies',
  'settings',
  'commands',
  'panels',
] as const;
export type TitledPoint = (typeof TITLED_POINTS)[number];
/** Contribution titles of an entry: point → id → title. */
export type ContributionTitles = Partial<
  Record<TitledPoint, Record<string, string>>
>;
const MAX_PATH_LENGTH = 200;
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

/** Путь файла версии: безопасные сегменты и расширение из `extensions`. */
const isSafePathWith = (
  value: string,
  extensions: readonly string[],
): boolean => {
  if (value.length > MAX_PATH_LENGTH) return false;
  const segments = value.split('/');
  if (!segments.every(isSafeSegment)) return false;
  const extension = extensionOf(value);
  return extension !== null && extensions.includes(extension);
};

/** Path of a version file in the full index: safe segments, an allowed extension. */
export const isSafeCatalogPath = (value: string): boolean =>
  isSafePathWith(value, CATALOG_FILE_EXTENSIONS);

/** Path of a version file in the first format (`index.json`). */
export const isLegacyCatalogPath = (value: string): boolean =>
  isSafePathWith(value, LEGACY_FILE_EXTENSIONS);

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

const extensionId = z
  .string()
  .max(64)
  .regex(EXTENSION_ID_PATTERN, 'invalid extension id');

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

/** What differs between the two formats and the tolerant reader. */
interface Profile {
  schemaVersion: 1 | 2;
  maxFiles: number;
  extensions: readonly string[];
  /** The `icon` key of a version; the first format does not know it. */
  icon: boolean;
  /** The `titles` key of an entry; the first format does not know it. */
  titles: boolean;
  /** The `tags` key of a version; the first format does not know it. */
  tags: boolean;
  /** `false` — unknown keys are dropped instead of rejected. */
  strict: boolean;
}

const object = <T extends z.ZodRawShape>(
  profile: Profile,
  shape: T,
): z.ZodObject<T> =>
  (profile.strict
    ? z.strictObject(shape)
    : z.object(shape)) as unknown as z.ZodObject<T>;

const fileSchemaOf = (profile: Profile) =>
  object(profile, {
    path: z
      .string()
      .refine(
        (value) => isSafePathWith(value, profile.extensions),
        'must be a safe relative path',
      ),
    size: z.number().int().min(0).max(MAX_TOTAL_BYTES),
    sha256: z.string().regex(SHA256, 'must be lowercase hex sha256'),
  }).superRefine((file, ctx) => {
    const problem = sizeProblem(file.path, file.size);
    if (problem !== null) ctx.addIssue({ code: 'custom', message: problem });
  });

const filesSchemaOf = (profile: Profile) =>
  z
    .array(fileSchemaOf(profile))
    .max(profile.maxFiles)
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
    });

const strictTags = z
  .array(z.enum(EXTENSION_TAGS))
  .max(MAX_TAGS)
  .superRefine((tags, ctx) => {
    tags.forEach((tag, index) => {
      if (tags.indexOf(tag) !== index) {
        ctx.addIssue({
          code: 'custom',
          path: [index],
          message: `duplicate tag '${tag}'`,
        });
      }
    });
  });

const knownTags: readonly string[] = EXTENSION_TAGS;

const tolerantTags = z
  .array(z.string())
  .transform((tags) =>
    [...new Set(tags.filter((tag) => knownTags.includes(tag)))].slice(
      0,
      MAX_TAGS,
    ),
  )
  .catch([]);

const tagsSchemaOf = (
  profile: Profile,
): z.ZodOptional<z.ZodType<ExtensionTag[]>> =>
  (profile.strict ? strictTags : tolerantTags).optional() as z.ZodOptional<
    z.ZodType<ExtensionTag[]>
  >;

const versionSchemaOf = (profile: Profile) =>
  object(profile, {
    version: semver,
    apiVersion: z.number().int().min(1),
    minAppVersion: semver.nullable(),
    permissions: z.array(z.enum(EXTENSION_PERMISSIONS)),
    publishedAt: timestamp,
    baseUrl,
    files: filesSchemaOf(profile),
    /** The icon of the version as a `data:` URI; the file itself is among `files`. */
    icon: z
      .string()
      .max(MAX_ICON_URI_LENGTH)
      .regex(ICON_URI_PATTERN)
      .optional(),
    /** Explicit tags of the version (a closed vocabulary); the tolerant reader drops the ones it does not know. */
    tags: tagsSchemaOf(profile),
  }).superRefine((version, ctx) => {
    if (!profile.tags && version.tags !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['tags'],
        message: 'tags is not part of this index format',
      });
    }
    if (!profile.icon && version.icon !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['icon'],
        message: 'icon is not part of this index format',
      });
    }
  });

const contributesSchemaOf = (profile: Profile) =>
  object(profile, {
    exerciseTypes: z.array(z.string()),
    themes: z.array(z.string()),
    markdownRenderers: z.array(z.string()),
    gradePolicies: z.array(z.string()),
    settings: z.array(z.string()).optional(),
    events: z.array(z.string()).optional(),
    commands: z.array(z.string()).optional(),
    panels: z.array(z.string()).optional(),
  });

const titleMap = z.record(extensionId, z.string().min(1).max(MAX_TITLE_LENGTH));

/** Titles of the contributions by point; an unreadable map is dropped by the tolerant reader, the entry stays. */
const titlesSchemaOf = (
  profile: Profile,
): z.ZodOptional<z.ZodType<ContributionTitles>> => {
  const schema = object(
    profile,
    Object.fromEntries(
      TITLED_POINTS.map((point) => [point, titleMap.optional()]),
    ),
  ).optional();
  return (
    profile.strict ? schema : schema.catch(undefined).optional()
  ) as z.ZodOptional<z.ZodType<ContributionTitles>>;
};

const entryHeadOf = (profile: Profile) => ({
  id: extensionId,
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  author: z.string().regex(GITHUB_LOGIN_PATTERN, 'must be a GitHub login'),
  source: httpsUrl,
  platforms: z.array(z.enum(EXTENSION_PLATFORMS)),
  contributes: contributesSchemaOf(profile),
  titles: titlesSchemaOf(profile),
});

const entrySchemaOf = (profile: Profile) =>
  object(profile, {
    ...entryHeadOf(profile),
    versions: z
      .array(versionSchemaOf(profile))
      .min(1)
      .max(MAX_VERSIONS)
      .superRefine(descendingUnique),
  }).superRefine((entry, ctx) => {
    if (entry.titles === undefined) return;
    if (!profile.titles) {
      ctx.addIssue({
        code: 'custom',
        path: ['titles'],
        message: 'titles is not part of this index format',
      });
      return;
    }
    if (!profile.strict) return;
    for (const point of TITLED_POINTS) {
      const known = new Set<string>(entry.contributes[point] ?? []);
      for (const id of Object.keys(entry.titles[point] ?? {})) {
        if (!known.has(id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['titles', point, id],
            message: `title for '${id}', which is not in contributes.${point}`,
          });
        }
      }
    }
  });

const indexSchemaOf = (profile: Profile) =>
  object(profile, {
    schemaVersion: z.literal(profile.schemaVersion),
    generatedAt: timestamp,
    extensions: z.array(entrySchemaOf(profile)),
    revoked: z.array(revokedSchema),
  });

const LEGACY_PROFILE: Profile = {
  schemaVersion: LEGACY_SCHEMA_VERSION,
  maxFiles: MAX_FILES,
  extensions: LEGACY_FILE_EXTENSIONS,
  icon: false,
  titles: false,
  tags: false,
  strict: true,
};

const FULL_PROFILE: Profile = {
  schemaVersion: CATALOG_SCHEMA_VERSION,
  maxFiles: MAX_FILES_V2,
  extensions: CATALOG_FILE_EXTENSIONS,
  icon: true,
  titles: true,
  tags: true,
  strict: true,
};

/** Reader of the app: the limits of the full format, unknown keys dropped. */
const TOLERANT_PROFILE: Profile = { ...FULL_PROFILE, strict: false };

/** `index.json`: the first format. */
export const legacyIndexSchema = indexSchemaOf(LEGACY_PROFILE);
/** `index.v2.json`: the full format. */
export const indexSchema = indexSchemaOf(FULL_PROFILE);

export type CatalogIndex = z.infer<typeof indexSchema>;
export type CatalogEntry = CatalogIndex['extensions'][number];
export type CatalogVersion = CatalogEntry['versions'][number];
export type CatalogFile = CatalogVersion['files'][number];
export type RevokedEntry = CatalogIndex['revoked'][number];

const describeIssues = (error: z.ZodError, prefix = ''): string[] =>
  error.issues.map(
    (issue) => `${prefix}${issue.path.join('.') || '/'}: ${issue.message}`,
  );

const isLegacyIndex = (raw: unknown): boolean =>
  typeof raw === 'object' &&
  raw !== null &&
  'schemaVersion' in raw &&
  raw.schemaVersion === LEGACY_SCHEMA_VERSION;

/**
 * Strict parse for the author tools: unknown keys, file types and limits fail.
 * Both formats are accepted; `schemaVersion` chooses the rules.
 * Throws `CatalogFormatError`.
 */
export const parseIndex = (raw: unknown): CatalogIndex => {
  const schema = isLegacyIndex(raw) ? legacyIndexSchema : indexSchema;
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new CatalogFormatError(describeIssues(parsed.error));
};

export interface LenientIndex {
  index: CatalogIndex;
  /** Entries and versions the reader dropped, for the log. */
  warnings: string[];
}

const tolerantHead = object(TOLERANT_PROFILE, {
  schemaVersion: z.union([
    z.literal(LEGACY_SCHEMA_VERSION),
    z.literal(CATALOG_SCHEMA_VERSION),
  ]),
  generatedAt: timestamp,
  extensions: z.array(z.unknown()),
  revoked: z.array(revokedSchema),
});
const tolerantEntry = object(TOLERANT_PROFILE, {
  ...entryHeadOf(TOLERANT_PROFILE),
  versions: z.array(z.unknown()),
});
const tolerantVersion = versionSchemaOf(TOLERANT_PROFILE);

const tolerantEntryOf = (
  raw: unknown,
  label: string,
  warnings: string[],
): CatalogEntry | null => {
  const head = tolerantEntry.safeParse(raw);
  if (!head.success) {
    warnings.push(...describeIssues(head.error, `${label}: `));
    return null;
  }
  const { versions: rawVersions, ...rest } = head.data;
  const id = rest.id;
  const versions: CatalogVersion[] = [];
  rawVersions.forEach((item, position) => {
    const parsed = tolerantVersion.safeParse(item);
    if (parsed.success) versions.push(parsed.data);
    else {
      warnings.push(
        ...describeIssues(
          parsed.error,
          `${label} '${id}' version #${position}: `,
        ),
      );
    }
  });
  if (versions.length === 0) {
    warnings.push(`${label} '${id}': no version could be read`);
    return null;
  }
  versions.sort((a, b) => compareSemver(b.version, a.version));
  const unique = versions.filter(
    (item, position) =>
      position === 0 || item.version !== versions[position - 1]?.version,
  );
  if (unique.length > MAX_VERSIONS) {
    warnings.push(
      `${label} '${id}': only the newest ${MAX_VERSIONS} versions are kept`,
    );
  }
  return { ...rest, versions: unique.slice(0, MAX_VERSIONS) };
};

/**
 * Tolerant parse for the app: an entry or a version it cannot understand is skipped
 * with a warning instead of rejecting the catalog; unknown keys are dropped.
 * The revocation list stays strict — a revocation that cannot be read must not vanish.
 * Throws `CatalogFormatError` when the index as a whole is unusable.
 */
export const parseIndexLenient = (raw: unknown): LenientIndex => {
  const head = tolerantHead.safeParse(raw);
  if (!head.success) throw new CatalogFormatError(describeIssues(head.error));
  const warnings: string[] = [];
  const extensions: CatalogEntry[] = [];
  head.data.extensions.forEach((item, position) => {
    const entry = tolerantEntryOf(item, `extension #${position}`, warnings);
    if (entry !== null) extensions.push(entry);
  });
  return {
    index: {
      schemaVersion: head.data.schemaVersion,
      generatedAt: head.data.generatedAt,
      extensions,
      revoked: head.data.revoked,
    },
    warnings,
  };
};
