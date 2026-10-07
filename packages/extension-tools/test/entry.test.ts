import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildError, buildExtension, validateExtension } from '../src/index.ts';
import { copyProject } from './helpers.ts';

const read = (dir: string, file: string): Promise<string> =>
  readFile(path.join(dir, file), 'utf8');

const buildSurfaces = async () => {
  const root = await copyProject('surfaces');
  const result = await buildExtension({ root, outDir: path.join(root, 'out') });
  return { root, ...result };
};

/** Browser files read `vue` from the app: here the loader gives the test's own instance. */
const importFile = (dir: string, file: string): Promise<unknown> => {
  vi.stubGlobal('__dolphy', {
    require: (name: string) => import(name) as Promise<unknown>,
  });
  return import(pathToFileURL(path.join(dir, file)).href) as Promise<unknown>;
};

type Components = Record<string, { render(): { children: string } }>;

/** The text the component draws: the fixtures render a single element with it. */
const textOf = (components: Components, id: string): string | undefined =>
  components[id]?.render().children;

const edit = async (
  file: string,
  change: (text: string) => string,
): Promise<void> => {
  await writeFile(file, change(await readFile(file, 'utf8')));
};

const failure = async (root: string): Promise<string> => {
  const error = await buildExtension({ root }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BuildError);
  return (error as BuildError).message;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shims: output files', () => {
  it('the file set is exactly from the manifest, no shared chunks', async () => {
    const { files, dir } = await buildSurfaces();
    expect(files).toEqual([
      'extension.json',
      'main.mjs',
      'markdown.mjs',
      'panel.mjs',
      'ui/gauge.js',
      'view-three.mjs',
      'view.mjs',
      'widget.mjs',
    ]);
    expect(await validateExtension(dir)).toEqual({
      ok: true,
      problems: [],
      warnings: [],
    });
  });

  it('host code only in main.mjs, the code of each view, panel and renderer only in its own file', async () => {
    const { dir } = await buildSurfaces();
    const markers = [
      'HOST_ONLY_MARKER',
      'VIEW_ONE_MARKER',
      'VIEW_TWO_MARKER',
      'VIEW_THREE_MARKER',
      'PANEL_FIRST_MARKER',
      'PANEL_SECOND_MARKER',
      'WIDGET_CARD_MARKER',
      'WIDGET_GAUGE_MARKER',
      'WIDGET_BADGE_MARKER',
      'ALPHA_MARKER',
      'BETA_MARKER',
    ];
    const expected: Record<string, string[]> = {
      'main.mjs': ['HOST_ONLY_MARKER'],
      'view.mjs': ['VIEW_ONE_MARKER', 'VIEW_TWO_MARKER'],
      'view-three.mjs': ['VIEW_THREE_MARKER'],
      'panel.mjs': ['PANEL_FIRST_MARKER', 'PANEL_SECOND_MARKER'],
      'widget.mjs': ['WIDGET_CARD_MARKER', 'WIDGET_BADGE_MARKER'],
      'ui/gauge.js': ['WIDGET_GAUGE_MARKER'],
      'markdown.mjs': ['ALPHA_MARKER', 'BETA_MARKER'],
    };
    for (const [file, own] of Object.entries(expected)) {
      const code = await read(dir, file);
      const present = markers.filter((marker) => code.includes(marker));
      expect(present, file).toEqual(own);
    }
    for (const file of [
      'view.mjs',
      'view-three.mjs',
      'panel.mjs',
      'widget.mjs',
      'ui/gauge.js',
      'markdown.mjs',
    ]) {
      expect(await read(dir, file), file).not.toContain('child_process');
    }
  });

  it('main.mjs exports host as default', async () => {
    const { dir } = await buildSurfaces();
    const module = (await importFile(dir, 'main.mjs')) as {
      default: { activate: unknown };
    };
    expect(typeof module.default.activate).toBe('function');
  });

  it('a file with panels exports a table of components by panel id', async () => {
    const { dir } = await buildSurfaces();
    const { default: module } = (await importFile(dir, 'panel.mjs')) as {
      default: { panels: Components };
    };
    expect(Object.keys(module)).toEqual(['panels']);
    expect(Object.keys(module.panels)).toEqual([
      'acme.surfaces.first',
      'acme.surfaces.second',
    ]);
    expect(textOf(module.panels, 'acme.surfaces.first')).toBe(
      'PANEL_FIRST_MARKER',
    );
    expect(textOf(module.panels, 'acme.surfaces.second')).toBe(
      'PANEL_SECOND_MARKER',
    );
  });

  it('a file with widgets exports a table of components by widget id; a widget with its own module gets its own file', async () => {
    const { dir } = await buildSurfaces();
    type Module = { default: { widgets: Components } };
    const { default: shared } = (await importFile(dir, 'widget.mjs')) as Module;
    const { default: own } = (await importFile(dir, 'ui/gauge.js')) as Module;
    expect(Object.keys(shared.widgets)).toEqual([
      'acme.surfaces.card',
      'acme.surfaces.badge',
    ]);
    expect(textOf(shared.widgets, 'acme.surfaces.card')).toBe(
      'WIDGET_CARD_MARKER',
    );
    expect(textOf(shared.widgets, 'acme.surfaces.badge')).toBe(
      'WIDGET_BADGE_MARKER',
    );
    expect(Object.keys(own.widgets)).toEqual(['acme.surfaces.gauge']);
    expect(textOf(own.widgets, 'acme.surfaces.gauge')).toBe(
      'WIDGET_GAUGE_MARKER',
    );
  });

  it('a file with markdown renderers exports a table of components by block language', async () => {
    const { dir } = await buildSurfaces();
    const { default: module } = (await importFile(dir, 'markdown.mjs')) as {
      default: { markdown: Components };
    };
    expect(Object.keys(module.markdown)).toEqual(['alpha', 'beta']);
    expect(textOf(module.markdown, 'alpha')).toBe('ALPHA_MARKER');
    expect(textOf(module.markdown, 'beta')).toBe('BETA_MARKER');
  });

  it('a file with views exports a table of components by exercise type id', async () => {
    const { dir } = await buildSurfaces();
    type Module = { default: { views: Components } };
    const { default: shared } = (await importFile(dir, 'view.mjs')) as Module;
    const { default: own } = (await importFile(
      dir,
      'view-three.mjs',
    )) as Module;
    expect(Object.keys(shared.views)).toEqual([
      'acme.surfaces.one',
      'acme.surfaces.two',
    ]);
    expect(textOf(shared.views, 'acme.surfaces.one')).toBe('VIEW_ONE_MARKER');
    expect(textOf(shared.views, 'acme.surfaces.two')).toBe('VIEW_TWO_MARKER');
    expect(Object.keys(own.views)).toEqual(['acme.surfaces.three']);
  });

  it('a view bundle takes vue from the app and does not carry it', async () => {
    const { dir } = await buildSurfaces();
    const code = await read(dir, 'view.mjs');
    expect(code).toContain('globalThis.__dolphy.require("vue")');
    expect(code).not.toMatch(/from\s*["']vue/);
    expect(code).not.toContain('createVNode');
    expect(Buffer.byteLength(code)).toBeLessThan(2 * 1024);
  });

  it('one file can hold views, panels, widgets and markdown renderers', async () => {
    const root = await copyProject('surfaces');
    const manifestFile = path.join(root, 'extension.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    const { exerciseTypes, panels, widgets, markdownRenderers } =
      manifest.contributes;
    for (const type of exerciseTypes) type.renderer = './ui.mjs';
    for (const panel of panels) panel.module = './ui.mjs';
    for (const widget of widgets) widget.module = './ui.mjs';
    for (const entry of markdownRenderers) entry.renderer = './ui.mjs';
    await writeFile(manifestFile, JSON.stringify(manifest));
    const { dir, files } = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    expect(files).toEqual(['extension.json', 'main.mjs', 'ui.mjs']);
    const { default: module } = (await importFile(dir, 'ui.mjs')) as {
      default: Record<string, Components>;
    };
    expect(Object.keys(module)).toEqual([
      'views',
      'panels',
      'widgets',
      'markdown',
    ]);
    expect(Object.keys(module['views'] ?? {})).toHaveLength(3);
    expect(textOf(module['panels'] ?? {}, 'acme.surfaces.first')).toBe(
      'PANEL_FIRST_MARKER',
    );
    expect(textOf(module['widgets'] ?? {}, 'acme.surfaces.gauge')).toBe(
      'WIDGET_GAUGE_MARKER',
    );
    expect(textOf(module['markdown'] ?? {}, 'beta')).toBe('BETA_MARKER');
    expect(await read(dir, 'ui.mjs')).not.toContain('HOST_ONLY_MARKER');
  });

  it('main, renderer and module names from the manifest are preserved', async () => {
    const root = await copyProject('hello');
    const manifestFile = path.join(root, 'extension.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    manifest.main = './core/host.mjs';
    manifest.contributes.exerciseTypes[0].renderer = './ui/answer.mjs';
    await writeFile(manifestFile, JSON.stringify(manifest));
    const { files } = await buildExtension({ root });
    expect(files).toEqual(['core/host.mjs', 'extension.json', 'ui/answer.mjs']);
  });

  it('main: null — no node build, host not needed', async () => {
    const root = await copyProject('markdown-only');
    const { files, dir } = await buildExtension({ root });
    expect(files).toEqual(['extension.json', 'markdown.mjs']);
    expect(await validateExtension(dir)).toEqual({
      ok: true,
      problems: [],
      warnings: [],
    });
  });

  it('a view, panel, widget and renderer defined in other files are found through re-exports', async () => {
    const root = await copyProject('surfaces');
    await writeFile(
      path.join(root, 'src', 'surfaces.ts'),
      (await read(root, 'src/index.ts')).replace(
        /export const host[\s\S]*?\n\}\);\n/,
        '',
      ),
    );
    await edit(path.join(root, 'src', 'index.ts'), (text) => {
      const start = text.indexOf('const text =');
      return `${text.slice(0, start)}export { views, panels, widgets, markdown } from './surfaces.ts';\n`;
    });
    const { dir } = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    const view = await read(dir, 'view.mjs');
    expect(view).toContain('VIEW_ONE_MARKER');
    expect(view).not.toContain('VIEW_THREE_MARKER');
    expect(await read(dir, 'panel.mjs')).not.toContain('ALPHA_MARKER');
    expect(await read(dir, 'widget.mjs')).toContain('WIDGET_CARD_MARKER');
  });
  it('entry trimming is correct even with non-ASCII text before them', async () => {
    const root = await copyProject('surfaces');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace(
        'export const views',
        "export const note = 'Hello, world — 😀';\nexport const views",
      ),
    );
    const { dir } = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    const view = await read(dir, 'view.mjs');
    expect(view).toContain('VIEW_ONE_MARKER');
    expect(view).not.toContain('VIEW_THREE_MARKER');
    expect(await read(dir, 'view-three.mjs')).not.toContain('VIEW_ONE_MARKER');
  });
});

describe('reconciliation with the manifest', () => {
  it('no views entry for a declared view', async () => {
    const root = await copyProject('surfaces');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace(
        "  'acme.surfaces.three': defineAnswerView(text('VIEW_THREE_MARKER')),\n",
        '',
      ),
    );
    const message = await failure(root);
    expect(message).toContain(
      "src/index.ts: 'views' has no entry 'acme.surfaces.three'",
    );
  });

  it('an extra key in panels names the key and file', async () => {
    const root = await copyProject('surfaces');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace(
        'export const panels = {',
        "export const panels = {\n  'acme.surfaces.ghost': defineExtensionPanel(text('GHOST_MARKER')),",
      ),
    );
    const message = await failure(root);
    expect(message).toContain(
      "src/index.ts: 'panels' has entry 'acme.surfaces.ghost'",
    );
  });

  it('a declared widget without an entry and an extra widget key name the keys', async () => {
    const root = await copyProject('surfaces');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace(
        "  'acme.surfaces.badge': defineExtensionWidget",
        "  'acme.surfaces.ghost': defineExtensionWidget",
      ),
    );
    const message = await failure(root);
    expect(message).toContain("'widgets' has no entry 'acme.surfaces.badge'");
    expect(message).toContain("'widgets' has entry 'acme.surfaces.ghost'");
  });

  it('no markdown entry for a declared language, and an extra language', async () => {
    const root = await copyProject('surfaces');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace(
        '  beta: defineMarkdownRenderer',
        '  gamma: defineMarkdownRenderer',
      ),
    );
    const message = await failure(root);
    expect(message).toContain("'markdown' has no entry 'beta'");
    expect(message).toContain("'markdown' has entry 'gamma'");
  });

  it('no host export when main is set', async () => {
    const root = await copyProject('surfaces');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace('export const host', 'const host'),
    );
    expect(await failure(root)).toContain(
      "does not export 'host' for main.mjs",
    );
  });

  it('no views export when views are declared', async () => {
    const root = await copyProject('hello');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace('export const views', 'const views'),
    );
    const message = await failure(root);
    expect(message).toContain("does not export 'views'");
    expect(message).toContain("'acme.hello'");
  });

  it('keys that cannot be read from the source — an error with the cause', async () => {
    const root = await copyProject('hello');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace(
        "export const views = {\n  'acme.hello': defineAnswerView(input),\n};",
        "const entries = { 'acme.hello': defineAnswerView(input) };\nexport const views = { ...entries };",
      ),
    );
    expect(await failure(root)).toContain("cannot read the keys of 'views'");
  });

  it('keys given by a constant and as const are read', async () => {
    const root = await copyProject('hello');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace(
        "export const views = {\n  'acme.hello': defineAnswerView(input),\n};",
        "const table = { 'acme.hello': defineAnswerView(input) } as const;\nexport const views = table;",
      ),
    );
    const { files } = await buildExtension({ root });
    expect(files).toContain('view.mjs');
  });

  it('an error in src/index.ts itself names the output files', async () => {
    const root = await copyProject('hello');
    await edit(
      path.join(root, 'src', 'index.ts'),
      (text) => `${text}\nexport const = ;`,
    );
    const message = await failure(root);
    expect(message).toContain(
      'failed to bundle main.mjs (host from src/index.ts)',
    );
  });
});

describe('protecting browser files from Node modules', () => {
  it('node:* used by a view — an error with the file and module', async () => {
    const root = await copyProject('hello');
    await edit(
      path.join(root, 'src', 'index.ts'),
      (text) =>
        `import { readFileSync } from 'node:fs';\n${text.replace("h('input')", "(readFileSync('x'), h('input'))")}`,
    );
    const message = await failure(root);
    expect(message).toContain('view.mjs imports');
    expect(message).toContain("'node:fs'");
  });

  it('a built-in module without the prefix too', async () => {
    const root = await copyProject('hello');
    await edit(
      path.join(root, 'src', 'index.ts'),
      (text) =>
        `import { join } from 'path';\n${text.replace("h('input')", "(join('x'), h('input'))")}`,
    );
    expect(await failure(root)).toContain("'path'");
  });

  it('a package from the config’s external that a view needs — an error', async () => {
    const root = await copyProject('with-worker');
    await edit(
      path.join(root, 'src', 'index.ts'),
      (text) =>
        `import external from 'dolphy-fixture-external';\n${text.replace("'worker view'", 'String(external)')}`,
    );
    const message = await failure(root);
    expect(message).toContain('view.mjs imports');
    expect(message).toContain("'dolphy-fixture-external'");
  });

  it('node:* in host code is fine while no view uses it', async () => {
    const { files } = await buildSurfaces();
    expect(files).toContain('view.mjs');
  });
});

describe('old layout', () => {
  it('no src/index.ts, but src/main.ts and src/view.ts exist — an error with migration steps', async () => {
    const root = await copyProject('legacy-layout');
    const message = await failure(root);
    expect(message).toContain("'src/index.ts' is not found");
    expect(message).toContain('old layout (src/main.ts, src/view.ts)');
    expect(message).toContain('export const host = defineExtension');
    expect(message).toContain('export const views = ');
    expect(message).toContain('defineAnswerView');
    expect(message).toContain('export const panels = ');
    expect(message).not.toContain('export const markdown');
  });

  it('no old files either — a hint to create src/index.ts', async () => {
    const root = await copyProject('legacy-layout');
    await rm(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(root, 'src'));
    const message = await failure(root);
    expect(message).toContain('add it: 1. create src/index.ts');
    expect(message).not.toContain('old layout');
  });

  it('src/main.ts is not picked up on its own when src/index.ts exists', async () => {
    const root = await copyProject('hello');
    await rename(
      path.join(root, 'src', 'index.ts'),
      path.join(root, 'src', 'main.ts'),
    );
    await writeFile(path.join(root, 'src', 'index.ts'), 'export {};\n');
    expect(await failure(root)).toContain("does not export 'host'");
  });
});

describe('importing src/index.ts', () => {
  it('in plain Node without DOM registers nothing and returns the components', async () => {
    const root = await copyProject('surfaces');
    const script = `
      const module = await import(${JSON.stringify(pathToFileURL(path.join(root, 'src', 'index.ts')).href)});
      process.stdout.write(JSON.stringify({
        document: typeof document,
        customElements: typeof customElements,
        views: Object.keys(module.views),
        renders: Object.values(module.views).map((view) => typeof view.render),
        panels: Object.keys(module.panels),
        host: typeof module.host.activate,
      }));
    `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        '--input-type=module',
        '-e',
        script,
      ],
      { cwd: root },
    );
    expect(JSON.parse(stdout)).toEqual({
      document: 'undefined',
      customElements: 'undefined',
      views: ['acme.surfaces.one', 'acme.surfaces.two', 'acme.surfaces.three'],
      renders: ['function', 'function', 'function'],
      panels: ['acme.surfaces.first', 'acme.surfaces.second'],
      host: 'function',
    });
  });
});
