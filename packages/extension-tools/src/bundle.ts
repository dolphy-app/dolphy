import { builtinModules } from 'node:module';
import path from 'node:path';
import { build } from 'vite';
import type { InlineConfig } from 'vite';
import { BuildError } from './errors.ts';
import type { Entry, Project } from './project.ts';

interface WatcherEvent {
  code: string;
  error?: unknown;
}

/** Структурный вид rolldown-вотчера, который возвращает `build` с `watch`. */
interface Watcher {
  on(event: 'event', listener: (event: WatcherEvent) => void): unknown;
  close(): Promise<void>;
}

const isWatcher = (value: unknown): value is Watcher =>
  typeof value === 'object' &&
  value !== null &&
  'on' in value &&
  'close' in value;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const nodeExternal = (external: readonly string[]): (string | RegExp)[] => [
  /^node:/,
  ...builtinModules,
  ...external,
];

const bundleConfig = (
  project: Project,
  entry: Entry,
  outDir: string,
  isNode: boolean,
): InlineConfig => ({
  root: project.root,
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    target: isNode ? 'node22' : 'es2022',
    outDir,
    emptyOutDir: false,
    minify: false,
    copyPublicDir: false,
    lib: {
      entry: path.resolve(project.root, entry.source),
      formats: ['es'],
      fileName: () => entry.output,
    },
    rolldownOptions: {
      external: isNode ? nodeExternal(project.external) : [],
    },
  },
});

const configsOf = (project: Project, outDir: string): InlineConfig[] => [
  ...project.nodeEntries.map((entry) =>
    bundleConfig(project, entry, outDir, true),
  ),
  ...project.browserEntries.map((entry) =>
    bundleConfig(project, entry, outDir, false),
  ),
];

const sourcesOf = (project: Project): Entry[] => [
  ...project.nodeEntries,
  ...project.browserEntries,
];

const buildOne = async (
  config: InlineConfig,
  entry: Entry,
  subject: string,
): Promise<void> => {
  try {
    await build(config);
  } catch (error) {
    throw new BuildError(
      `failed to bundle '${entry.source}': ${errorText(error)}`,
      subject,
    );
  }
};

/** Собирает все бандлы (по одному, без общих чанков) в `outDir`. */
export const bundleAll = async (
  project: Project,
  outDir: string,
): Promise<void> => {
  const configs = configsOf(project, outDir);
  const entries = sourcesOf(project);
  for (const [index, config] of configs.entries()) {
    await buildOne(config, entries[index] as Entry, project.manifest.id);
  }
};

export interface BundleWatch {
  close(): Promise<void>;
}

const whenFirstEnd = (
  watcher: Watcher,
  entry: Entry,
  onRebuild: (entry: Entry, error: unknown) => void,
): Promise<void> => {
  let isFirst = true;
  return new Promise((resolve, reject) => {
    watcher.on('event', (event) => {
      if (event.code === 'ERROR') {
        if (isFirst) reject(event.error);
        else onRebuild(entry, event.error);
      }
      if (event.code === 'END') {
        if (isFirst) resolve();
        else onRebuild(entry, null);
        isFirst = false;
      }
    });
  });
};

/**
 * Запускает вотчеры всех бандлов; резолвится после первой сборки каждого.
 * `onRebuild` вызывается после последующих пересборок (`error` — причина сбоя).
 */
export const watchAll = async (
  project: Project,
  outDir: string,
  onRebuild: (entry: Entry, error: unknown) => void,
): Promise<BundleWatch> => {
  const watchers: Watcher[] = [];
  const close = async (): Promise<void> => {
    await Promise.all(watchers.map((watcher) => watcher.close()));
  };
  const entries = sourcesOf(project);
  try {
    const firsts: Promise<void>[] = [];
    for (const [index, config] of configsOf(project, outDir).entries()) {
      const entry = entries[index] as Entry;
      const started = await build({
        ...config,
        build: { ...config.build, watch: {} },
      });
      if (!isWatcher(started)) {
        throw new Error(`watch mode is not available for '${entry.source}'`);
      }
      watchers.push(started);
      firsts.push(whenFirstEnd(started, entry, onRebuild));
    }
    await Promise.all(firsts);
  } catch (error) {
    await close();
    throw new BuildError(
      `failed to bundle: ${errorText(error)}`,
      project.manifest.id,
    );
  }
  return { close };
};
