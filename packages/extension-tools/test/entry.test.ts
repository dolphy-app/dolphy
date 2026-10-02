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

const importFile = (dir: string, file: string): Promise<unknown> =>
  import(pathToFileURL(path.join(dir, file)).href) as Promise<unknown>;

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

describe('обвязки: выходные файлы', () => {
  it('набор файлов ровно из манифеста, без общих чанков', async () => {
    const { files, dir } = await buildSurfaces();
    expect(files).toEqual([
      'extension.json',
      'main.mjs',
      'markdown.mjs',
      'panel.mjs',
      'view-three.mjs',
      'view.mjs',
    ]);
    expect(await validateExtension(dir)).toEqual({ ok: true, problems: [] });
  });

  it('код хоста — только в main.mjs, код каждого вида, панели и рендерера — только в своём файле', async () => {
    const { dir } = await buildSurfaces();
    const markers = [
      'HOST_ONLY_MARKER',
      'VIEW_ONE_MARKER',
      'VIEW_TWO_MARKER',
      'VIEW_THREE_MARKER',
      'PANEL_FIRST_MARKER',
      'PANEL_SECOND_MARKER',
      'ALPHA_MARKER',
      'BETA_MARKER',
    ];
    const expected: Record<string, string[]> = {
      'main.mjs': ['HOST_ONLY_MARKER'],
      'view.mjs': ['VIEW_ONE_MARKER', 'VIEW_TWO_MARKER'],
      'view-three.mjs': ['VIEW_THREE_MARKER'],
      'panel.mjs': ['PANEL_FIRST_MARKER', 'PANEL_SECOND_MARKER'],
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
      'markdown.mjs',
    ]) {
      expect(await read(dir, file), file).not.toContain('child_process');
    }
  });

  it('main.mjs отдаёт host как default и не регистрирует элементов', async () => {
    const { dir } = await buildSurfaces();
    const module = (await importFile(dir, 'main.mjs')) as {
      default: { activate: unknown };
    };
    expect(typeof module.default.activate).toBe('function');
  });

  it('панели одного файла диспетчеризуются по ctx.panelId', async () => {
    const { dir } = await buildSurfaces();
    const { default: panel } = (await importFile(dir, 'panel.mjs')) as {
      default: { mount(container: unknown, ctx: unknown): void };
    };
    const signal = new AbortController().signal;
    const mountAs = (panelId: string) => {
      const container = { textContent: '' };
      panel.mount(container, { panelId, props: undefined, signal });
      return container.textContent;
    };
    expect(mountAs('acme.surfaces.first')).toBe('PANEL_FIRST_MARKER');
    expect(mountAs('acme.surfaces.second')).toBe('PANEL_SECOND_MARKER');
    expect(() => mountAs('acme.surfaces.third')).toThrow(/not exported/);
  });

  it('рендереры одного файла диспетчеризуются по языку блока', async () => {
    const { dir } = await buildSurfaces();
    const { default: renderer } = (await importFile(dir, 'markdown.mjs')) as {
      default: {
        render(source: string, container: unknown, ctx: unknown): void;
      };
    };
    const signal = new AbortController().signal;
    const renderAs = (language: string) => {
      const container = { textContent: '' };
      renderer.render('x', container, { language, signal });
      return container.textContent;
    };
    expect(renderAs('alpha')).toBe('ALPHA_MARKER x');
    expect(renderAs('beta')).toBe('BETA_MARKER x');
    expect(() => renderAs('gamma')).toThrow(/not exported/);
  });

  it('файл вида регистрирует элемент на каждый вид с тегом из манифеста', async () => {
    const { dir } = await buildSurfaces();
    const defined = new Map<string, unknown>();
    vi.stubGlobal(
      'HTMLElement',
      class {
        attachShadow = () => ({});
      },
    );
    vi.stubGlobal('customElements', {
      get: (tag: string) => defined.get(tag),
      define: (tag: string, element: unknown) => void defined.set(tag, element),
    });
    await importFile(dir, 'view.mjs');
    expect([...defined.keys()]).toEqual([
      'acme-surfaces-one-answer',
      'acme-surfaces-two-answer',
    ]);
    await importFile(dir, 'view-three.mjs');
    expect([...defined.keys()]).toContain('acme-surfaces-three-answer');
    expect(defined.size).toBe(3);
  });

  it('имена main, renderer и module из манифеста сохраняются', async () => {
    const root = await copyProject('hello');
    const manifestFile = path.join(root, 'extension.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    manifest.main = './core/host.mjs';
    manifest.contributes.exerciseTypes[0].renderer = './ui/answer.mjs';
    await writeFile(manifestFile, JSON.stringify(manifest));
    const { files } = await buildExtension({ root });
    expect(files).toEqual(['core/host.mjs', 'extension.json', 'ui/answer.mjs']);
  });

  it('main: null — node-сборки нет, host не нужен', async () => {
    const root = await copyProject('markdown-only');
    const { files, dir } = await buildExtension({ root });
    expect(files).toEqual(['extension.json', 'markdown.mjs']);
    expect(await validateExtension(dir)).toEqual({ ok: true, problems: [] });
  });

  it('вид, панель и рендерер, описанные в других файлах, находятся через реэкспорт', async () => {
    const root = await copyProject('surfaces');
    await writeFile(
      path.join(root, 'src', 'surfaces.ts'),
      (await read(root, 'src/index.ts')).replace(
        /export const host[\s\S]*?\n\}\);\n/,
        '',
      ),
    );
    await edit(path.join(root, 'src', 'index.ts'), (text) => {
      const start = text.indexOf('const textView');
      return `${text.slice(0, start)}export { views, panels, markdown } from './surfaces.ts';\n`;
    });
    const { dir } = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    const view = await read(dir, 'view.mjs');
    expect(view).toContain('VIEW_ONE_MARKER');
    expect(view).not.toContain('VIEW_THREE_MARKER');
    expect(await read(dir, 'panel.mjs')).not.toContain('ALPHA_MARKER');
  });
});

describe('сверка с манифестом', () => {
  it('нет записи в views для объявленного вида', async () => {
    const root = await copyProject('surfaces');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace(
        "  'acme.surfaces.three': textView('VIEW_THREE_MARKER'),\n",
        '',
      ),
    );
    const message = await failure(root);
    expect(message).toContain(
      "src/index.ts: 'views' has no entry 'acme.surfaces.three'",
    );
  });

  it('лишний ключ в panels называет ключ и файл', async () => {
    const root = await copyProject('surfaces');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace(
        'export const panels = {',
        "export const panels = {\n  'acme.surfaces.ghost': defineExtensionPanel({ mount() {} }),",
      ),
    );
    const message = await failure(root);
    expect(message).toContain(
      "src/index.ts: 'panels' has entry 'acme.surfaces.ghost'",
    );
  });

  it('нет записи markdown для объявленного языка и лишний язык', async () => {
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

  it('нет экспорта host при заданном main', async () => {
    const root = await copyProject('surfaces');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace('export const host', 'const host'),
    );
    expect(await failure(root)).toContain(
      "does not export 'host' for main.mjs",
    );
  });

  it('нет экспорта views при объявленных видах', async () => {
    const root = await copyProject('hello');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace('export const views', 'const views'),
    );
    const message = await failure(root);
    expect(message).toContain("does not export 'views'");
    expect(message).toContain("'acme.hello'");
  });

  it('ключи, которые нельзя прочитать из исходника, — ошибка с причиной', async () => {
    const root = await copyProject('hello');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace(
        "export const views = {\n  'acme.hello': defineAnswerView(() => ({ update() {} })),\n};",
        "const entries = { 'acme.hello': defineAnswerView(() => ({ update() {} })) };\nexport const views = { ...entries };",
      ),
    );
    expect(await failure(root)).toContain("cannot read the keys of 'views'");
  });

  it('ключи, заданные константой и as const, читаются', async () => {
    const root = await copyProject('hello');
    await edit(path.join(root, 'src', 'index.ts'), (text) =>
      text.replace(
        "export const views = {\n  'acme.hello': defineAnswerView(() => ({ update() {} })),\n};",
        "const table = { 'acme.hello': defineAnswerView(() => ({ update() {} })) } as const;\nexport const views = table;",
      ),
    );
    const { files } = await buildExtension({ root });
    expect(files).toContain('view.mjs');
  });

  it('ошибка в самом src/index.ts называет выходные файлы', async () => {
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

describe('защита браузерных файлов от модулей Node', () => {
  it('используемый видом node:* — ошибка с файлом и модулем', async () => {
    const root = await copyProject('hello');
    await edit(
      path.join(root, 'src', 'index.ts'),
      (text) =>
        `import { readFileSync } from 'node:fs';\n${text.replace('update() {}', "update() { readFileSync('x'); }")}`,
    );
    const message = await failure(root);
    expect(message).toContain('view.mjs imports');
    expect(message).toContain("'node:fs'");
  });

  it('встроенный модуль без префикса тоже', async () => {
    const root = await copyProject('hello');
    await edit(
      path.join(root, 'src', 'index.ts'),
      (text) =>
        `import { join } from 'path';\n${text.replace('update() {}', "update() { join('x'); }")}`,
    );
    expect(await failure(root)).toContain("'path'");
  });

  it('пакет из external конфига, нужный виду, — ошибка', async () => {
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

  it('node:* в коде хоста не мешает, пока вид его не использует', async () => {
    const { files } = await buildSurfaces();
    expect(files).toContain('view.mjs');
  });
});

describe('старая раскладка', () => {
  it('нет src/index.ts, лежат src/main.ts и src/view.ts — ошибка со шагами переноса', async () => {
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

  it('нет и старых файлов — подсказка создать src/index.ts', async () => {
    const root = await copyProject('legacy-layout');
    await rm(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(root, 'src'));
    const message = await failure(root);
    expect(message).toContain('add it: 1. create src/index.ts');
    expect(message).not.toContain('old layout');
  });

  it('src/main.ts не подхватывается сам, если рядом есть src/index.ts', async () => {
    const root = await copyProject('hello');
    await rename(
      path.join(root, 'src', 'index.ts'),
      path.join(root, 'src', 'main.ts'),
    );
    await writeFile(path.join(root, 'src', 'index.ts'), 'export {};\n');
    expect(await failure(root)).toContain("does not export 'host'");
  });
});

describe('импорт src/index.ts', () => {
  it('в обычном Node без DOM ничего не регистрирует и отдаёт описания', async () => {
    const root = await copyProject('surfaces');
    const script = `
      const module = await import(${JSON.stringify(pathToFileURL(path.join(root, 'src', 'index.ts')).href)});
      process.stdout.write(JSON.stringify({
        document: typeof document,
        customElements: typeof customElements,
        views: Object.keys(module.views),
        mounts: Object.values(module.views).map((view) => typeof view.mount),
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
      mounts: ['function', 'function', 'function'],
      panels: ['acme.surfaces.first', 'acme.surfaces.second'],
      host: 'function',
    });
  });
});
