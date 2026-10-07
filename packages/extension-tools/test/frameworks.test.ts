import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { png } from '../../extension-catalog/test/samples.ts';
import { BuildError, buildExtension } from '../src/index.ts';
import { CONFIG_FILE, loadProject } from '../src/project.ts';
import { copyProject, linkReact } from './helpers.ts';

const build = (root: string) =>
  buildExtension({ root, outDir: path.join(root, 'out') });

const write = async (
  root: string,
  files: Record<string, string | Uint8Array>,
) => {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
};

const withConfig = async (
  name: string,
  config: unknown,
  { isReactLinked = false }: { isReactLinked?: boolean } = {},
): Promise<string> => {
  const root = await copyProject(name);
  if (isReactLinked) await linkReact(root);
  await write(root, { [CONFIG_FILE]: JSON.stringify(config) });
  return root;
};

const read = (dir: string, file: string) =>
  readFile(path.join(dir, file), 'utf8');

const failure = async (root: string): Promise<string> => {
  const error = await build(root).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BuildError);
  return (error as BuildError).message;
};

describe('frameworks of dolphy-ext.config.json', () => {
  it('is vue without the file and without the field', async () => {
    expect((await loadProject(await copyProject('hello'))).frameworks).toEqual([
      'vue',
    ]);
    const root = await withConfig('hello', { external: [] });
    expect((await loadProject(root)).frameworks).toEqual(['vue']);
  });

  it('keeps vue first and adds react to it', async () => {
    for (const frameworks of [
      ['react'],
      ['react', 'vue'],
      ['react', 'react'],
    ]) {
      const root = await withConfig('hello', { frameworks });
      expect((await loadProject(root)).frameworks).toEqual(['vue', 'react']);
    }
  });

  it('an unknown framework is an error that lists the known ones', async () => {
    const root = await withConfig('hello', { frameworks: ['react', 'svelte'] });
    const message = await failure(root);
    expect(message).toContain(CONFIG_FILE);
    expect(message).toContain("unknown framework 'svelte'");
    expect(message).toContain('vue, react');
  });

  it('a value that is not a list of names is an error', async () => {
    for (const frameworks of ['react', [1], { react: true }]) {
      const root = await withConfig('hello', { frameworks });
      expect(await failure(root)).toContain("'frameworks' must be an array");
    }
  });
});

describe('framework react', () => {
  it('builds .tsx with the automatic JSX runtime and carries react in the bundle', async () => {
    const root = await withConfig(
      'react-panel',
      { frameworks: ['react'] },
      { isReactLinked: true },
    );
    const { dir, files } = await build(root);
    expect(files).toEqual(['client.mjs', 'extension.json', 'main.mjs']);
    const client = await read(dir, 'client.mjs');
    expect(client).toContain('react-jsx-runtime.production.js');
    expect(client).not.toContain('jsx-dev-runtime');
    expect(client).toContain('createRoot');
    expect(client).not.toMatch(/__dolphy\.require\("react/);
    expect(client).not.toContain('process.env.NODE_ENV');
    expect(client).not.toContain('react.development');
  });

  it('keeps react out of the server file', async () => {
    const root = await withConfig(
      'react-panel',
      { frameworks: ['react'] },
      { isReactLinked: true },
    );
    const { dir } = await build(root);
    const main = await read(dir, 'main.mjs');
    expect(main).toContain('acme.react-panel.ping');
    expect(main).not.toMatch(/createRoot|jsx|useState|flushSync/);
  });

  describe('server file and the React of the client part', () => {
    const REACT_RUNTIME = 'react.transitional.element';

    /** A package laid out like `@dolphy-app/extension-sdk` as published: `sideEffects: false`, the constructors in a chunk shared by the entries, the React adapter in its own entry. */
    const publishedSdk = (root: string) =>
      write(root, {
        'node_modules/@dolphy-app/extension-sdk/package.json': JSON.stringify({
          name: '@dolphy-app/extension-sdk',
          type: 'module',
          sideEffects: false,
          exports: { '.': './dist/index.js', './react': './dist/react.js' },
        }),
        'node_modules/@dolphy-app/extension-sdk/dist/define-entry.js': `const defineMountable = /* @__NO_SIDE_EFFECTS__ */ (mount) => ({ mount });
const defineServer = /* @__NO_SIDE_EFFECTS__ */ (entry) => entry;
const defineClient = /* @__NO_SIDE_EFFECTS__ */ (entry) => entry;
export { defineServer as i, defineMountable as r, defineClient as t };
`,
        'node_modules/@dolphy-app/extension-sdk/dist/index.js': `import { i as defineServer, t as defineClient } from './define-entry.js';
export { defineClient, defineServer };
`,
        'node_modules/@dolphy-app/extension-sdk/dist/react.js': `import { r as defineMountable } from './define-entry.js';
import { Component, createContext, createElement } from 'react';
import { createRoot } from 'react-dom/client';
const Context = createContext(null);
class Boundary extends Component {}
const reactComponent = /* @__NO_SIDE_EFFECTS__ */ (component) =>
  /* @__PURE__ */ defineMountable((el) => {
    createRoot(el).render(
      createElement(Context.Provider, { value: 1 }, createElement(Boundary, null, createElement(component))),
    );
  });
export { reactComponent };
`,
      });

    const SERVER_IMPORTS = `import { defineServer } from '@dolphy-app/extension-sdk';\n`;
    const SERVER = `export const server = defineServer((s) => {
  s.registerCommand({ id: 'acme.react-panel.ping', title: 'Ping', run: () => 1 });
});
`;
    const PANEL_IMPORTS = `import { defineClient } from '@dolphy-app/extension-sdk';
import { reactComponent } from '@dolphy-app/extension-sdk/react';
import { createElement, useState } from 'react';
`;
    const PANEL = `const Panel = () => createElement('p', null, useState(0)[0]);
const panel = reactComponent(Panel);
export const client = defineClient((c) => {
  c.addPanel({ id: 'acme.react-panel.main', title: 'Panel', component: panel });
});
`;

    const layouts: Record<string, Record<string, string>> = {
      'reexports of the files of the parts': {
        'src/index.ts': `export { client } from './client.ts';\nexport { server } from './server.ts';\n`,
        'src/client.ts': `${PANEL_IMPORTS}${PANEL}`,
        'src/server.ts': `${SERVER_IMPORTS}${SERVER}`,
      },
      'both parts in src/index.ts': {
        'src/index.ts': `import { defineClient, defineServer } from '@dolphy-app/extension-sdk';
import { reactComponent } from '@dolphy-app/extension-sdk/react';
import { createElement, useState } from 'react';
${PANEL}${SERVER}`,
      },
    };

    it.each(Object.keys(layouts))(
      'keeps the library of a component the server does not use out: %s',
      async (layout) => {
        const root = await withConfig(
          'react-panel',
          { frameworks: ['react'] },
          { isReactLinked: true },
        );
        await publishedSdk(root);
        await write(root, layouts[layout] ?? {});
        const { dir } = await build(root);
        const main = await read(dir, 'main.mjs');
        expect(main).toContain('acme.react-panel.ping');
        expect(main).not.toContain(REACT_RUNTIME);
        expect(main.length).toBeLessThan(5000);
        expect(await read(dir, 'client.mjs')).toContain(REACT_RUNTIME);
      },
    );

    it('keeps react in the server file that calls it', async () => {
      const root = await withConfig(
        'react-panel',
        { frameworks: ['react'] },
        { isReactLinked: true },
      );
      await write(root, {
        'src/index.ts': `import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { client } from './client.ts';
export { client };
export const server = (s) => {
  s.registerCommand({
    id: 'acme.react-panel.ping',
    title: 'Ping',
    run: () => renderToStaticMarkup(createElement('b', null, 'rendered')),
  });
};
`,
        'src/client.ts': `export const client = (c) => {
  c.addPanel({ id: 'acme.react-panel.main', title: 'Panel', component: { mount: () => () => undefined } });
};
`,
      });
      const { dir } = await build(root);
      const main = await read(dir, 'main.mjs');
      expect(main).toContain(REACT_RUNTIME);
      expect(main).toContain('renderToStaticMarkup');
    });
  });

  it('JSX without the framework in the config is an error that names the file and the fix', async () => {
    const root = await copyProject('react-panel');
    await linkReact(root);
    const message = await failure(root);
    expect(message).toContain('mount.tsx');
    expect(message).toContain('contains JSX');
    expect(message).toContain('"frameworks": ["react"]');
  });

  it('a .tsx file without JSX builds without the framework', async () => {
    const root = await copyProject('react-panel');
    await write(root, {
      'src/mount.tsx':
        'export const mount = (el: HTMLElement): (() => void) => { el.textContent = "plain"; return () => undefined; };\n',
    });
    const { dir } = await build(root);
    expect(await read(dir, 'client.mjs')).toContain('plain');
  });
});

describe('framework vue: single-file components', () => {
  it('imports Vue, Vuetify components and directives from the host and carries none of them', async () => {
    const { dir } = await build(await copyProject('sfc-panel'));
    const client = await read(dir, 'client.mjs');
    expect(client).toMatch(
      /__dolphy\.require\("vuetify\/components"\);\s*const \{ VAlert, VBtn, VCard \} =/,
    );
    expect(client).toMatch(
      /__dolphy\.require\("vuetify\/directives"\);\s*const \{ Ripple \} =/,
    );
    expect(client).toMatch(/__dolphy\.require\("vue"\)/);
    expect(client).not.toMatch(/\bimport\b[^\n]*from/);
    // bodies of the libraries are not there: the whole bundle is the two components
    expect(client).not.toContain('createApp');
    expect(client).not.toContain('VueElement');
    expect(client.length).toBeLessThan(6000);
  });

  it('compiles <script setup lang="ts"> and the template', async () => {
    const { dir } = await build(await copyProject('sfc-panel'));
    const client = await read(dir, 'client.mjs');
    expect(client).toContain('defineComponent');
    expect(client).toContain('createBlock(_component_v_card');
    expect(client).toContain('Clicked');
    // TypeScript is gone
    expect(client).not.toContain('ref<number>');
    expect(client).not.toContain('defineProps<');
  });

  it('resolves <VChip> as well and leaves a tag that is not Vuetify’s to Vue', async () => {
    const root = await copyProject('sfc-panel');
    await write(root, {
      'src/Panel.vue': '<template><div><VChip /><my-card /></div></template>\n',
    });
    const client = await read((await build(root)).dir, 'client.mjs');
    expect(client).toContain('VChip ?? resolveComponent("VChip")');
    expect(client).toContain('resolveComponent("my-card")');
    expect(client).not.toContain('?? resolveComponent("my-card")');
  });

  it('puts the styles into one <style data-dolphy-ext> of the module, scoped ones with their attribute', async () => {
    const { dir } = await build(await copyProject('sfc-panel'));
    const client = await read(dir, 'client.mjs');
    expect(client).toContain('data-dolphy-ext');
    expect(client).toContain('acme.sfc-panel');
    expect(client).toContain('.panel{padding:8px}');
    expect(client).toMatch(/\.note\[data-v-[0-9a-f]+\]\{font-weight:700\}/);
    expect(client).toMatch(/\.panel \.note\[data-v-[0-9a-f]+\]\{color:red\}/);
  });

  it('keeps the server file free of the component and of Vue', async () => {
    const { dir, files } = await build(await copyProject('sfc-panel'));
    expect(files).toEqual(['client.mjs', 'extension.json', 'main.mjs']);
    const main = await read(dir, 'main.mjs');
    expect(main).toContain('acme.sfc-panel.ping');
    expect(main).not.toMatch(/vue|Panel|Badge|server-vue/);
  });

  it('a style sheet of the author is still an error and ?inline still works next to components', async () => {
    const root = await copyProject('sfc-panel');
    await write(root, {
      'src/extra.css': '.extra{color:blue}',
      'src/index.ts': [
        "import Panel from './Panel.vue';",
        "import './extra.css';",
        'export const client = (c) => {',
        "  c.addPanel({ id: 'a.b', title: 'T', component: Panel });",
        '};',
      ].join('\n'),
    });
    const message = await failure(root);
    expect(message).toContain('side-effect style sheet');
    expect(message).toContain('extra.css');
    await write(root, {
      'src/index.ts': [
        "import Panel from './Panel.vue';",
        "import css from './extra.css?inline';",
        'export const client = (c) => {',
        "  c.addPanel({ id: 'a.b', title: css, component: Panel });",
        '};',
      ].join('\n'),
    });
    expect(await read((await build(root)).dir, 'client.mjs')).toContain(
      '.extra{color:#00f}',
    );
  });

  it('<style src> of a component is carried like a style block', async () => {
    const root = await copyProject('sfc-panel');
    await write(root, {
      'src/ext.css': '.ext{color:purple}',
      'src/Badge.vue':
        '<template><i class="ext">x</i></template>\n<style src="./ext.css"></style>\n',
    });
    const client = await read((await build(root)).dir, 'client.mjs');
    expect(client).toContain('.ext{color:purple}');
    // one call for each of the three style blocks of the project
    expect(client.match(/addStyle\(/g)).toHaveLength(3);
  });

  it('an image in a style block stays inline instead of becoming a file with an address that means nothing in a string', async () => {
    const root = await copyProject('sfc-panel');
    await write(root, {
      'src/big.png': png(128, 128, { padding: 9000 }),
      'src/Badge.vue':
        '<template><i class="pic">x</i></template>\n<style>.pic{background:url(./big.png)}</style>\n',
    });
    const { dir, files } = await build(root);
    expect(await read(dir, 'client.mjs')).toContain('data:image/png;base64,');
    expect(files.filter((file) => file.startsWith('assets/'))).toEqual([]);
  });

  it('a style sheet imported by the script of a component is still an error', async () => {
    const root = await copyProject('sfc-panel');
    await write(root, {
      'src/plain.css': '.plain{color:red}',
      'src/Badge.vue':
        "<script>\nimport './plain.css';\nexport default {};\n</script>\n<template><i>x</i></template>\n",
    });
    const message = await failure(root);
    expect(message).toContain('side-effect style sheet');
    expect(message).toContain('plain.css');
  });

  it('a .vue file that the server code uses is an error that names the file', async () => {
    const message = await failure(await copyProject('sfc-in-server'));
    expect(message).toContain('main.mjs');
    expect(message).toContain(path.join('src', 'Panel.vue'));
    expect(message).toContain('client part');
  });

  it('a .vue file that a worker imports is an error that names the file', async () => {
    const root = await copyProject('with-worker');
    await write(root, {
      'src/Panel.vue': '<template><p>x</p></template>\n',
      'src/worker.ts':
        "import Panel from './Panel.vue';\nconsole.log(Panel);\n",
    });
    const message = await failure(root);
    expect(message).toContain('worker.mjs');
    expect(message).toContain(path.join('src', 'Panel.vue'));
  });
});
