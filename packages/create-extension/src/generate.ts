import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EXTENSION_ID_PATTERN } from '@dolphy-app/extension-api';
import * as template from './template.ts';
import type { TemplateInput } from './template.ts';

/** Совпадает с ограничением манифеста (`parseManifest`). */
const MAX_ID_CHARS = 64;
/** Без сборки (исходники, `--local`) версия пакетов условная. */
export const UNPUBLISHED_VERSION = '^0.0.0';

/** Подставляется сборкой `tools/build-packages.mjs`; в исходниках не определена. */
declare const __DOLPHY_PACKAGE_VERSION__: string | undefined;

const builtPackageVersion = (): string | null =>
  typeof __DOLPHY_PACKAGE_VERSION__ === 'string'
    ? __DOLPHY_PACKAGE_VERSION__
    : null;

export type GenerateErrorCode =
  'invalid-id' | 'invalid-local' | 'target-not-empty';

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
  /** По умолчанию — kebab-case имени каталога. */
  id?: string;
  /** Корень репозитория Dolphy: зависимости пишутся как `link:<корень>/packages/...`. */
  localRoot?: string;
  /** Версия опубликованных пакетов; по умолчанию — версия самого генератора из сборки. */
  packageVersion?: string;
}

export interface GenerateResult {
  /** Абсолютный путь созданного проекта. */
  dir: string;
  /** Относительные пути (разделитель `/`), по возрастанию. */
  files: string[];
  id: string;
  isLocal: boolean;
  /** Зависимости указывают на опубликованную версию, а не на условную `^0.0.0`. */
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
  /** Версия пакетов известна (сборка опубликованного пакета), а не условная. */
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
      dependencies: { sdk: range, tools: range },
      isPublished: packageVersion !== null,
    };
  }
  const root = path.resolve(localRoot);
  const sdk = path.join(root, 'packages', 'extension-sdk');
  const tools = path.join(root, 'packages', 'extension-tools');
  for (const dir of [sdk, tools]) {
    if (!(await isDirectory(dir))) {
      throw new GenerateError(
        'invalid-local',
        `${dir} not found: --local must point to the Dolphy repository root`,
      );
    }
  }
  return {
    dependencies: { sdk: `link:${sdk}`, tools: `link:${tools}` },
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

/** Файлы проекта: относительный путь → содержимое. */
export const renderProject = (input: TemplateInput): Map<string, string> => {
  const { id } = input;
  return new Map<string, string>([
    ['package.json', template.packageJson(input)],
    ['tsconfig.json', template.tsconfigJson()],
    ['extension.json', template.manifestJson(id)],
    ['src/index.ts', template.indexTs(id)],
    ['test/index.test.ts', template.indexTestTs(id)],
    ['README.md', template.readme(id)],
    ['.gitignore', template.gitignore()],
  ]);
};

export const generateExtension = async (
  options: GenerateOptions,
): Promise<GenerateResult> => {
  const dir = path.resolve(options.dir);
  const id = resolveId(dir, options.id);
  const { dependencies, isPublished } = await dependencySpecs(
    options.localRoot,
    options.packageVersion ?? builtPackageVersion(),
  );
  await assertEmpty(dir);

  const isLocal = options.localRoot !== undefined;
  const project = renderProject({ id, dependencies });
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
