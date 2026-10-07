# Recipe: a command and a panel

A command appears in the command palette and runs your code; a panel is a
screen the command can open: a Vue single-file component the app draws inside
its own window. This recipe is the `command-panel` template
(`npx @dolphy-app/create-extension <dir> --id acme.hello --template command-panel`).
The files below are exactly what the generator writes for the id `acme.hello`.
See [quick-start.md](quick-start.md) for the commands.

## The manifest

File `extension.json` (command-panel):

```json
{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "acme.hello",
  "version": "0.1.0",
  "apiVersion": 1,
  "name": "Hello panel",
  "description": "Palette commands that greet the learner and open a small panel.",
  "author": "your-github-login",
  "tags": ["productivity"]
}
```

The commands and the panel are not in the manifest: the two parts register
them. `dolphy-ext build` writes `main` and `client` into the built manifest.

## The server part

File `src/index.ts` (command-panel):

```ts
export { client } from './client.ts';
export { server } from './server.ts';
```

File `src/server.ts` (command-panel):

```ts
import { defineServer, notify, openPanel } from '@dolphy-app/extension-sdk';

// runs in the extension host: every call registers a contribution
export const server = defineServer((s) => {
  // palette command: shows a notification
  s.registerCommand({
    id: 'acme.hello.hello',
    title: { en: 'Say hello', ru: 'Поздороваться' },
    category: 'Hello',
    run: (args) => {
      const name = typeof args === 'string' ? args : 'world';
      return notify(`Hello, ${name}!`);
    },
  });

  // palette command: opens the panel (registered by the client) with properties
  s.registerCommand({
    id: 'acme.hello.open',
    title: { en: 'Open the hello panel', ru: 'Открыть панель' },
    category: 'Hello',
    run: () => openPanel('acme.hello.view', { name: 'Dolphy' }),
  });

  // hidden from the palette (palette: false): the panel asks for data
  s.registerCommand({
    id: 'acme.hello.data',
    title: 'Hello panel data',
    palette: false,
    run: () => ({ message: 'Hello from acme.hello' }),
  });
});
```

- `server.registerCommand({ id, title, run })` adds a command. `title` and
  `category` are what the palette shows (`LocalizedText`: a string or
  `{ en, ru }`). A command with `palette: false` is hidden from the palette: it
  is a handler only your panel calls.
- `run(args)` returns what the app does next: `notify(text)` shows a
  notification, `openPanel(id, props)` opens a panel with properties, any JSON
  value is data for the caller, nothing is fine. `args` is whatever the caller
  passes, so check its type. A handler has 10 seconds.
- Optional fields of a command: `description`, `icon`, `keybindings` and `when`
  (see [visibility conditions](recipe-when-dependencies.md)).

## The client part

File `src/client.ts` (command-panel):

```ts
import { defineClient } from '@dolphy-app/extension-sdk';
import StatusPanel from './StatusPanel.vue';

// runs in the app window: the panel is a Vue component the app draws
export const client = defineClient((c) => {
  c.addPanel({
    id: 'acme.hello.view',
    title: { en: 'Hello', ru: 'Привет' },
    component: StatusPanel,
  });
});
```

File `src/StatusPanel.vue` (command-panel):

```vue
<script setup lang="ts">
import { usePanel } from '@dolphy-app/extension-sdk/client';
import { computed, ref } from 'vue';

// `usePanel()` gives the panel the properties it was opened with and `call`
// for the commands of the extension
const panel = usePanel();
const message = ref('');
// the app opens the panel again with new properties: `panel.props` is
// reactive, the title follows it
const name = computed(() => {
  const { props } = panel;
  return typeof props === 'object' && props !== null && 'name' in props
    ? String(props.name)
    : 'world';
});

const load = async () => {
  const data = await panel.call('acme.hello.data');
  message.value = (data as { message: string }).message;
};
void load();
</script>

<template>
  <section class="status-panel">
    <h2>Hello, {{ name }}!</h2>
    <p>{{ message }}</p>
    <v-btn color="primary" @click="load">Reload</v-btn>
  </section>
</template>

<style scoped>
.status-panel {
  padding: 16px;
}
</style>
```

- `client.addPanel({ id, title, component })` adds the screen and its entry in
  the sidebar menu. The component is a Vue component, here a single-file
  component (`.vue`), or a `Mountable` that draws with another framework (see
  [recipe-mountable.md](recipe-mountable.md) and [recipe-react.md](recipe-react.md)).
  `vue` is the app's own instance, so the panel shares its theme and language.
  `openPanel('<id>', props)` of a command opens it.
- A `.vue` file is built as it is: `<script setup lang="ts">`, `<template>`
  and `<style>`. Vuetify components are written as tags (`<v-btn>`,
  `<v-card>`) and Vuetify directives as `v-ripple`, with no import: the build
  turns the ones a template uses into imports from the app's own Vuetify, so
  the theme and the language of the app apply and the bundle does not carry
  Vuetify. A `.vue` file in the server part is a build error.
- A `<style>` block is not tied to the panel: when `client.mjs` loads, the
  styles of all its components go into one `<style data-dolphy-ext="<extension
  id>">` tag of the window document, so a plain `<style>` reaches the whole
  window. Write `<style scoped>`, as the template does. `<style module>` is
  not supported.
- `pnpm typecheck` runs `vue-tsc --noEmit`: it checks the `<script setup
  lang="ts">` and the `<template>` of a `.vue` file, which plain `tsc` does not
  look into, and knows `.vue` imports without a `declare module` shim.
- Inside the component `usePanel()` from `@dolphy-app/extension-sdk/client`
  returns the handle: `panelId`, the reactive `props` the panel was opened with
  (a repeated `openPanel` with new properties updates them in place, so a
  `computed` over `panel.props` follows), the reactive `context`
  (`{ courseId }`) and `call(commandId, args)`.
- The code of a panel runs in the app window, and `call` is how it reaches the
  commands of the server part, including those with `palette: false`. That is
  why the data command exists.
- `client.addCommand({ id, title, run })` adds a command whose handler runs in
  the window instead; `run` takes no arguments and returns nothing.
- The build writes `server` to `main.mjs` and `client` to `client.mjs`.

## The tests

File `vitest.config.ts` (command-panel):

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({ plugins: [vue()] });
```

File `test/index.test.ts` (command-panel):

```ts
// @vitest-environment happy-dom
import { PANEL_HANDLE_KEY } from '@dolphy-app/extension-sdk';
import type { JsonValue, PanelHandle } from '@dolphy-app/extension-sdk';
import {
  createTestClient,
  createTestServer,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, shallowReactive } from 'vue';
import { client, server } from '../src/index.ts';
import StatusPanel from '../src/StatusPanel.vue';

const disposables: { dispose(): unknown }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

const start = async () => {
  const running = await createTestServer(server, { extensionId: 'acme.hello' });
  disposables.push(running);
  return running;
};

describe('acme.hello: server', () => {
  it('hello greets the name from the arguments, "world" without them', async () => {
    const running = await start();
    expect(await running.commands.run('acme.hello.hello', 'Ada')).toEqual({
      kind: 'notify',
      text: 'Hello, Ada!',
    });
    expect(await running.commands.run('acme.hello.hello')).toEqual({
      kind: 'notify',
      text: 'Hello, world!',
    });
  });

  it('open asks the app to open the panel with properties', async () => {
    const running = await start();
    expect(await running.commands.run('acme.hello.open')).toEqual({
      kind: 'openPanel',
      panelId: 'acme.hello.view',
      props: { name: 'Dolphy' },
    });
  });

  it('data returns what the panel shows and stays out of the palette', async () => {
    const running = await start();
    expect(await running.commands.run('acme.hello.data')).toEqual({
      kind: 'data',
      value: { message: 'Hello from acme.hello' },
    });
    const hidden = running.registration.commands.find(
      (command) => command.id === 'acme.hello.data',
    );
    expect(hidden?.palette).toBe(false);
  });
});

describe('acme.hello: client', () => {
  it('adds the panel that the open command points to', async () => {
    const running = await createTestClient(client, { extensionId: 'acme.hello' });
    disposables.push(running);
    expect(running.panels.map((panel) => panel.id)).toEqual(['acme.hello.view']);
    expect(running.panels[0]?.component).toBe(StatusPanel);
  });
});

// the app draws `<v-btn>` with its Vuetify; the test gives the panel a plain button
const VBtn = defineComponent({
  setup: (_props, { slots }) => () => h('button', slots['default']?.()),
});

// draws the panel the way the app does: the handle is provided to the component
const mountPanel = async (
  props: JsonValue | undefined,
  call: PanelHandle['call'],
) => {
  const handle = shallowReactive({
    panelId: 'acme.hello.view',
    props,
    context: { courseId: null },
    call,
  });
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({ render: () => h(StatusPanel) });
  app.component('v-btn', VBtn);
  app.provide(PANEL_HANDLE_KEY, handle);
  app.mount(host);
  disposables.push({
    dispose: () => {
      app.unmount();
      host.remove();
    },
  });
  // the panel asks a command: wait for the reply, then for the redraw
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  };
  await settle();
  return {
    host,
    reopen: async (next: JsonValue) => {
      handle.props = next;
      await settle();
    },
  };
};

describe('acme.hello: panel', () => {
  it('shows the data command reply and follows new properties', async () => {
    const calls: string[] = [];
    const panel = await mountPanel({ name: 'Ada' }, async (commandId) => {
      calls.push(commandId);
      return { message: 'Hello from the test' };
    });
    expect(panel.host.querySelector('h2')?.textContent).toBe('Hello, Ada!');
    expect(panel.host.querySelector('p')?.textContent).toBe(
      'Hello from the test',
    );
    expect(calls).toEqual(['acme.hello.data']);

    await panel.reopen({ name: 'Grace' });
    expect(panel.host.querySelector('h2')?.textContent).toBe('Hello, Grace!');
  });

  it('asks the data command again when the button is pressed', async () => {
    const calls: string[] = [];
    const panel = await mountPanel(undefined, async (commandId) => {
      calls.push(commandId);
      return { message: 'x' };
    });
    panel.host.querySelector('button')?.click();
    await panel.reopen({});
    expect(calls).toEqual(['acme.hello.data', 'acme.hello.data']);
  });

  it('greets the world when it is opened without properties', async () => {
    const panel = await mountPanel(undefined, async () => ({ message: 'x' }));
    expect(panel.host.querySelector('h2')?.textContent).toBe('Hello, world!');
  });
});
```

`createTestServer(server, { extensionId })` runs commands as the host does,
with the same rules for results: `running.commands.run(id, args)` resolves to
`{ kind: 'notify' | 'openPanel' | 'data' | 'none', … }`. `running.registration`
lists what the server registered, which is how the test sees that `data` is
hidden from the palette. `createTestClient(client, { extensionId })` records the
panels, so the test checks that the id the `open` command points to exists.

A panel is tested like any Vue component: `createApp` mounts it in `happy-dom`,
and `app.provide(PANEL_HANDLE_KEY, handle)` gives it the handle the app would
provide. The `call` of the handle answers `panel.call`; here it is a stub, and
in the events recipe it is wired to the real handlers. `vitest.config.ts` adds
`@vitejs/plugin-vue` so that the test can import the `.vue` file. The app gives
`<v-btn>` its Vuetify; the test registers a plain button under that name
(`app.component('v-btn', …)`) and tests the panel, not Vuetify.

## Try and ship

Run `pnpm dev`, start the app with `DOLPHY_DEV_EXTENSIONS`, open the palette and
run "Open the hello panel".
