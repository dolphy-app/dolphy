import path from 'node:path';
import { GITHUB_LOGIN_PATTERN } from '@dolphy-app/extension-api';
import { compareSemver } from '@dolphy-app/extension-catalog';
import type { CatalogEntry } from '@dolphy-app/extension-catalog';
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

/** Publication metadata from the raw `extension.json`; `null` — the file is not readable as JSON. */
export interface DeclaredMetadata {
  name: string | null;
  description: string | null;
  author: string | null;
}

export interface RuleContext {
  /** Extension directory name. */
  dirName: string;
  dir: string;
  manifest: CheckedManifest | null;
  declared: DeclaredMetadata | null;
  /** Why the manifest was not parsed; `null` if it was parsed. */
  manifestProblem: string | null;
  /** Sources without `node_modules`, `dist-ext`, `.dolphy` and `.git`. */
  tree: Tree;
  /** `null` — no such file. */
  readText(file: string): Promise<string | null>;
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
  title: 'dependencies come only from the registry (no git, http, file, link, workspace)',
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
];
