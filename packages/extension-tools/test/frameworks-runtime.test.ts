import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import type { HTMLElement as HappyElement } from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { populateGlobal } from 'vitest/runtime';
import * as vue from 'vue';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { Component } from 'vue';
import { buildExtension } from '../src/index.ts';
import { CONFIG_FILE } from '../src/project.ts';
import { copyProject, linkReact } from './helpers.ts';

interface Mountable {
  mount(el: HappyElement): () => void;
}

interface Panel {
  id: string;
  component: Component | Mountable;
}

const build = async (name: string, config?: unknown): Promise<string> => {
  const root = await copyProject(name);
  await linkReact(root);
  if (config !== undefined) {
    await writeFile(path.join(root, CONFIG_FILE), JSON.stringify(config));
  }
  return (await buildExtension({ root, outDir: path.join(root, 'out') })).dir;
};

/** Loads a built `client.mjs` and returns the panels it registers (`instance` makes a new module of the same file). */
const loadPanels = async (dir: string, instance = 1): Promise<Panel[]> => {
  const url = pathToFileURL(path.join(dir, 'client.mjs'));
  url.searchParams.set('instance', String(instance));
  const module = (await import(url.href)) as {
    client: (context: { addPanel(panel: Panel): void }) => void;
  };
  const panels: Panel[] = [];
  module.client({ addPanel: (panel) => panels.push(panel) });
  return panels;
};

const box = (name: string, tag: string) =>
  defineComponent({
    name,
    setup:
      (_props, { slots }) =>
      () =>
        h(tag, { class: name }, slots['default']?.()),
  });

/** What the window gives to client code: Vue itself and Vuetify components as plain elements. */
const installHost = (): void => {
  const modules: Record<string, unknown> = {
    vue,
    'vuetify/components': {
      VCard: box('v-card', 'section'),
      VAlert: box('v-alert', 'aside'),
      VBtn: box('v-btn', 'button'),
    },
    'vuetify/directives': { Ripple: {} },
  };
  Reflect.set(globalThis, '__dolphy', {
    require: (name: string) =>
      Object.hasOwn(modules, name)
        ? Promise.resolve(modules[name])
        : Promise.reject(new Error(`unknown host module: ${name}`)),
  });
};

let leaveDom: (() => void) | null = null;

/** Page globals (`document`, `window`…) for the rest of the test: a build is Node code and runs before this. */
const enterDom = (): Window => {
  const page = new Window({ url: 'http://localhost/' });
  const { keys, originals } = populateGlobal(globalThis, page, {
    bindFunctions: true,
  });
  leaveDom = () => {
    for (const key of keys) {
      const original = originals.get(key);
      if (original === undefined) Reflect.deleteProperty(globalThis, key);
      else Object.defineProperty(globalThis, key, original);
    }
  };
  return page;
};

afterEach(() => {
  leaveDom?.();
  leaveDom = null;
  Reflect.deleteProperty(globalThis, '__dolphy');
});

describe('built React panel', () => {
  it('mounts into an element, reacts to a click and unmounts', async () => {
    const dir = await build('react-panel', { frameworks: ['react'] });
    const page = enterDom();
    const [panel] = await loadPanels(dir);
    const { mount } = panel?.component as Mountable;
    const el = page.document.createElement('div');
    const unmount = mount(el);
    expect(el.textContent).toBe('Hello, world: 0');
    el.querySelector('button')?.click();
    expect(el.textContent).toBe('Hello, world: 1');
    unmount();
    expect(el.textContent).toBe('');
  });
});

describe('built single-file component', () => {
  const styleTags = (page: Window) =>
    [
      ...page.document.head.querySelectorAll(
        'style[data-dolphy-ext="acme.sfc-panel"]',
      ),
    ].map((tag) => tag.textContent);

  it('renders with the Vuetify components of the host and puts its styles into one tag', async () => {
    const dir = await build('sfc-panel');
    const page = enterDom();
    installHost();
    const [panel] = await loadPanels(dir);
    const html = await renderToString(
      createSSRApp(panel?.component as Component),
    );
    expect(html).toMatch(/<section class="v-card panel" data-v-[0-9a-f]+/);
    expect(html).toMatch(/<aside class="v-alert"[^>]*>Hello from a component/);
    expect(html).toMatch(/<button class="v-btn"[^>]*> Clicked 0<\/button>/);
    expect(html).toMatch(/<span class="note" data-v-[0-9a-f]+[^>]*>0<\/span>/);
    const tags = styleTags(page);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('.panel{padding:8px}');
    expect(tags[0]).toMatch(/\.note\[data-v-[0-9a-f]+\]\{font-weight:700\}/);
  });

  it('a second import of the module replaces the tag of the first', async () => {
    const dir = await build('sfc-panel');
    const page = enterDom();
    installHost();
    await loadPanels(dir, 1);
    expect(styleTags(page)).toHaveLength(1);
    await loadPanels(dir, 2);
    const tags = styleTags(page);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.match(/\.panel\{padding:8px\}/g)).toHaveLength(1);
  });
});
