import path from 'node:path';
import { GITHUB_LOGIN_PATTERN } from '@dolphy-app/extension-api';
import { compareSemver, iconProblem } from '@dolphy-app/extension-catalog';
import type { CatalogEntry } from '@dolphy-app/extension-catalog';
import { bundleFindings, readBundleFiles } from '../lint/bundle.ts';
import { shortDescription } from '../lint/manifest.ts';
import { localeFindings } from '../locales.ts';
import { assetFindings } from './assets.ts';
import type { GithubUserChecker } from './github.ts';
import type { Tree } from './tree.ts';

export type Severity = 'error' | 'warning';

export interface Finding {
  severity: Severity;
  field: string;
  message: string;
}

export interface CheckedManifest {
  id: string;
  version: string;
  name: string | null;
  description: string | null;
  author: string | null;
  minAppVersion: string | null;
}

/**
 * Publication metadata from the raw `extension.json`; `null` — the file is not readable as JSON.
 * `name` and `description` are in English: a `%key%` is replaced by the text of `locales/en.json`.
 */
export interface DeclaredMetadata {
  name: string | null;
  description: string | null;
  author: string | null;
  /** `icon` path as written in the manifest. */
  icon: string | null;
}

export interface RuleContext {
  /** Extension directory name. */
  dirName: string;
  dir: string;
  manifest: CheckedManifest | null;
  declared: DeclaredMetadata | null;
  /** `extension.json` as written, parsed; `null` — not readable as JSON. */
  rawManifest: unknown;
  /** Why the manifest was not parsed; `null` if it was parsed. */
  manifestProblem: string | null;
  /** Sources without `node_modules`, `dist-ext`, `.dolphy` and `.git`. */
  tree: Tree;
  /** The built version `<siteDir>/extensions/<id>/<version>/` (`--built`); `null` — no `--built` or no parsed manifest. */
  bundleDir: string | null;
  /** `null` — no such file. */
  readText(file: string): Promise<string | null>;
  /** `null` — no such file. */
  readBytes(file: string): Promise<Uint8Array | null>;
  published: CatalogEntry | undefined;
  maxAppVersion: string | null;
  skipGithubCheck: boolean;
  checkGithubUser: GithubUserChecker;
}

export interface CheckRule {
  id: string;
  title: string;
  run(context: RuleContext): Promise<Finding[]> | Finding[];
}

export const MAX_SOURCE_FILES = 200;
export const MAX_SOURCE_BYTES = 5_000_000;
export const MAX_SOURCE_FILE_BYTES = 1_000_000;
export const LOCKFILES = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
] as const;
export const LIFECYCLE_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
] as const;
export const EXECUTABLE_EXTENSIONS = [
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.node',
  '.sh',
  '.bat',
] as const;
export const REQUIRED_SCOPE = '@dolphy-app';

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;
const NON_REGISTRY_SPECIFIER =
  /^(git[+:@]|github:|gitlab:|bitbucket:|gist:|https?:|file:|link:|workspace:|portal:|patch:|\.{0,2}\/|[\w.-]+\/[\w.-]+(#.*)?$)/;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

const error = (field: string, message: string): Finding => ({
  severity: 'error',
  field,
  message,
});

const warning = (field: string, message: string): Finding => ({
  severity: 'warning',
  field,
  message,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readPackageJson = async (
  context: RuleContext,
): Promise<Record<string, unknown> | null> => {
  const text = await context.readText('package.json');
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const manifestValid: CheckRule = {
  id: 'CHECK-001',
  title: 'extension.json is readable and passes manifest parsing',
  run: ({ manifestProblem }) =>
    manifestProblem === null ? [] : [error('extension.json', manifestProblem)],
};

const directoryName: CheckRule = {
  id: 'CHECK-002',
  title: 'directory name equals the manifest id',
  run: ({ manifest, dirName }) =>
    manifest === null || manifest.id === dirName
      ? []
      : [
          error(
            'id',
            `directory name '${dirName}' does not match manifest id '${manifest.id}'`,
          ),
        ],
};

const textFinding = (
  field: string,
  value: string | null,
  maxLength: number,
): Finding[] => {
  if (value === null || value.trim() === '') {
    return [error(field, `'${field}' is required for publication`)];
  }
  return value.length > maxLength
    ? [error(field, `'${field}' is longer than ${maxLength} characters`)]
    : [];
};

const publicationMetadata: CheckRule = {
  id: 'CHECK-003',
  title: 'name, description and author are set',
  run: ({ declared }) =>
    declared === null
      ? []
      : [
          ...textFinding('name', declared.name, MAX_NAME_LENGTH),
          ...textFinding(
            'description',
            declared.description,
            MAX_DESCRIPTION_LENGTH,
          ),
          ...textFinding('author', declared.author, Infinity),
        ],
};

const readme: CheckRule = {
  id: 'CHECK-004',
  title: 'README.md exists and is not empty',
  run: async (context) => {
    const text = await context.readText('README.md');
    return text === null || text.trim() === ''
      ? [error('README.md', 'README.md is missing or empty')]
      : [];
  },
};

const isLogin = (author: string): boolean => GITHUB_LOGIN_PATTERN.test(author);

const authorLogin: CheckRule = {
  id: 'CHECK-005',
  title: 'author has the shape of a GitHub login',
  run: ({ declared }) =>
    declared?.author && !isLogin(declared.author)
      ? [error('author', `'${declared.author}' is not a GitHub login`)]
      : [],
};

const authorExists: CheckRule = {
  id: 'CHECK-006',
  title: 'author is an existing GitHub user',
  run: async ({ declared, skipGithubCheck, checkGithubUser }) => {
    const author = declared?.author;
    if (skipGithubCheck || !author || !isLogin(author)) return [];
    const status = await checkGithubUser(author);
    if (status === 'missing') {
      return [error('author', `GitHub user '${author}' does not exist`)];
    }
    return status === 'unknown'
      ? [warning('author', `could not verify GitHub user '${author}'`)]
      : [];
  },
};

const packageJson: CheckRule = {
  id: 'CHECK-007',
  title: 'package.json exists and parses',
  run: async (context) => {
    const text = await context.readText('package.json');
    if (text === null)
      return [error('package.json', 'package.json is missing')];
    return (await readPackageJson(context)) === null
      ? [error('package.json', 'package.json is not a valid JSON object')]
      : [];
  },
};

const lockfile: CheckRule = {
  id: 'CHECK-008',
  title: 'a dependency lock file exists',
  run: ({ tree }) =>
    LOCKFILES.some((name) => tree.files.some((file) => file.path === name))
      ? []
      : [error('package.json', `no lockfile (${LOCKFILES.join(', ')})`)],
};

const lifecycleScripts: CheckRule = {
  id: 'CHECK-009',
  title: 'no install or publish lifecycle scripts',
  run: async (context) => {
    const scripts = (await readPackageJson(context))?.scripts;
    if (!isRecord(scripts)) return [];
    return LIFECYCLE_SCRIPTS.filter((name) => name in scripts).map((name) =>
      error(`scripts.${name}`, `lifecycle script '${name}' is not allowed`),
    );
  },
};

const registryDependencies: CheckRule = {
  id: 'CHECK-010',
  title:
    'dependencies come only from the registry (no git, http, file, link, workspace)',
  run: async (context) => {
    const manifest = await readPackageJson(context);
    if (manifest === null) return [];
    return DEPENDENCY_FIELDS.flatMap((field) => {
      const section = manifest[field];
      if (!isRecord(section)) return [];
      return Object.entries(section)
        .filter(
          ([, spec]) =>
            typeof spec !== 'string' ||
            NON_REGISTRY_SPECIFIER.test(spec.trim()),
        )
        .map(([name, spec]) =>
          error(
            `${field}.${name}`,
            `specifier '${String(spec)}' is not a registry range`,
          ),
        );
    });
  },
};

const packageScope: CheckRule = {
  id: 'CHECK-011',
  title: "package.json name does not take another's scope",
  run: async (context) => {
    const name = (await readPackageJson(context))?.name;
    if (typeof name !== 'string' || !name.startsWith('@')) return [];
    return name.startsWith(`${REQUIRED_SCOPE}/`)
      ? []
      : [
          warning(
            'name',
            `package scope of '${name}' is not ${REQUIRED_SCOPE}`,
          ),
        ];
  },
};

const newerThanPublished: CheckRule = {
  id: 'CHECK-012',
  title: 'version is strictly greater than the published one',
  run: ({ manifest, published }) => {
    if (manifest === null || published === undefined) return [];
    const { version } = manifest;
    if (published.versions.some((item) => item.version === version)) {
      return [error('version', `version ${version} is already published`)];
    }
    const newest = published.versions[0]?.version;
    return newest !== undefined && compareSemver(version, newest) < 0
      ? [
          error(
            'version',
            `version ${version} is not greater than published ${newest}`,
          ),
        ]
      : [];
  },
};

const sourceLimits: CheckRule = {
  id: 'CHECK-013',
  title: `at most ${MAX_SOURCE_FILES} files and 5 MB of sources, no file over 1 MB`,
  run: ({ tree }) => {
    const findings: Finding[] = [];
    const total = tree.files.reduce((sum, file) => sum + file.size, 0);
    if (tree.files.length > MAX_SOURCE_FILES) {
      findings.push(
        error(
          'files',
          `${tree.files.length} files exceed the limit of ${MAX_SOURCE_FILES}`,
        ),
      );
    }
    if (total > MAX_SOURCE_BYTES) {
      findings.push(
        error(
          'files',
          `${total} bytes exceed the limit of ${MAX_SOURCE_BYTES}`,
        ),
      );
    }
    for (const file of tree.files) {
      if (file.size > MAX_SOURCE_FILE_BYTES) {
        findings.push(
          error(
            file.path,
            `file is ${file.size} bytes, limit is ${MAX_SOURCE_FILE_BYTES}`,
          ),
        );
      }
    }
    return findings;
  },
};

const noSymlinks: CheckRule = {
  id: 'CHECK-014',
  title: 'no symbolic links',
  run: ({ tree }) =>
    tree.symlinks.map((link) => error(link, 'symbolic links are not allowed')),
};

const noExecutables: CheckRule = {
  id: 'CHECK-015',
  title: `no executable files (${EXECUTABLE_EXTENSIONS.join(', ')})`,
  run: ({ tree }) =>
    tree.files
      .filter((file) =>
        (EXECUTABLE_EXTENSIONS as readonly string[]).includes(
          path.posix.extname(file.path).toLowerCase(),
        ),
      )
      .map((file) => error(file.path, 'executable files are not allowed')),
};

const appVersionBound: CheckRule = {
  id: 'CHECK-016',
  title: 'minAppVersion is not newer than --max-app-version',
  run: ({ manifest, maxAppVersion }) =>
    manifest?.minAppVersion &&
    maxAppVersion !== null &&
    compareSemver(manifest.minAppVersion, maxAppVersion) > 0
      ? [
          error(
            'minAppVersion',
            `minAppVersion ${manifest.minAppVersion} is newer than the released app ${maxAppVersion}`,
          ),
        ]
      : [],
};

const ASSETS_DIR = 'assets/';

const assetFiles: CheckRule = {
  id: 'CHECK-017',
  title:
    'files in assets/ match their type: signature, size limits, pixels, safe SVG and CSS',
  run: async ({ dir, tree }) =>
    (
      await assetFindings(
        dir,
        tree.files
          .map((file) => file.path)
          .filter((file) => file.startsWith(ASSETS_DIR)),
      )
    ).map(({ path: file, message }) => error(file, message)),
};

const iconFile: CheckRule = {
  id: 'CHECK-018',
  title: 'icon is a square 64–512 px PNG or WebP file up to 16 KiB',
  run: async ({ declared, readBytes }) => {
    const icon = declared?.icon;
    if (icon === null || icon === undefined) return [];
    const bytes = await readBytes(icon);
    if (bytes === null) return [error('icon', `icon '${icon}' is not a file`)];
    const problem = iconProblem(icon, bytes);
    return problem === null ? [] : [error('icon', problem)];
  },
};

const shortDescriptionRule: CheckRule = {
  id: 'CHECK-019',
  title: 'description is at least 20 characters',
  run: ({ declared }) =>
    shortDescription(declared?.description ?? null).map((finding) =>
      warning(finding.field, finding.message),
    ),
};

export const MAX_CHANGELOG_BYTES = 64 * 1024;

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Why the bytes are no acceptable `CHANGELOG.md` (over 64 KiB, not UTF-8, NUL); `null` — fine. */
export const changelogProblem = (bytes: Uint8Array): string | null => {
  if (bytes.length > MAX_CHANGELOG_BYTES) {
    return `${bytes.length} bytes exceed the limit of ${MAX_CHANGELOG_BYTES}`;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\0') ? 'contains NUL characters' : null;
  } catch {
    return 'is not valid UTF-8';
  }
};

/** CHANGELOG.md: up to 64 KiB, UTF-8 without NUL; a missing section of the manifest version is a warning. */
const changelog: CheckRule = {
  id: 'CHECK-030',
  title:
    'CHANGELOG.md is up to 64 KiB of UTF-8 text and has a section of the current version',
  run: async ({ readBytes, manifest }) => {
    const bytes = await readBytes('CHANGELOG.md');
    if (bytes === null) return [];
    const problem = changelogProblem(bytes);
    if (problem !== null) return [error('CHANGELOG.md', problem)];
    const text = new TextDecoder().decode(bytes);
    if (manifest === null) return [];
    const heading = new RegExp(
      `^##[ \\t]+\\[?v?${escapeRegExp(manifest.version)}\\]?(?:[ \\t]|$)`,
      'm',
    );
    return heading.test(text)
      ? []
      : [
          warning(
            'CHANGELOG.md',
            `has no '## ${manifest.version}' section for the current version`,
          ),
        ];
  },
};

const translations: CheckRule = {
  id: 'CHECK-026',
  title:
    'locales/*.json: en is complete, texts fit their fields, files are valid',
  run: ({ rawManifest, tree, readText }) =>
    rawManifest === null
      ? []
      : localeFindings({
          manifest: rawManifest,
          files: tree.files.map((file) => file.path),
          read: readText,
        }),
};

const firstPublisherOwnsId: CheckRule = {
  id: 'CHECK-021',
  title: 'the id is not published under another author',
  run: ({ declared, published }) => {
    const author = declared?.author;
    if (!author || published === undefined) return [];
    return published.author.toLowerCase() === author.toLowerCase()
      ? []
      : [
          error(
            'author',
            `id '${published.id}' is published by '${published.author}': the first publisher owns the id`,
          ),
        ];
  },
};

const NO_BUNDLE =
  'built version is not found: the bundle heuristics are skipped';

/** `CHECK-022`…`CHECK-025`: heuristics over the built version; silent without `--built`. */
const bundleRule = (
  id: string,
  title: string,
  missingBundle = false,
): CheckRule => ({
  id,
  title,
  run: async ({ bundleDir, manifest }) => {
    if (bundleDir === null || manifest === null) return [];
    const files = await readBundleFiles(bundleDir).catch(() => null);
    if (files === null) {
      return missingBundle
        ? [warning('--built', `${NO_BUNDLE} (${bundleDir})`)]
        : [];
    }
    return bundleFindings(files)
      .filter((finding) => finding.ruleId === id)
      .map(({ severity, field, message }) => ({ severity, field, message }));
  },
});

export const RULES: readonly CheckRule[] = [
  manifestValid,
  directoryName,
  publicationMetadata,
  readme,
  authorLogin,
  authorExists,
  packageJson,
  lockfile,
  lifecycleScripts,
  registryDependencies,
  packageScope,
  newerThanPublished,
  sourceLimits,
  noSymlinks,
  noExecutables,
  appVersionBound,
  assetFiles,
  iconFile,
  shortDescriptionRule,
  firstPublisherOwnsId,
  bundleRule('CHECK-022', 'built code does not execute dynamic code', true),
  bundleRule('CHECK-023', 'built code is not obfuscated'),
  bundleRule('CHECK-025', 'built code has no embedded source map'),
  translations,
  changelog,
];
