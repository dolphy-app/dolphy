import { builtinModules } from 'node:module';
import path from 'node:path';
import { build, createLogger } from 'vite';
import type { InlineConfig } from 'vite';
import { BuildError } from './errors.ts';
import type { Entry, Project } from './project.ts';
import { exportsOf, shimEntry, shimPlugin } from './shim.ts';
import type { JobState, Output } from './shim.ts';

/** Один бандл: один выходной файл, своя сборка, без общих чанков. */
export interface Job {
  /** Выходной файл относительно каталога расширения. */
  output: string;
  /** Как назвать файл в сообщении: выходной файл и экспорты, из которых он собран. */
  label: string;
  config: InlineConfig;
  state: JobState;
}

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const nodeExternal = (external: readonly string[]): (string | RegExp)[] => [
  /^node:/,
  ...builtinModules,
  ...external,
];

const bundleConfig = (
  project: Project,
  entry: string,
  output: string,
  outDir: string,
  isNode: boolean,
): InlineConfig => ({
  root: project.root,
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  // ошибки сборки показывает `watchExtension` один раз на причину, а не Vite на каждый файл
  customLogger: { ...createLogger('warn'), error: () => undefined },
  build: {
    target: isNode ? 'node22' : 'es2022',
    outDir,
    emptyOutDir: false,
    minify: false,
    copyPublicDir: false,
    lib: {
      entry,
      formats: ['es'],
      fileName: () => output,
    },
    rolldownOptions: {
      external: isNode ? nodeExternal(project.external) : [],
    },
  },
});

const outputJob = (project: Project, output: Output, outDir: string): Job => {
  const state: JobState = { problem: null };
  const config = bundleConfig(
    project,
    shimEntry(project, output),
    output.output,
    outDir,
    output.kind === 'host',
  );
  return {
    output: output.output,
    label: `${output.output} (${exportsOf(output).join(', ')} from ${project.indexSource})`,
    config: {
      ...config,
      plugins: [shimPlugin({ project, output, state })],
    },
    state,
  };
};

const workerJob = (project: Project, entry: Entry, outDir: string): Job => ({
  output: entry.output,
  label: `${entry.output} (${entry.source})`,
  config: bundleConfig(
    project,
    path.resolve(project.root, entry.source),
    entry.output,
    outDir,
    true,
  ),
  state: { problem: null },
});

/** Бандлы проекта: процесс расширений, браузерные файлы, воркеры. */
export const jobsOf = (project: Project, outDir: string): Job[] => [
  ...(project.host === null ? [] : [outputJob(project, project.host, outDir)]),
  ...project.browserOutputs.map((output) => outputJob(project, output, outDir)),
  ...project.workerEntries.map((entry) => workerJob(project, entry, outDir)),
];

/** Причина сбоя: ошибка сверки или защиты, названная плагином, либо текст бандлера. */
export const failureDetail = (job: Job, error: unknown): string =>
  job.state.problem ?? errorText(error);

/** Собирает все бандлы (по одному, без общих чанков) в `outDir`. */
export const bundleAll = async (
  project: Project,
  outDir: string,
): Promise<void> => {
  for (const job of jobsOf(project, outDir)) {
    job.state.problem = null;
    try {
      await build(job.config);
    } catch (error) {
      throw new BuildError(
        `failed to bundle ${job.label}: ${failureDetail(job, error)}`,
        project.manifest.id,
      );
    }
  }
};
