import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { formatDiagnostic, parseManifest } from '@dolphy-app/extension-host';
import type { ExtensionManifest } from '@dolphy-app/extension-api';
import { BuildError } from './errors.ts';

export const MANIFEST_FILE = 'extension.json';
export const CONFIG_FILE = 'dolphy-ext.config.json';
export const DEFAULT_OUT_DIR = 'dist-ext';

/** A standalone node entry from `dolphy-ext.config.json` (`nodeEntries`): a worker built as is. */
export interface Entry {
  source: string;
  output: string;
}

/** Extensions process file: the `host` export of `src/index.ts`. */
export interface HostOutput {
  kind: 'host';
  output: string;
}

/** Browser file: `views`, `panels`, `widgets` and `markdown` entries whose manifest names this file. */
export interface BrowserOutput {
  kind: 'browser';
  output: string;
  /** Exercise types whose answer view this file holds. */
  views: { id: string }[];
  panels: string[];
  widgets: string[];
  languages: string[];
}

export interface Project {
  root: string;
  manifest: ExtensionManifest;
  manifestBytes: Buffer;
  /** `src/index.ts` if the extension needs code; otherwise `null`. */
  indexSource: string | null;
  host: HostOutput | null;
  browserOutputs: BrowserOutput[];
  workerEntries: Entry[];
  external: string[];
  /** Schema files from the manifest (relative paths, without `./`). */
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

/** Workers are built only together with code: without `main` there are none. */
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
      widgets: [],
      languages: [],
    };
    outputs.set(output, created);
    return created;
  };
  const { exerciseTypes, markdownRenderers, panels, widgets } =
    manifest.contributes;
  for (const type of exerciseTypes) {
    outputOf(type.renderer).views.push({ id: type.id });
  }
  for (const entry of markdownRenderers) {
    outputOf(entry.renderer).languages.push(entry.language);
  }
  for (const panel of panels) outputOf(panel.module).panels.push(panel.id);
  for (const widget of widgets) {
    outputOf(widget.module).widgets.push(widget.id);
  }
  return [...outputs.values()];
};

/**
 * Paths where code lived before the single entry (`src/<file name>.ts`):
 * the build uses them to recognize the old layout and suggest a migration.
 */
export const legacySources = (project: Project): string[] => {
  const outputs = [
    ...(project.host === null ? [] : [project.host.output]),
    ...project.browserOutputs.map((entry) => entry.output),
  ];
  return [...new Set(outputs.map(entrySource))];
};

/** Reads the source manifest and project config, computes the output files. */
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
  if (!parsed.ok)
    throw new BuildError(formatDiagnostic(parsed.diagnostic), root);
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
