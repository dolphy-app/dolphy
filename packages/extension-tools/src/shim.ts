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
import type { BrowserOutput, HostOutput, Project } from './project.ts';

/** Подпуть SDK с регистрацией элементов и диспетчеризацией; разрешается из проекта автора. */
export const SDK_RUNTIME = '@dolphy-app/extension-sdk/runtime';

export type Output = HostOutput | BrowserOutput;

/** Путь виртуальной обвязки: `lib.entry` сборки и `resolveId` плагина; файла на диске нет. */
export const shimEntry = (project: Project, output: Output): string =>
  path.join(
    project.root,
    'src',
    `.dolphy-ext-${output.output.replaceAll(/[^\w.-]/g, '-')}.js`,
  );

const quote = (text: string): string => JSON.stringify(text);

/** Какие записи `src/index.ts` нужны выходному файлу: имя записи → ключи. */
export const wantedRecords = (
  output: Output,
): Record<RecordName, readonly string[]> =>
  output.kind === 'host'
    ? { views: [], panels: [], markdown: [] }
    : {
        views: output.views.map((view) => view.id),
        panels: output.panels,
        markdown: output.languages,
      };

/** Экспорты `src/index.ts`, из которых собран файл (для сообщений). */
export const exportsOf = (output: Output): string[] =>
  output.kind === 'host'
    ? ['host']
    : RECORDS.filter((name) => wantedRecords(output)[name].length > 0);

/**
 * Исходник виртуальной обвязки выходного файла: импортирует из `src/index.ts`
 * только нужное и делает то, чего ждёт приложение от этого файла. Результат
 * `export default` — модуль, который грузит приложение (`ExtensionModule`,
 * модуль панели, модуль рендерера); файл вида выполняет регистрацию элементов.
 */
export const shimSource = (output: Output, indexFile: string): string => {
  if (output.kind === 'host') {
    return `export { host as default } from ${quote(indexFile)};\n`;
  }
  const runtime: string[] = [];
  const body: string[] = [];
  const modules: string[] = [];
  if (output.views.length > 0) {
    runtime.push('registerAnswerView');
    for (const view of output.views) {
      body.push(
        `registerAnswerView(${quote(view.element)}, views[${quote(view.id)}]);`,
      );
    }
  }
  const table = (name: RecordName, keys: readonly string[]): string =>
    `{ ${keys.map((key) => `${quote(key)}: ${name}[${quote(key)}]`).join(', ')} }`;
  if (output.panels.length > 0) {
    runtime.push('dispatchPanels');
    modules.push(`...dispatchPanels(${table('panels', output.panels)})`);
  }
  if (output.languages.length > 0) {
    runtime.push('dispatchMarkdown');
    modules.push(`...dispatchMarkdown(${table('markdown', output.languages)})`);
  }
  const records = RECORDS.filter(
    (name) => wantedRecords(output)[name].length > 0,
  );
  const lines = [
    `import { ${records.join(', ')} } from ${quote(indexFile)};`,
    `import { ${runtime.join(', ')} } from ${quote(SDK_RUNTIME)};`,
    ...body,
  ];
  if (modules.length > 0)
    lines.push(`export default { ${modules.join(', ')} };`);
  return `${lines.join('\n')}\n`;
};

/** Несовпадения `src/index.ts` с манифестом; пусто — всё сходится. */
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
    markdown: project.manifest.contributes.markdownRenderers.map(
      (entry) => entry.language,
    ),
  };
  const what: Record<RecordName, string> = {
    views: 'exercise type',
    panels: 'panel',
    markdown: 'markdown renderer',
  };
  const fix: Record<RecordName, string> = {
    views: 'defineAnswerView(…)',
    panels: 'defineExtensionPanel(…)',
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

/** Разделяет ошибку, которую нужно показать автору как есть, и сбой бандлера. */
export interface JobState {
  problem: string | null;
}

export interface ShimPluginOptions {
  project: Project;
  output: Output;
  state: JobState;
}

/**
 * Плагин сборки одного выходного файла: виртуальная обвязка, сверка
 * `src/index.ts` с манифестом на каждой (пере)сборке, отсечение записей, не
 * относящихся к файлу, и защита браузерных файлов от `node:*`.
 */
export const shimPlugin = ({
  project,
  output,
  state,
}: ShimPluginOptions): Plugin => {
  const indexSource = project.indexSource as string;
  // модули приходят в хуки по реальным путям (на macOS `/tmp` — ссылка)
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
      // импорт не ошибка, пока он остаётся в выходном файле после отсечения
      // кода хоста: проверяет `generateBundle`
      if (
        output.kind === 'browser' &&
        isNodeSpecifier(specifier, project.external)
      ) {
        return { id: specifier, external: true };
      }
      return null;
    },
    generateBundle(_options, bundle) {
      if (output.kind !== 'browser') return;
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        // от отсечённого кода хоста бандлер оставляет `import "node:…"` без привязок
        chunk.code = stripBareImports(chunk.code, (specifier) =>
          isNodeSpecifier(specifier, project.external),
        );
        // `chunk.imports` помнит и отсечённые импорты: смотрим на сам код
        const leaked = [...importsOf(chunk.code)].find((specifier) =>
          isNodeSpecifier(specifier, project.external),
        );
        if (leaked !== undefined) {
          fail(
            this,
            `${output.output} imports '${leaked}': Node.js modules and the 'external' packages of dolphy-ext.config.json are for the extension host, keep them out of code that views, panels and markdown renderers use`,
          );
        }
      }
    },
    async buildStart() {
      // сборка, упавшая здесь, не загрузила ни одного модуля: без этого вотчер
      // не узнает, что исходник поправили
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
