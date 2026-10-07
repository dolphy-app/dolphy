import { watch as fsWatch } from 'node:fs';
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  formatDiagnostic,
  inspectExtensionDir,
} from '@dolphy-app/extension-host';
import { assetFindings } from './catalog/assets.ts';
import { bundleAll } from './bundle.ts';
import { BuildError } from './errors.ts';
import {
  DEFAULT_OUT_DIR,
  MANIFEST_FILE,
  builtManifestText,
  loadProject,
} from './project.ts';
import type { Project } from './project.ts';
import { createReporter, watchAll } from './watch.ts';
import type { BundleWatch, RebuildReport } from './watch.ts';

export { BuildError } from './errors.ts';
export {
  HOST_GLOBAL,
  HOST_MODULES,
  hostModulesPlugin,
} from './host-modules.ts';

export interface BuildLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface BuildOptions {
  root: string;
  /** Output root; the extension is placed in `<outDir>/<id>`. */
  outDir?: string;
  watch?: boolean;
  logger?: BuildLogger;
}

export interface BuildResult {
  id: string;
  dir: string;
  /** Paths relative to `dir`, sorted. */
  files: string[];
}

export interface ValidationResult {
  ok: boolean;
  problems: string[];
}

const STATIC_DIRS = ['assets'];

/** Editors write a file in several events: manifest reload waits for quiet. */
const MANIFEST_SETTLE_MS = 100;

const isPresent = async (file: string): Promise<boolean> =>
  (await stat(file).catch(() => null)) !== null;

const targetDir = (project: Project, options: BuildOptions): string => {
  const base = options.outDir ?? path.join(project.root, DEFAULT_OUT_DIR);
  return path.join(path.resolve(base), project.manifest.id);
};

const requireSources = async (project: Project): Promise<void> => {
  for (const entry of project.workerEntries) {
    if (!(await isPresent(path.join(project.root, entry.source)))) {
      throw new BuildError(
        `entry source '${entry.source}' for '${entry.output}' is not found`,
        project.manifest.id,
      );
    }
  }
};

const copyStatic = async (project: Project, dir: string): Promise<void> => {
  await writeFile(path.join(dir, MANIFEST_FILE), builtManifestText(project));
  for (const name of STATIC_DIRS) {
    const from = path.join(project.root, name);
    if (await isPresent(from)) {
      await cp(from, path.join(dir, name), { recursive: true });
    }
  }
  const { icon } = project.manifest;
  if (icon !== null) {
    const from = path.join(project.root, icon);
    if (!(await isPresent(from))) {
      throw new BuildError(
        `icon '${icon}' referenced by the manifest is not found`,
        project.manifest.id,
      );
    }
    await mkdir(path.dirname(path.join(dir, icon)), { recursive: true });
    await cp(from, path.join(dir, icon));
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
  const root = path.resolve(dir);
  const result = await inspectExtensionDir(root, {
    verifyFiles: true,
    expectedId: null,
  });
  if (!result.ok) {
    return {
      ok: false,
      problems: [formatDiagnostic(result.diagnostic)],
    };
  }
  const files = await listFiles(root);
  // the same checks as `catalog check`: type, signature, ceiling and content of style sheets, images, fonts
  const problems = (await assetFindings(root, files)).map(
    ({ path: file, message }) => `${file}: ${message}`,
  );
  return { ok: problems.length === 0, problems };
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

const reportTo =
  (id: string, logger: BuildLogger | undefined) =>
  (report: RebuildReport): void => {
    if (report.rebuilt.length > 0) {
      logger?.info(`rebuilt ${report.rebuilt.join(', ')}`);
    }
    for (const failure of report.failures) {
      logger?.error(
        `error ${id}: failed to bundle ${failure.labels.join(', ')}: ${failure.detail}`,
      );
    }
  };

/**
 * First build + rebuild of affected files when `src/index.ts` or its
 * dependencies are edited, until `close()`. Editing `extension.json` rebuilds
 * everything: the shims depend on the manifest. Schemas and assets are copied on
 * the first build and after a manifest edit.
 */
export const watchExtension = async (
  options: BuildOptions,
): Promise<WatchHandle> => {
  const { project: first, dir: firstDir } = await prepare(options);
  const { logger } = options;
  let project = first;
  let dir = firstDir;
  const reporter = createReporter((report) =>
    reportTo(project.manifest.id, logger)(report),
  );
  let current: BundleWatch | null = await watchAll(
    project,
    dir,
    reporter,
    true,
  );
  try {
    await copyStatic(project, dir);
    await assertValid(project, dir);
  } catch (error) {
    await current.close();
    reporter.close();
    throw error;
  }
  const result = await resultOf(project, dir);

  const reload = async (): Promise<void> => {
    const previous = project.manifestBytes;
    let next: Project;
    try {
      next = await loadProject(options.root);
    } catch (error) {
      logger?.error(
        `error ${project.manifest.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (next.manifestBytes.equals(previous)) return;
    await current?.close();
    current = null;
    await rm(dir, { recursive: true, force: true });
    try {
      await requireSources(next);
      project = next;
      dir = targetDir(project, options);
      await mkdir(dir, { recursive: true });
      current = await watchAll(project, dir, reporter, false);
      await copyStatic(project, dir);
      // broken bundles will be rebuilt by the watcher after an edit: nothing to check yet
      if (current.isHealthy) {
        await assertValid(project, dir);
        logger?.info(
          `rebuilt ${(await resultOf(project, dir)).files.join(', ')}`,
        );
      }
    } catch (error) {
      logger?.error(
        `error ${project.manifest.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  let queue: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | null = null;
  const manifestWatcher = fsWatch(project.root, (_event, name) => {
    if (name !== MANIFEST_FILE) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      queue = queue.then(reload);
    }, MANIFEST_SETTLE_MS);
  });
  return {
    result,
    close: async () => {
      manifestWatcher.close();
      if (timer !== null) clearTimeout(timer);
      await queue;
      reporter.close();
      await current?.close();
    },
  };
};
