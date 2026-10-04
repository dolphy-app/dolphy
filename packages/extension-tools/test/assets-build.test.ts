import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BuildError, buildExtension, validateExtension } from '../src/index.ts';
import { png } from '../../extension-catalog/test/samples.ts';
import { copyProject } from './helpers.ts';

const SMALL = png(64);
const BIG = png(128, 128, { padding: 9000 });

const indexSource = (body: string, imports = '') => `import {
  defineExtension,
  defineExtensionPanel,
} from '@dolphy-app/extension-sdk';
${imports}

export const host = defineExtension({});

export const panels = {
  'acme.commands-panel.main': defineExtensionPanel({
    mount(container) {
      ${body}
    },
  }),
};
`;

/** The panel fixture without commands (the host stays empty) and with the given sources. */
const project = async (
  files: Record<string, string | Uint8Array>,
  manifest: (value: Record<string, unknown>) => void = () => undefined,
): Promise<string> => {
  const root = await copyProject('commands-panel');
  const manifestFile = path.join(root, 'extension.json');
  const value = JSON.parse(await readFile(manifestFile, 'utf8')) as {
    contributes: Record<string, unknown>;
  };
  value.contributes.commands = [];
  manifest(value);
  await writeFile(manifestFile, JSON.stringify(value));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return root;
};

const build = (root: string) =>
  buildExtension({ root, outDir: path.join(root, 'out') });

const assetsOf = async (dir: string): Promise<string[]> =>
  (await readdir(path.join(dir, 'assets')).catch(() => [])).sort();

describe('dolphy-ext build: style sheets', () => {
  it('?inline gives a string and adds no file; url() inside it stays inline', async () => {
    const root = await project({
      'src/index.ts': indexSource(
        'container.textContent = css;',
        "import css from './panel.css?inline';",
      ),
      'src/panel.css': '.p{color:red;background:url(./big.png)}',
      'src/big.png': BIG,
    });
    const { dir, files } = await build(root);
    expect(files).toEqual(['extension.json', 'panel.mjs']);
    const panel = await readFile(path.join(dir, 'panel.mjs'), 'utf8');
    expect(panel).toContain(
      '.p{color:red;background:url(data:image/png;base64,',
    );
    expect(await validateExtension(dir)).toEqual({
      ok: true,
      problems: [],
      warnings: [],
    });
  });

  it('a plain import of a style sheet is an error that names the way out', async () => {
    const root = await project({
      'src/index.ts': indexSource(
        'container.textContent = "x";',
        "import './side.css';",
      ),
      'src/side.css': '.a{}',
    });
    const error = await build(root).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).message).toContain(
      "import css from './side.css?inline'",
    );
  });
});

describe('dolphy-ext build: images and fonts', () => {
  it('a small asset is inlined as a data URI, no file is written', async () => {
    const root = await project({
      'src/index.ts': indexSource(
        'container.textContent = small + new URL("./small.png", import.meta.url).href;',
        "import small from './small.png?url';",
      ),
      'src/small.png': SMALL,
    });
    const { dir, files } = await build(root);
    expect(files).toEqual(['extension.json', 'panel.mjs']);
    expect(await readFile(path.join(dir, 'panel.mjs'), 'utf8')).toContain(
      'data:image/png;base64,',
    );
  });

  it('a big asset becomes a file in assets/ named by its content and is addressed relative to the module', async () => {
    const root = await project({
      'src/index.ts': indexSource(
        'container.textContent = big + new URL("./big.png", import.meta.url).href;',
        "import big from './big.png?url';",
      ),
      'src/big.png': BIG,
    });
    const first = await build(root);
    const names = await assetsOf(first.dir);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^big-[\w-]+\.png$/);
    expect(first.files).toContain(`assets/${names[0]}`);
    const panel = await readFile(path.join(first.dir, 'panel.mjs'), 'utf8');
    expect(panel).toContain(`new URL("assets/${names[0]}", import.meta.url)`);
    expect(panel).not.toContain('data:image/png');
    expect(
      new Uint8Array(
        await readFile(path.join(first.dir, 'assets', names[0] ?? '')),
      ),
    ).toEqual(BIG);
    expect(await validateExtension(first.dir)).toEqual({
      ok: true,
      problems: [],
      warnings: [],
    });
    // the same sources, the same file
    const second = await build(root);
    expect(await assetsOf(second.dir)).toEqual(names);
  });

  it('a module in a subdirectory reaches assets/ with ../', async () => {
    const root = await project(
      {
        'src/index.ts': indexSource(
          'container.textContent = new URL("./big.png", import.meta.url).href;',
        ),
        'src/big.png': BIG,
      },
      (manifest) => {
        const contributes = manifest.contributes as {
          panels: { module?: string }[];
        };
        if (contributes.panels[0] !== undefined) {
          contributes.panels[0].module = './ui/screen.js';
        }
      },
    );
    const { dir, files } = await build(root);
    expect(files.some((file) => file.startsWith('assets/big-'))).toBe(true);
    expect(await readFile(path.join(dir, 'ui/screen.js'), 'utf8')).toContain(
      'new URL("../assets/big-',
    );
  });
});

describe('dolphy-ext build: the assets/ directory and the output check', () => {
  const sources = {
    'src/index.ts': indexSource('container.textContent = "x";'),
  };

  it('copies assets/ as is', async () => {
    const root = await project({
      ...sources,
      'assets/logo.png': SMALL,
      'assets/theme.css': '.a{background:url(logo.png)}',
    });
    const { files } = await build(root);
    expect(files).toEqual(
      expect.arrayContaining(['assets/logo.png', 'assets/theme.css']),
    );
  });

  it.each([
    [
      'an unsafe SVG',
      'assets/a.svg',
      '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
      /assets\/a\.svg: .*<script>/,
    ],
    [
      'a style sheet with @import',
      'assets/a.css',
      '@import "https://example.com/a.css";',
      /assets\/a\.css: @import/,
    ],
    [
      'a JPEG named .png',
      'assets/a.png',
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
      /assets\/a\.png: .*PNG/,
    ],
  ])(
    'refuses %s before anything is published',
    async (_name, file, content, pattern) => {
      const root = await project({ ...sources, [file]: content });
      const error = await build(root).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BuildError);
      expect((error as BuildError).message).toMatch(pattern);
    },
  );

  it('validate reports the same problems for a built directory', async () => {
    const root = await project({ ...sources, 'assets/a.png': SMALL });
    const { dir } = await build(root);
    await writeFile(path.join(dir, 'assets', 'a.png'), 'not a png');
    const result = await validateExtension(dir);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('assets/a.png');
  });

  it('copies the manifest icon and refuses a bad one', async () => {
    const good = await project(
      { ...sources, 'icon.png': SMALL },
      (manifest) => {
        manifest.icon = 'icon.png';
      },
    );
    const { files } = await build(good);
    expect(files).toContain('icon.png');
    const bad = await project(
      { ...sources, 'icon.png': png(32) },
      (manifest) => {
        manifest.icon = 'icon.png';
      },
    );
    expect(await build(bad).catch((e: unknown) => e)).toMatchObject({
      message: expect.stringContaining('64 to 512'),
    });
    const missing = await project(sources, (manifest) => {
      manifest.icon = 'assets/nope.png';
    });
    expect(await build(missing).catch((e: unknown) => e)).toMatchObject({
      message: expect.stringContaining('is not found'),
    });
  });
});
