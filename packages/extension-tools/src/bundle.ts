import { realpathSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { build, createLogger } from 'vite';
import type { InlineConfig, Plugin } from 'vite';
import {
  ASSETS_INLINE_LIMIT,
  ASSET_FILE_NAME,
  assetsPlugin,
} from './assets-plugin.ts';
import { BuildError } from './errors.ts';
import { WINDOW_SPECIFIER, hostModulesPlugin } from './host-modules.ts';
import {
  frameworkPackagePattern,
  presetConfig,
  presetPlugins,
} from './presets/index.ts';
import type { Entry, Project } from './project.ts';
import { serverVuePlugin } from './server-vue.ts';
import { exportOf, shimEntry, shimPlugin } from './shim.ts';
import type { JobState, Output } from './shim.ts';

/** One bundle: one output file, its own build, no shared chunks. */
export interface Job {
  /** Output file relative to the extension directory. */
  output: string;
  /** How to name the file in a message: the output file and the exports it is built from. */
  label: string;
  config: InlineConfig;
  state: JobState;
}

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const nodeExternal = (external: readonly string[]): (string | RegExp)[] => [
  /^node:/,
  ...builtinModules,
  WINDOW_SPECIFIER,
  ...external,
];

/** Production flags for browser files: the page has no `process`, and Vue and Vuetify come from the app. */
const BROWSER_DEFINE: Record<string, string> = {
  'process.env.NODE_ENV': '"production"',
  'process.env.VITE_LOGGER_ENABLED': 'undefined',
  __VUE_OPTIONS_API__: 'false',
  __VUE_PROD_DEVTOOLS__: 'false',
  __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
};

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
  // asset addresses relative to the bundle (`new URL('assets/x.png', import.meta.url)`), not to the site root
  base: './',
  // a library build leaves `process.env.NODE_ENV` and the feature flags of Vue as they are, and the page has no `process`
  define: isNode ? {} : BROWSER_DEFINE,
  logLevel: 'warn',
  // `watchExtension` reports build errors once per cause, rather than Vite once per file
  customLogger: { ...createLogger('warn'), error: () => undefined },
  build: {
    target: isNode ? 'node22' : 'es2022',
    outDir,
    emptyOutDir: false,
    minify: false,
    cssMinify: true,
    copyPublicDir: false,
    assetsInlineLimit: ASSETS_INLINE_LIMIT,
    lib: {
      entry,
      formats: ['es'],
      fileName: () => output,
    },
    rolldownOptions: {
      external: isNode ? nodeExternal(project.external) : [],
      output: { assetFileNames: ASSET_FILE_NAME },
    },
  },
});

/** Constants of the extension API are `Object.freeze({…})` calls: without this a browser bundle keeps all of them. */
const BROWSER_PURE_CALLS = ['Object.freeze'];

/**
 * Calls of the client part that the server file shares `src/index.ts` with: a
 * call whose result the server does not use is dropped with everything it
 * refers to (a component and the library behind it). The `__NO_SIDE_EFFECTS__`
 * mark of the SDK does not do it for the SDK as published: the bundler keeps
 * the call, and with it React, in `main.mjs`.
 */
const SERVER_PURE_CALLS = [
  'defineComponent',
  'defineAsyncComponent',
  'defineClient',
  'defineMountable',
  'reactComponent',
];

/** `presets`: plugins of the frameworks of the client file (the server file and workers are built without them). */
const outputJob = (
  project: Project,
  output: Output,
  outDir: string,
  presets: Plugin[],
): Job => {
  const state: JobState = { problem: null };
  const isBrowser = output.kind === 'client';
  const base = bundleConfig(
    project,
    shimEntry(project, output),
    output.output,
    outDir,
    !isBrowser,
  );
  const config = isBrowser ? presetConfig(project.frameworks, base) : base;
  const frameworkPackages = frameworkPackagePattern(project.frameworks);
  config.build = {
    ...config.build,
    rolldownOptions: {
      ...config.build?.rolldownOptions,
      treeshake: isBrowser
        ? { manualPureFunctions: BROWSER_PURE_CALLS }
        : {
            moduleSideEffects: (id) => !frameworkPackages.test(id),
            manualPureFunctions: SERVER_PURE_CALLS,
          },
    },
  };
  return {
    output: output.output,
    label: `${output.output} (${exportOf(output)} from ${project.indexSource})`,
    config: {
      ...config,
      plugins: [
        shimPlugin({ project, output, state }),
        ...(isBrowser
          ? [hostModulesPlugin()]
          : [
              serverVuePlugin(realpathSync(project.root), output.output, state),
            ]),
        ...presets,
        assetsPlugin(state),
      ],
    },
    state,
  };
};

const workerJob = (project: Project, entry: Entry, outDir: string): Job => {
  const state: JobState = { problem: null };
  return {
    output: entry.output,
    label: `${entry.output} (${entry.source})`,
    config: {
      ...bundleConfig(
        project,
        path.resolve(project.root, entry.source),
        entry.output,
        outDir,
        true,
      ),
      plugins: [
        serverVuePlugin(realpathSync(project.root), entry.output, state),
        assetsPlugin(state),
      ],
    },
    state,
  };
};

/** Project bundles: the server part, the client part, workers. */
export const jobsOf = async (
  project: Project,
  outDir: string,
): Promise<Job[]> => [
  ...(project.server === null
    ? []
    : [outputJob(project, project.server, outDir, [])]),
  ...(project.client === null
    ? []
    : [
        outputJob(
          project,
          project.client,
          outDir,
          await presetPlugins(project.frameworks, {
            extensionId: project.manifest.id,
          }),
        ),
      ]),
  ...project.workerEntries.map((entry) => workerJob(project, entry, outDir)),
];

/** Failure cause: a reconciliation or guard error named by the plugin, or the bundler's text. */
export const failureDetail = (job: Job, error: unknown): string =>
  job.state.problem ?? errorText(error);

/** Builds all bundles (one at a time, no shared chunks) into `outDir`. */
export const bundleAll = async (
  project: Project,
  outDir: string,
): Promise<void> => {
  for (const job of await jobsOf(project, outDir)) {
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
