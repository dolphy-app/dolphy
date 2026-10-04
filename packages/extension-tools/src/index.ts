import { watch as fsWatch } from 'node:fs';
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  formatDiagnostic,
  inspectExtensionDir,
} from '@dolphy-app/extension-host';
import { assetFindings } from './catalog/assets.ts';
import { localeFindings, readFileOrNull } from './locales.ts';
import { bundleAll } from './bundle.ts';
import { BuildError } from './errors.ts';
import { writeIds } from './ids.ts';
import type { GeneratedIds } from './ids.ts';
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
export { IDS_FILE } from './ids.ts';
export type { GeneratedIds } from './ids.ts';

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
  /** Do not fail the check: a key in `locales/*.json` the manifest does not use, an unsupported language file. */
  warnings: string[];
}

const STATIC_DIRS = ['schema', 'assets', 'locales'];

/** Editors write a file in several events: manifest reload waits for quiet. */
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
  const root = path.resolve(dir);
  const result = await inspectExtensionDir(root, {
    verifyFiles: true,
    expectedId: null,
  });
  if (!result.ok) {
    return {
      ok: false,
      problems: [formatDiagnostic(result.diagnostic)],
      warnings: [],
    };
  }
  const files = await listFiles(root);
  // the same checks as `catalog check`: type, signature, ceiling and content of style sheets, images, fonts
  const problems = (await assetFindings(root, files)).map(
    ({ path: file, message }) => `${file}: ${message}`,
  );
  const locales = await localeFindings({
    manifest: JSON.parse(
      (await readFileOrNull(root, MANIFEST_FILE)) ?? 'null',
    ) as unknown,
    files,
    read: (file) => readFileOrNull(root, file),
  });
  const describe = ({ field, message }: { field: string; message: string }) =>
    `${field}: ${message}`;
  problems.push(
    ...locales.filter(({ severity }) => severity === 'error').map(describe),
  );
  return {
    ok: problems.length === 0,
    problems,
    warnings: locales
      .filter(({ severity }) => severity === 'warning')
      .map(describe),
  };
};

const assertValid = async (
  project: Project,
  dir: string,
  logger: BuildLogger | undefined,
): Promise<void> => {
  const { ok, problems, warnings } = await validateExtension(dir);
  for (const warning of warnings) {
    logger?.info(`warning ${project.manifest.id}: ${warning}`);
  }
  if (!ok) throw new BuildError(problems.join('; '), project.manifest.id);
};

/** Writes `.dolphy/ids.d.ts` for the project in `options.root` from its `extension.json`; `changed` is false when the file was already current. */
export const generateTypes = async (
  options: Pick<BuildOptions, 'root'>,
): Promise<GeneratedIds> => writeIds(await loadProject(options.root));

const prepare = async (
  options: BuildOptions,
): Promise<{ project: Project; dir: string }> => {
  const project = await loadProject(options.root);
  await writeIds(project);
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
  await assertValid(project, dir, options.logger);
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
    await assertValid(project, dir, options.logger);
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
      await writeIds(next);
      await requireSources(next);
      project = next;
      dir = targetDir(project, options);
      await mkdir(dir, { recursive: true });
      current = await watchAll(project, dir, reporter, false);
      await copyStatic(project, dir);
      // broken bundles will be rebuilt by the watcher after an edit: nothing to check yet
      if (current.isHealthy) {
        await assertValid(project, dir, options.logger);
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
