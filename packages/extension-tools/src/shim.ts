import { builtinModules } from 'node:module';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import {
  RECORDS,
  analyzeIndex,
  importsOf,
  pruneRecords,
  stripBareImports,
} from './analyze.ts';
import type { IndexAnalysis, RecordName, RecordSite } from './analyze.ts';
import { WINDOW_SPECIFIER } from './host-modules.ts';
import type { BrowserOutput, HostOutput, Project } from './project.ts';

export type Output = HostOutput | BrowserOutput;

/** Path of the virtual shim: the build's `lib.entry` and the plugin's `resolveId`; there is no file on disk. */
export const shimEntry = (project: Project, output: Output): string =>
  path.join(
    project.root,
    'src',
    `.dolphy-ext-${output.output.replaceAll(/[^\w.-]/g, '-')}.js`,
  );

const quote = (text: string): string => JSON.stringify(text);

const tableOf = (name: RecordName, keys: readonly string[]): string =>
  `{ ${keys.map((key) => `${quote(key)}: ${name}[${quote(key)}]`).join(', ')} }`;

/** Which `src/index.ts` entries the output file needs: entry name → keys. */
export const wantedRecords = (
  output: Output,
): Record<RecordName, readonly string[]> =>
  output.kind === 'host'
    ? { views: [], panels: [], widgets: [], markdown: [] }
    : {
        views: output.views.map((view) => view.id),
        panels: output.panels,
        widgets: output.widgets,
        markdown: output.languages,
      };

/** Exports of `src/index.ts` the file is built from (for messages). */
export const exportsOf = (output: Output): string[] =>
  output.kind === 'host'
    ? ['host']
    : RECORDS.filter((name) => wantedRecords(output)[name].length > 0);

/**
 * Source of the output file's virtual shim: imports from `src/index.ts` only
 * what is needed and does what the app expects from this file. The
 * `export default` result is the module the app loads: the extension module
 * of the host file, or the tables of Vue components of a browser file.
 */
export const shimSource = (output: Output, indexFile: string): string => {
  if (output.kind === 'host') {
    return `export { host as default } from ${quote(indexFile)};\n`;
  }
  const wanted = wantedRecords(output);
  const records = RECORDS.filter((name) => wanted[name].length > 0);
  return [
    `import { ${records.join(', ')} } from ${quote(indexFile)};`,
    `export default { ${records.map((name) => `${name}: ${tableOf(name, wanted[name])}`).join(', ')} };`,
    '',
  ].join('\n');
};

/** Mismatches between `src/index.ts` and the manifest; empty — everything agrees. */
export const findMismatches = (
  project: Project,
  analysis: IndexAnalysis,
  indexSource: string,
  root: string,
): string[] => {
  const problems: string[] = [];
  if (project.host !== null && !analysis.hasHost) {
    problems.push(
      `${indexSource} does not export 'host' for ${project.host.output}: add export const host = defineExtension({ … })`,
    );
  }
  const declared: Record<RecordName, string[]> = {
    views: project.manifest.contributes.exerciseTypes.map((type) => type.id),
    panels: project.manifest.contributes.panels.map((panel) => panel.id),
    widgets: project.manifest.contributes.widgets.map((widget) => widget.id),
    markdown: project.manifest.contributes.markdownRenderers.map(
      (entry) => entry.language,
    ),
  };
  const what: Record<RecordName, string> = {
    views: 'exercise type',
    panels: 'panel',
    widgets: 'widget',
    markdown: 'markdown renderer',
  };
  const fix: Record<RecordName, string> = {
    views: 'defineAnswerView(…)',
    panels: 'defineExtensionPanel(…)',
    widgets: 'defineExtensionWidget(…)',
    markdown: 'defineMarkdownRenderer(…)',
  };
  for (const name of RECORDS) {
    const result = analysis.records[name];
    const ids = declared[name];
    if (result.status === 'opaque') {
      problems.push(
        `${indexSource}: cannot read the keys of '${name}' (${result.reason}); declare it as an object literal with static keys`,
      );
    } else if (result.status === 'missing') {
      if (ids.length > 0) {
        problems.push(
          `${indexSource} does not export '${name}', but extension.json declares ${what[name]} ${ids.map((id) => `'${id}'`).join(', ')}: add export const ${name} = { ${quote(ids[0] as string)}: ${fix[name]} }`,
        );
      }
    } else {
      const file = path
        .relative(root, result.site.file)
        .split(path.sep)
        .join('/');
      const keys = result.site.keys.map((key) => key.name);
      for (const id of ids) {
        if (!keys.includes(id)) {
          problems.push(
            `${file}: '${name}' has no entry '${id}', but extension.json declares ${what[name]} '${id}'`,
          );
        }
      }
      for (const key of keys) {
        if (!ids.includes(key)) {
          problems.push(
            `${file}: '${name}' has entry '${key}', but extension.json declares no ${what[name]} '${key}'`,
          );
        }
      }
    }
  }
  return problems;
};

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
 * Build plugin for a single output file: the virtual shim, reconciliation of
 * `src/index.ts` with the manifest on every (re)build, pruning of entries not
 * belonging to the file, and protection of browser files from `node:*`.
 */
export const shimPlugin = ({
  project,
  output,
  state,
}: ShimPluginOptions): Plugin => {
  const indexSource = project.indexSource as string;
  // modules reach the hooks by real paths (on macOS `/tmp` is a symlink)
  const root = realpathSync(project.root);
  const indexFile = path.join(root, indexSource);
  const shimId = shimEntry(project, output);
  let sites: { site: RecordSite; keep: Set<string> }[] = [];
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
      // an import is not an error while it stays in the output file after the
      // host code is pruned: `generateBundle` checks that
      if (
        output.kind === 'browser' &&
        isNodeSpecifier(specifier, project.external)
      ) {
        return { id: specifier, external: true };
      }
      return null;
    },
    generateBundle(_options, bundle) {
      if (output.kind === 'host') {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue;
          // `import "vue"` stays from the pruned code of the views: it is not for Node
          chunk.code = stripBareImports(chunk.code, (specifier) =>
            WINDOW_SPECIFIER.test(specifier),
          );
          const leaked = [...importsOf(chunk.code)].find((specifier) =>
            WINDOW_SPECIFIER.test(specifier),
          );
          if (leaked !== undefined) {
            fail(
              this,
              `${output.output} imports '${leaked}': vue and vuetify are for views, panels, widgets and markdown renderers, keep them out of the code of the extension host`,
            );
          }
        }
        return;
      }
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        // the bundler leaves binding-less `import "node:…"` from pruned host code
        chunk.code = stripBareImports(chunk.code, (specifier) =>
          isNodeSpecifier(specifier, project.external),
        );
        // `chunk.imports` also remembers pruned imports: look at the code itself
        const leaked = [...importsOf(chunk.code)].find((specifier) =>
          isNodeSpecifier(specifier, project.external),
        );
        if (leaked !== undefined) {
          fail(
            this,
            `${output.output} imports '${leaked}': Node.js modules and the 'external' packages of dolphy-ext.config.json are for the extension host, keep them out of the components of views, panels, widgets and markdown renderers`,
          );
        }
      }
    },
    async buildStart() {
      // a build that failed here loaded no modules: without this the watcher
      // would not learn that the source was fixed
      this.addWatchFile(indexFile);
      const analysis = await analyzeIndex(indexFile).catch((error: unknown) =>
        fail(this, `${indexSource} cannot be read: ${String(error)}`),
      );
      for (const file of analysis.files) this.addWatchFile(file);
      const problems = findMismatches(project, analysis, indexSource, root);
      if (problems.length > 0) fail(this, problems.join('; '));
      const wanted = wantedRecords(output);
      sites = RECORDS.flatMap((name) => {
        const result = analysis.records[name];
        return result.status === 'found'
          ? [{ site: result.site, keep: new Set(wanted[name]) }]
          : [];
      });
    },
    load(id) {
      return id === shimId ? shimSource(output, indexFile) : null;
    },
    transform(code, id) {
      const here = sites.filter(({ site }) => site.file === id);
      const first = here[0];
      if (first === undefined || first.site.source !== code) return null;
      return pruneRecords(code, here);
    },
  };
};
