import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EXTENSION_ID_PATTERN } from '@dolphy-app/extension-api';
import * as common from './templates/common.ts';
import type {
  TemplateInput,
  TemplateModule,
  TemplateName,
} from './templates/common.ts';
import { TEMPLATE_NAMES } from './templates/common.ts';
import { blank } from './templates/blank.ts';
import { commandPanel } from './templates/command-panel.ts';
import { events } from './templates/events.ts';
import { exercise } from './templates/exercise.ts';
import { reactPanel } from './templates/react-panel.ts';
import { theme } from './templates/theme.ts';

export { TEMPLATE_NAMES } from './templates/common.ts';
export type { TemplateName } from './templates/common.ts';

const TEMPLATES: Record<TemplateName, TemplateModule> = {
  exercise,
  theme,
  'command-panel': commandPanel,
  'react-panel': reactPanel,
  events,
  blank,
};

export const isTemplateName = (name: string): name is TemplateName =>
  (TEMPLATE_NAMES as readonly string[]).includes(name);

/** Matches the manifest limit (`parseManifest`). */
const MAX_ID_CHARS = 64;
/** Without a build (sources, `--local`) the package version is a placeholder. */
export const UNPUBLISHED_VERSION = '^0.0.0';

/** Injected by the `tools/build-packages.mjs` build; undefined in sources. */
declare const __DOLPHY_PACKAGE_VERSION__: string | undefined;

const builtPackageVersion = (): string | null =>
  typeof __DOLPHY_PACKAGE_VERSION__ === 'string'
    ? __DOLPHY_PACKAGE_VERSION__
    : null;

export type GenerateErrorCode =
  'invalid-id' | 'invalid-local' | 'invalid-template' | 'target-not-empty';

export class GenerateError extends Error {
  readonly code: GenerateErrorCode;

  constructor(code: GenerateErrorCode, message: string) {
    super(message);
    this.name = 'GenerateError';
    this.code = code;
  }
}

export interface GenerateOptions {
  dir: string;
  /** Defaults to kebab-case of the directory name. */
  id?: string;
  /** Project kind; defaults to `exercise`. */
  template?: string;
  /** Dolphy repository root: dependencies are written as `link:<root>/packages/...`. */
  localRoot?: string;
  /** Version of the published packages; defaults to the generator's own version from the build. */
  packageVersion?: string;
}

export interface GenerateResult {
  /** Absolute path of the created project. */
  dir: string;
  /** Relative paths (`/` separator), ascending. */
  files: string[];
  id: string;
  isLocal: boolean;
  /** Dependencies point to a published version, not the placeholder `^0.0.0`. */
  isPublished: boolean;
}

/** `AcmeHello`, `acme_hello`, `acme.hello` → `acme-hello`. */
export const deriveExtensionId = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const isValidExtensionId = (id: string): boolean =>
  id.length <= MAX_ID_CHARS && EXTENSION_ID_PATTERN.test(id);

const isDirectory = async (target: string): Promise<boolean> =>
  (await stat(target).catch(() => null))?.isDirectory() === true;

const resolveId = (dir: string, id: string | undefined): string => {
  const resolved = id ?? deriveExtensionId(path.basename(dir));
  if (!isValidExtensionId(resolved)) {
    throw new GenerateError(
      'invalid-id',
      `'${resolved}' is not a valid extension id; pass one with --id`,
    );
  }
  return resolved;
};

interface DependencySpecs {
  dependencies: TemplateInput['dependencies'];
  /** The package version is known (published build), not a placeholder. */
  isPublished: boolean;
}

const dependencySpecs = async (
  localRoot: string | undefined,
  packageVersion: string | null,
): Promise<DependencySpecs> => {
  if (localRoot === undefined) {
    const range =
      packageVersion === null ? UNPUBLISHED_VERSION : `^${packageVersion}`;
    return {
      dependencies: { api: range, sdk: range, tools: range },
      isPublished: packageVersion !== null,
    };
  }
  const root = path.resolve(localRoot);
  const api = path.join(root, 'packages', 'extension-api');
  const sdk = path.join(root, 'packages', 'extension-sdk');
  const tools = path.join(root, 'packages', 'extension-tools');
  for (const dir of [api, sdk, tools]) {
    if (!(await isDirectory(dir))) {
      throw new GenerateError(
        'invalid-local',
        `${dir} not found: --local must point to the Dolphy repository root`,
      );
    }
  }
  return {
    dependencies: {
      api: `link:${api}`,
      sdk: `link:${sdk}`,
      tools: `link:${tools}`,
    },
    isPublished: false,
  };
};

const assertEmpty = async (dir: string): Promise<void> => {
  const info = await stat(dir).catch(() => null);
  if (info === null) return;
  const entries = info.isDirectory() ? await readdir(dir) : ['(file)'];
  if (entries.length > 0) {
    throw new GenerateError('target-not-empty', `${dir} is not empty`);
  }
};

/** Project files: relative path → content. */
export const renderProject = (input: TemplateInput): Map<string, string> => {
  const { id, template = common.DEFAULT_TEMPLATE } = input;
  const module = TEMPLATES[template];
  return new Map<string, string>([
    ['package.json', common.packageJson(input, module)],
    ['tsconfig.json', common.tsconfigJson(module)],
    ...Object.entries(module.files(id)),
    ['README.md', common.readme(id, module)],
    ['AGENTS.md', common.agentsMd(id, module)],
    ['CLAUDE.md', common.claudeMd()],
    ['.gitignore', common.gitignore()],
    ['.github/workflows/ci.yml', common.ciYml()],
  ]);
};

export const generateExtension = async (
  options: GenerateOptions,
): Promise<GenerateResult> => {
  const dir = path.resolve(options.dir);
  const id = resolveId(dir, options.id);
  const template = options.template ?? common.DEFAULT_TEMPLATE;
  if (!isTemplateName(template)) {
    throw new GenerateError(
      'invalid-template',
      `unknown template '${template}'; available: ${TEMPLATE_NAMES.join(', ')}`,
    );
  }
  const { dependencies, isPublished } = await dependencySpecs(
    options.localRoot,
    options.packageVersion ?? builtPackageVersion(),
  );
  await assertEmpty(dir);

  const isLocal = options.localRoot !== undefined;
  const project = renderProject({ id, template, dependencies });
  for (const [file, content] of project) {
    const target = path.join(dir, ...file.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return {
    dir,
    files: [...project.keys()].sort(),
    id,
    isLocal,
    isPublished,
  };
};
