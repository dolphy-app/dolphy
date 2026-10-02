import { watch as fsWatch } from 'node:fs';
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectExtensionDir } from '@dolphy-app/extension-host';
import { bundleAll } from './bundle.ts';
import { BuildError } from './errors.ts';
import {
  DEFAULT_OUT_DIR,
  MANIFEST_FILE,
  legacySources,
  loadProject,
} from './project.ts';
import type { Project } from './project.ts';
import { createReporter, watchAll } from './watch.ts';
import type { BundleWatch, RebuildReport } from './watch.ts';

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

/** Редакторы пишут файл несколькими событиями: перезагрузка манифеста ждёт тишины. */
const MANIFEST_SETTLE_MS = 100;

const isPresent = async (file: string): Promise<boolean> =>
  (await stat(file).catch(() => null)) !== null;

const targetDir = (project: Project, options: BuildOptions): string => {
  const base = options.outDir ?? path.join(project.root, DEFAULT_OUT_DIR);
  return path.join(path.resolve(base), project.manifest.id);
};

const legacyHint = (project: Project): string => {
  const { contributes } = project.manifest;
  const steps = [
    'create src/index.ts',
    ...(project.host === null
      ? []
      : [
          `move the default export of the main file into it as export const host = defineExtension({ … })`,
        ]),
    ...(contributes.exerciseTypes.length === 0
      ? []
      : [
          `replace defineAnswerElement(tag, mount) with an entry of export const views = { '<exercise type id>': defineAnswerView(mount) } (the tag now comes from extension.json)`,
        ]),
    ...(contributes.panels.length === 0
      ? []
      : [
          `move the default export of the panel module into export const panels = { '<panel id>': defineExtensionPanel({ … }) }`,
        ]),
    ...(contributes.markdownRenderers.length === 0
      ? []
      : [
          `move the default export of the renderer module into export const markdown = { '<language>': defineMarkdownRenderer(…) }`,
        ]),
    'delete the old src files and import from src/index.ts in tests',
  ];
  return steps.map((step, index) => `${index + 1}. ${step}`).join('; ');
};

const requireSources = async (project: Project): Promise<void> => {
  const { indexSource } = project;
  if (
    indexSource !== null &&
    !(await isPresent(path.join(project.root, indexSource)))
  ) {
    const legacy = legacySources(project);
    const found = (
      await Promise.all(
        legacy.map(async (source) =>
          (await isPresent(path.join(project.root, source))) ? source : null,
        ),
      )
    ).filter((source) => source !== null);
    const reason =
      found.length > 0
        ? `found the old layout (${found.join(', ')}), which is no longer supported; migrate: ${legacyHint(project)}`
        : `add it: ${legacyHint(project)}`;
    throw new BuildError(
      `'${indexSource}' is not found: an extension with code is built from one entry file; ${reason}`,
      project.manifest.id,
    );
  }
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
 * Первая сборка + пересборка затронутых файлов при правке `src/index.ts` и
 * зависимостей до `close()`. Правка `extension.json` пересобирает всё заново:
 * обвязки зависят от манифеста. Схемы и assets копируются при первой сборке и
 * после правки манифеста.
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
      // сломанные бандлы вотчер пересоберёт после правки: проверять пока нечего
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
