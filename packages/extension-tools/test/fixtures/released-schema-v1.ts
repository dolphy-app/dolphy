/**
 * A frozen copy of the catalog index parser of the released app v0.2.0
 * (`packages/extension-catalog/src/{errors,semver,schema}.ts` and the constants of
 * `extension-api` at tag v0.2.0), made self-contained. Never update it to follow the
 * source: it stands for the apps already in users' hands, which parse `index.json` strictly
 * and reject the whole catalog on any unknown key, file type or permission.
 */
import { z } from 'zod';

const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const EXTENSION_PERMISSIONS = [
  'library.read',
  'process.spawn',
  'worker.threads',
  'native.addons',
  'network',
] as const;
const EXTENSION_PLATFORMS = ['darwin', 'linux', 'win32'] as const;

const MAX_ISSUES = 10;

export class CatalogFormatError extends Error {
  readonly issues: string[];

  constructor(issues: readonly string[]) {
    const kept = issues.slice(0, MAX_ISSUES);
    super(`invalid catalog: ${kept.join('; ')}`);
    this.name = 'CatalogFormatError';
    this.issues = kept;
  }
}


export interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly string[];
}

const NUMERIC = '(0|[1-9]\\d*)';
const SEMVER = new RegExp(
  `^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}(?:-([0-9A-Za-z.-]+))?$`,
);
const NUMERIC_ID = /^\d+$/;

export const parseSemver = (text: string): Semver | null => {
  const match = SEMVER.exec(text);
  if (match === null) return null;
  const [, major = '', minor = '', patch = '', pre] = match;
  const prerelease = pre === undefined ? [] : pre.split('.');
  const invalid = prerelease.some(
    (id) => id === '' || (NUMERIC_ID.test(id) && /^0\d/.test(id)),
  );
  if (invalid) return null;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease,
  };
};

export const isSemver = (text: string): boolean => parseSemver(text) !== null;

type Order = -1 | 0 | 1;

const sign = (difference: number): Order => {
  if (difference < 0) return -1;
  return difference > 0 ? 1 : 0;
};

const compareIdentifier = (a: string, b: string): Order => {
  const aNumeric = NUMERIC_ID.test(a);
  const bNumeric = NUMERIC_ID.test(b);
  if (aNumeric && bNumeric) return sign(Number(a) - Number(b));
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

const comparePrerelease = (
  a: readonly string[],
  b: readonly string[],
): Order => {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const common = Math.min(a.length, b.length);
  for (let i = 0; i < common; i++) {
    const order = compareIdentifier(a[i] ?? '', b[i] ?? '');
    if (order !== 0) return order;
  }
  return sign(a.length - b.length);
};

const compareParsed = (a: Semver, b: Semver): Order =>
  sign(a.major - b.major) ||
  sign(a.minor - b.minor) ||
  sign(a.patch - b.patch) ||
  comparePrerelease(a.prerelease, b.prerelease);

const mustParse = (text: string): Semver => {
  const parsed = parseSemver(text);
  if (parsed === null)
    throw new CatalogFormatError([`invalid semver '${text}'`]);
  return parsed;
};

export const compareSemver = (a: string, b: string): Order =>
  compareParsed(mustParse(a), mustParse(b));

type Operator = '<' | '<=' | '>=' | '>' | '=';

interface Comparator {
  operator: Operator;
  version: Semver;
}

const COMPARATOR = /^(<=|>=|<|>|=)?(.+)$/;

const satisfies: Record<Operator, (order: Order) => boolean> = {
  '<': (order) => order < 0,
  '<=': (order) => order <= 0,
  '>=': (order) => order >= 0,
  '>': (order) => order > 0,
  '=': (order) => order === 0,
};

const parseComparator = (token: string, range: string): Comparator => {
  const match = COMPARATOR.exec(token);
  const version = match?.[2] === undefined ? null : parseSemver(match[2]);
  if (match === null || version === null) {
    throw new CatalogFormatError([`invalid version range '${range}'`]);
  }
  return { operator: (match[1] ?? '=') as Operator, version };
};

export const parseRange = (range: string): readonly Comparator[] => {
  const tokens = range.split(' ').filter((token) => token !== '');
  if (tokens.length === 0 || range.trim() !== range) {
    throw new CatalogFormatError([`invalid version range '${range}'`]);
  }
  return tokens.map((token) => parseComparator(token, range));
};

export const satisfiesRange = (version: string, range: string): boolean => {
  const comparators = parseRange(range);
  const parsed = mustParse(version);
  return comparators.every(({ operator, version: bound }) =>
    satisfies[operator](compareParsed(parsed, bound)),
  );
};


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
