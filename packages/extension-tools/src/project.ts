import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseManifest } from '@spirula-app/extension-host';
import type { ExtensionManifest } from '@spirula-app/extension-api';
import { BuildError } from './errors.ts';

export const MANIFEST_FILE = 'extension.json';
export const CONFIG_FILE = 'spirula-ext.config.json';
export const DEFAULT_OUT_DIR = 'dist-ext';

/** Одна точка входа сборки: исходник → файл относительно каталога расширения. */
export interface Entry {
  source: string;
  output: string;
}

export interface Project {
  root: string;
  manifest: ExtensionManifest;
  manifestBytes: Buffer;
  nodeEntries: Entry[];
  browserEntries: Entry[];
  external: string[];
  /** Схемы-файлы из манифеста (относительные пути, без `./`). */
  schemaPaths: string[];
}

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

/** Без кода (`main: null`) node-входов нет. */
const nodeEntriesOf = (
  manifest: ExtensionManifest,
  config: ToolConfig,
): Entry[] => {
  if (manifest.main === null) return [];
  const main = stripDot(manifest.main);
  return [
    { source: entrySource(main), output: main },
    ...Object.entries(config.nodeEntries).map(([output, source]) => ({
      source,
      output: stripDot(output),
    })),
  ];
};

/** Читает исходный манифест и конфиг проекта, вычисляет точки входа. */
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

  const nodeEntries = nodeEntriesOf(manifest, config);
  const renderers = new Set([
    ...manifest.contributes.exerciseTypes.map((type) => type.renderer),
    ...manifest.contributes.markdownRenderers.map((entry) => entry.renderer),
  ]);
  const browserEntries = [...renderers].map(stripDot).map((output) => ({
    source: entrySource(output),
    output,
  }));
  return {
    root,
    manifest,
    manifestBytes,
    nodeEntries,
    browserEntries,
    external: config.external,
    schemaPaths: schemaPathsOf(manifest),
  };
};
