import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseManifest } from '@dolphy-app/extension-host';
import type { ExtensionManifest } from '@dolphy-app/extension-api';
import { BuildError } from './errors.ts';

export const MANIFEST_FILE = 'extension.json';
export const CONFIG_FILE = 'dolphy-ext.config.json';
export const DEFAULT_OUT_DIR = 'dist-ext';

/** Отдельный node-вход из `dolphy-ext.config.json` (`nodeEntries`): воркер, собираемый как есть. */
export interface Entry {
  source: string;
  output: string;
}

/** Файл процесса расширений: экспорт `host` из `src/index.ts`. */
export interface HostOutput {
  kind: 'host';
  output: string;
}

/** Браузерный файл: записи `views`, `panels` и `markdown`, у которых манифест называет этот файл. */
export interface BrowserOutput {
  kind: 'browser';
  output: string;
  /** Виды заданий: id и тег элемента. */
  views: { id: string; element: string }[];
  panels: string[];
  languages: string[];
}

export interface Project {
  root: string;
  manifest: ExtensionManifest;
  manifestBytes: Buffer;
  /** `src/index.ts`, если расширению нужен код; иначе `null`. */
  indexSource: string | null;
  host: HostOutput | null;
  browserOutputs: BrowserOutput[];
  workerEntries: Entry[];
  external: string[];
  /** Схемы-файлы из манифеста (относительные пути, без `./`). */
  schemaPaths: string[];
}

export const INDEX_SOURCE = 'src/index.ts';

const stripDot = (file: string): string => file.replace(/^\.\//, '');

const stripExtension = (file: string): string =>
  file.slice(0, file.length - path.posix.extname(file).length);

const entrySource = (file: string): string =>
  `src/${path.posix.basename(stripExtension(file))}.ts`;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((item) => typeof item === 'string');

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const readJson = async (file: string, subject: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new BuildError(
      `${path.basename(file)} is unreadable: ${errorText(error)}`,
      subject,
    );
  }
};

interface ToolConfig {
  nodeEntries: Record<string, string>;
  external: string[];
}

const readConfig = async (root: string): Promise<ToolConfig> => {
  const file = path.join(root, CONFIG_FILE);
  const exists = (await stat(file).catch(() => null))?.isFile() === true;
  if (!exists) return { nodeEntries: {}, external: [] };
  const raw = await readJson(file, root);
  const config = raw as { nodeEntries?: unknown; external?: unknown };
  const nodeEntries = config.nodeEntries ?? {};
  const external = config.external ?? [];
  if (!isStringRecord(nodeEntries) || !isStringArray(external)) {
    throw new BuildError(
      `${CONFIG_FILE}: 'nodeEntries' must map output files to sources and 'external' must be a string array`,
      root,
    );
  }
  return { nodeEntries, external };
};

const schemaPathsOf = (manifest: ExtensionManifest): string[] => {
  const paths = manifest.contributes.exerciseTypes
    .flatMap((type) => [type.specSchema, type.answerSchema])
    .filter((schema): schema is string => typeof schema === 'string')
    .map(stripDot);
  return [...new Set(paths)];
};

/** Воркеры собираются только вместе с кодом: без `main` их нет. */
const workerEntriesOf = (
  manifest: ExtensionManifest,
  config: ToolConfig,
): Entry[] =>
  manifest.main === null
    ? []
    : Object.entries(config.nodeEntries).map(([output, source]) => ({
        source,
        output: stripDot(output),
      }));

const browserOutputsOf = (manifest: ExtensionManifest): BrowserOutput[] => {
  const outputs = new Map<string, BrowserOutput>();
  const outputOf = (file: string): BrowserOutput => {
    const output = stripDot(file);
    const existing = outputs.get(output);
    if (existing !== undefined) return existing;
    const created: BrowserOutput = {
      kind: 'browser',
      output,
      views: [],
      panels: [],
      languages: [],
    };
    outputs.set(output, created);
    return created;
  };
  const { exerciseTypes, markdownRenderers, panels } = manifest.contributes;
  for (const type of exerciseTypes) {
    outputOf(type.renderer).views.push({ id: type.id, element: type.element });
  }
  for (const entry of markdownRenderers) {
    outputOf(entry.renderer).languages.push(entry.language);
  }
  for (const panel of panels) outputOf(panel.module).panels.push(panel.id);
  return [...outputs.values()];
};

/**
 * Пути, по которым код лежал до единого входа (`src/<имя файла>.ts`):
 * по ним сборка узнаёт старую раскладку и подсказывает перенос.
 */
export const legacySources = (project: Project): string[] => {
  const outputs = [
    ...(project.host === null ? [] : [project.host.output]),
    ...project.browserOutputs.map((entry) => entry.output),
  ];
  return [...new Set(outputs.map(entrySource))];
};

/** Читает исходный манифест и конфиг проекта, вычисляет выходные файлы. */
export const loadProject = async (rootDir: string): Promise<Project> => {
  const root = path.resolve(rootDir);
  const manifestFile = path.join(root, MANIFEST_FILE);
  let manifestBytes: Buffer;
  try {
    manifestBytes = await readFile(manifestFile);
  } catch (error) {
    throw new BuildError(
      `${MANIFEST_FILE} is unreadable: ${errorText(error)}`,
      root,
    );
  }
  const raw = await readJson(manifestFile, root);
  const parsed = parseManifest(raw);
  if (!parsed.ok) throw new BuildError(parsed.message, root);
  const { manifest } = parsed;
  const config = await readConfig(root);

  const host: HostOutput | null =
    manifest.main === null
      ? null
      : { kind: 'host', output: stripDot(manifest.main) };
  const browserOutputs = browserOutputsOf(manifest);
  return {
    root,
    manifest,
    manifestBytes,
    indexSource:
      host !== null || browserOutputs.length > 0 ? INDEX_SOURCE : null,
    host,
    browserOutputs,
    workerEntries: workerEntriesOf(manifest, config),
    external: config.external,
    schemaPaths: schemaPathsOf(manifest),
  };
};
