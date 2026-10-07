import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CLIENT, DEFAULT_MAIN } from '@dolphy-app/extension-api';
import type { ExtensionManifest } from '@dolphy-app/extension-api';
import { formatDiagnostic, parseManifest } from '@dolphy-app/extension-host';
import { analyzeIndex } from './analyze.ts';
import { BuildError } from './errors.ts';

export const MANIFEST_FILE = 'extension.json';
export const CONFIG_FILE = 'dolphy-ext.config.json';
export const DEFAULT_OUT_DIR = 'dist-ext';

/** A standalone node entry from `dolphy-ext.config.json` (`nodeEntries`): a worker built as is. */
export interface Entry {
  source: string;
  output: string;
}

/** Extension host file: the `server` export of `src/index.ts`. */
export interface ServerOutput {
  kind: 'server';
  output: string;
}

/** Window file: the `client` export of `src/index.ts`. */
export interface ClientOutput {
  kind: 'client';
  output: string;
}

export interface Project {
  root: string;
  /** The source manifest: `main` and `client` are written into the built one. */
  manifest: ExtensionManifest;
  manifestBytes: Buffer;
  indexSource: string;
  /** Present when `src/index.ts` exports `server`. */
  server: ServerOutput | null;
  /** Present when `src/index.ts` exports `client`. */
  client: ClientOutput | null;
  workerEntries: Entry[];
  external: string[];
}

export const INDEX_SOURCE = 'src/index.ts';

const stripDot = (file: string): string => file.replace(/^\.\//, '');

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isFile = async (file: string): Promise<boolean> =>
  (await stat(file).catch(() => null))?.isFile() === true;

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

/** Workers are built only together with a server part. */
const workerEntriesOf = (config: ToolConfig, hasServer: boolean): Entry[] =>
  hasServer
    ? Object.entries(config.nodeEntries).map(([output, source]) => ({
        source,
        output: stripDot(output),
      }))
    : [];

/** Reads the source manifest, project config and exports of `src/index.ts`, computes the output files. */
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
  const indexFile = path.join(root, INDEX_SOURCE);
  if (!(await isFile(indexFile))) {
    throw new BuildError(
      `'${INDEX_SOURCE}' is not found: an extension is built from one entry file that exports 'server' and/or 'client'`,
      manifest.id,
    );
  }
  const analysis = await analyzeIndex(indexFile).catch((error: unknown) => {
    throw new BuildError(
      `${INDEX_SOURCE} cannot be read: ${errorText(error)}`,
      manifest.id,
    );
  });
  if (!analysis.hasServer && !analysis.hasClient) {
    throw new BuildError(
      `${INDEX_SOURCE} exports neither 'server' nor 'client': export const server = defineServer(…) and/or export const client = defineClient(…)`,
      manifest.id,
    );
  }
  return {
    root,
    manifest,
    manifestBytes,
    indexSource: INDEX_SOURCE,
    server: analysis.hasServer
      ? { kind: 'server', output: stripDot(DEFAULT_MAIN) }
      : null,
    client: analysis.hasClient
      ? { kind: 'client', output: stripDot(DEFAULT_CLIENT) }
      : null,
    workerEntries: workerEntriesOf(config, analysis.hasServer),
    external: config.external,
  };
};

/** Bytes of the built `extension.json`: the source manifest with `main` and `client` naming the built files (`null` — no such part). */
export const builtManifestText = (project: Project): string => {
  const source = JSON.parse(project.manifestBytes.toString('utf8')) as Record<
    string,
    unknown
  >;
  const built = {
    ...source,
    main: project.server === null ? null : `./${project.server.output}`,
    client: project.client === null ? null : `./${project.client.output}`,
  };
  return `${JSON.stringify(built, null, 2)}\n`;
};
