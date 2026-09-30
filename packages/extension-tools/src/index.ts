import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectExtensionDir } from '@lms/extension-host';
import { bundleAll, watchAll } from './bundle.ts';
import { BuildError } from './errors.ts';
import { DEFAULT_OUT_DIR, MANIFEST_FILE, loadProject } from './project.ts';
import type { Entry, Project } from './project.ts';

export { BuildError } from './errors.ts';

export interface BuildLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface BuildOptions {
  root: string;
  /** Корень вывода; расширение кладётся в `<outDir>/<id>`. */
  outDir?: string;
  watch?: boolean;
  logger?: BuildLogger;
}

export interface BuildResult {
  id: string;
  dir: string;
  /** Пути относительно `dir`, отсортированы. */
  files: string[];
}

export interface ValidationResult {
  ok: boolean;
  problems: string[];
}

const STATIC_DIRS = ['schema', 'assets'];

const isPresent = async (file: string): Promise<boolean> =>
  (await stat(file).catch(() => null)) !== null;

const targetDir = (project: Project, options: BuildOptions): string => {
  const base = options.outDir ?? path.join(project.root, DEFAULT_OUT_DIR);
  return path.join(path.resolve(base), project.manifest.id);
};

const requireSources = async (project: Project): Promise<void> => {
  const entries: Entry[] = [...project.nodeEntries, ...project.browserEntries];
  for (const entry of entries) {
    const file = path.join(project.root, entry.source);
    if (!(await isPresent(file))) {
      throw new BuildError(
        `entry source '${entry.source}' for '${entry.output}' is not found`,
        project.manifest.id,
      );
    }
  }
};

const copyStatic = async (project: Project, dir: string): Promise<void> => {
  await writeFile(path.join(dir, MANIFEST_FILE), project.manifestBytes);
  for (const name of STATIC_DIRS) {
    const from = path.join(project.root, name);
    if (await isPresent(from)) {
      await cp(from, path.join(dir, name), { recursive: true });
    }
  }
  for (const schema of project.schemaPaths) {
    const from = path.join(project.root, schema);
    if (!(await isPresent(from))) {
      throw new BuildError(
        `schema '${schema}' referenced by the manifest is not found`,
        project.manifest.id,
      );
    }
    await mkdir(path.dirname(path.join(dir, schema)), { recursive: true });
    await cp(from, path.join(dir, schema));
  }
};

const listFiles = async (dir: string, prefix = ''): Promise<string[]> => {
  const entries = await readdir(path.join(dir, prefix), {
    withFileTypes: true,
  });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? listFiles(dir, relative) : [relative];
    }),
  );
  return nested.flat().sort();
};

export const validateExtension = async (
  dir: string,
): Promise<ValidationResult> => {
  const result = await inspectExtensionDir(path.resolve(dir), {
    verifyFiles: true,
    expectedId: null,
  });
  return result.ok
    ? { ok: true, problems: [] }
    : { ok: false, problems: [result.message] };
};

const assertValid = async (project: Project, dir: string): Promise<void> => {
  const { ok, problems } = await validateExtension(dir);
  if (!ok) throw new BuildError(problems.join('; '), project.manifest.id);
};

const prepare = async (
  options: BuildOptions,
): Promise<{ project: Project; dir: string }> => {
  const project = await loadProject(options.root);
  await requireSources(project);
  const dir = targetDir(project, options);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return { project, dir };
};

const resultOf = async (project: Project, dir: string) => ({
  id: project.manifest.id,
  dir,
  files: await listFiles(dir),
});

export const buildExtension = async (
  options: BuildOptions,
): Promise<BuildResult> => {
  const { project, dir } = await prepare(options);
  await bundleAll(project, dir);
  await copyStatic(project, dir);
  await assertValid(project, dir);
  return resultOf(project, dir);
};

export interface WatchHandle {
  result: BuildResult;
  close(): Promise<void>;
}

/**
 * Первая сборка + пересборка бандлов при правке исходников до `close()`.
 * Манифест, схемы и assets копируются один раз: их правка требует перезапуска.
 */
export const watchExtension = async (
  options: BuildOptions,
): Promise<WatchHandle> => {
  const { project, dir } = await prepare(options);
  const { logger } = options;
  const watch = await watchAll(project, dir, (entry, error) => {
    if (error === null) logger?.info(`rebuilt ${entry.output}`);
    else {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error(`error ${project.manifest.id}: ${message}`);
    }
  });
  try {
    await copyStatic(project, dir);
    await assertValid(project, dir);
  } catch (error) {
    await watch.close();
    throw error;
  }
  return { result: await resultOf(project, dir), close: watch.close };
};
