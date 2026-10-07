import { builtinModules } from 'node:module';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { analyzeIndex, importsOf, stripBareImports } from './analyze.ts';
import { WINDOW_SPECIFIER } from './host-modules.ts';
import type { ClientOutput, Project, ServerOutput } from './project.ts';

export type Output = ServerOutput | ClientOutput;

/** Path of the virtual shim: the build's `lib.entry` and the plugin's `resolveId`; there is no file on disk. */
export const shimEntry = (project: Project, output: Output): string =>
  path.join(
    project.root,
    'src',
    `.dolphy-ext-${output.output.replaceAll(/[^\w.-]/g, '-')}.js`,
  );

/** Export of `src/index.ts` the output file is built from. */
export const exportOf = (output: Output): 'server' | 'client' => output.kind;

/**
 * Source of the output file's virtual shim: the file's only export is the
 * entry the app loads (`server` or `client`).
 */
export const shimSource = (output: Output, indexFile: string): string =>
  `export { ${exportOf(output)} } from ${JSON.stringify(indexFile)};\n`;

const isNodeSpecifier = (
  specifier: string,
  external: readonly string[],
): boolean =>
  specifier.startsWith('node:') ||
  builtinModules.includes(specifier) ||
  external.some(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  );

/** Separates an error to show the author as is from a bundler failure. */
export interface JobState {
  problem: string | null;
}

export interface ShimPluginOptions {
  project: Project;
  output: Output;
  state: JobState;
}

/**
 * Build plugin for a single output file: the virtual shim, the check that
 * `src/index.ts` still exports what the file is built from, and the boundary
 * rules: the client file takes no Node.js modules, the server file no `vue`
 * or `vuetify`.
 */
export const shimPlugin = ({
  project,
  output,
  state,
}: ShimPluginOptions): Plugin => {
  // modules reach the hooks by real paths (on macOS `/tmp` is a symlink)
  const root = realpathSync(project.root);
  const indexFile = path.join(root, project.indexSource);
  const shimId = shimEntry(project, output);
  const fail = (
    context: { error(message: string): never },
    message: string,
  ) => {
    state.problem = message;
    return context.error(message);
  };
  return {
    name: 'dolphy-ext:entry',
    enforce: 'pre',
    resolveId(specifier) {
      if (specifier === shimId) return shimId;
      // an import is not an error while tree shaking drops it from the output
      // file: `generateBundle` checks that
      if (
        output.kind === 'client' &&
        isNodeSpecifier(specifier, project.external)
      ) {
        return { id: specifier, external: true };
      }
      return null;
    },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        if (output.kind === 'server') {
          // `import "vue"` stays from the code of the client part: it is not for Node
          chunk.code = stripBareImports(chunk.code, (specifier) =>
            WINDOW_SPECIFIER.test(specifier),
          );
          const leaked = [...importsOf(chunk.code)].find((specifier) =>
            WINDOW_SPECIFIER.test(specifier),
          );
          if (leaked !== undefined) {
            fail(
              this,
              `${output.output} imports '${leaked}': vue and vuetify belong to the client part, keep them out of the code of 'server'`,
            );
          }
        } else {
          // the bundler leaves binding-less `import "node:…"` from the code of the server part
          chunk.code = stripBareImports(chunk.code, (specifier) =>
            isNodeSpecifier(specifier, project.external),
          );
          // `chunk.imports` also remembers dropped imports: look at the code itself
          const leaked = [...importsOf(chunk.code)].find((specifier) =>
            isNodeSpecifier(specifier, project.external),
          );
          if (leaked !== undefined) {
            fail(
              this,
              `${output.output} imports '${leaked}': Node.js modules and the 'external' packages of dolphy-ext.config.json belong to the server part, keep them out of the code of 'client'`,
            );
          }
        }
      }
    },
    async buildStart() {
      // a build that failed here loaded no modules: without this the watcher
      // would not learn that the source was fixed
      this.addWatchFile(indexFile);
      const analysis = await analyzeIndex(indexFile).catch((error: unknown) =>
        fail(this, `${project.indexSource} cannot be read: ${String(error)}`),
      );
      for (const file of analysis.files) this.addWatchFile(file);
      const name = exportOf(output);
      const has =
        output.kind === 'server' ? analysis.hasServer : analysis.hasClient;
      if (!has) {
        fail(
          this,
          `${project.indexSource} does not export '${name}', but ${output.output} is built from it`,
        );
      }
    },
    load(id) {
      return id === shimId ? shimSource(output, indexFile) : null;
    },
  };
};
