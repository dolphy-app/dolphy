# Recipe: a command and a panel

A command appears in the command palette and runs your code; a panel is a
screen the command can open: a Vue component the app draws inside its own
window. This recipe is the
`command-panel` template
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
  "tags": ["productivity"],
  "contributes": {
    "commands": [
      { "id": "acme.hello.hello", "title": "Say hello", "category": "Hello" },
      { "id": "acme.hello.open", "title": "Open the hello panel", "category": "Hello" },
      { "id": "acme.hello.data", "title": "Hello panel data", "palette": false }
    ],
    "panels": [{ "id": "acme.hello.view", "title": "Hello" }]
  }
}
```

- `commands[]`: `title` and `category` are what the palette shows. A command
  with `"palette": false` is hidden from the palette: it is a handler only your
  panel calls.
- `panels[]` declares the screen; its module defaults to `./panel.mjs`, which
  the build writes.

## The code

File `src/index.ts` (command-panel):

```ts
import {
  defineExtension,
  defineExtensionPanel,
  notify,
  openPanel,
} from '@dolphy-app/extension-sdk';
import type { ExtensionPanels } from '@dolphy-app/extension-sdk';
import { usePanel } from '@dolphy-app/extension-sdk/client';
import { computed, defineComponent, h, ref } from 'vue';

// extension code: `host` runs in the extension process of the app
// the ids come from extension.json: a misspelt id or a declared id without a
// handler fails `pnpm typecheck`
export const host = defineExtension({
  commands: {
    // palette command: shows a notification
    'acme.hello.hello': (args) => {
      const name = typeof args === 'string' ? args : 'world';
      return notify(`Hello, ${name}!`);
    },
    // palette command: opens the panel with properties
    'acme.hello.open': () => openPanel('acme.hello.view', { name: 'Dolphy' }),
    // hidden from the palette (palette: false): the panel asks for data
    'acme.hello.data': () => ({ message: 'Hello from acme.hello' }),
  },
});

// the panel is a Vue component the app draws in its own window; `usePanel()`
// gives it the properties it was opened with and `call` for the commands above
const HelloPanel = defineComponent({
  setup() {
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
    void panel.call('acme.hello.data').then((data) => {
      message.value = (data as { message: string }).message;
    });
    return () =>
      h('div', [h('h2', `Hello, ${name.value}!`), h('p', message.value)]);
  },
});

export const panels = {
  'acme.hello.view': defineExtensionPanel(HelloPanel),
} satisfies ExtensionPanels;
```

- `commands` maps every declared id to a handler. The result is what the app
  does next: `notify(text)` shows a notification, `openPanel(id, props)` opens a
  panel with properties, any JSON value is data for the caller, nothing is fine.
  `args` is whatever the caller passes, so check its type.
- A panel is `defineExtensionPanel(component)`: a Vue component. `vue` is the
  app's own instance, so the panel shares its theme and language. Inside the
  component `usePanel()` from `@dolphy-app/extension-sdk/client` returns the
  handle: `panelId`, the reactive `props` the panel was opened with (a repeated
  `openPanel` with new properties updates them in place, so a `computed` over
  `panel.props` follows), the reactive `context` and
  `call(commandId, args)`.
- The code of a panel runs in the app window, and `call` to a declared command
  is how it reaches the extension process (the handlers of `host`). That is why
  the data command exists.
- The build writes `host` to `main.mjs` and `panels` to `panel.mjs`.

## The tests

File `test/index.test.ts` (command-panel):

```ts
// @vitest-environment happy-dom
import { PANEL_HANDLE_KEY } from '@dolphy-app/extension-sdk';
import type { JsonValue, PanelHandle } from '@dolphy-app/extension-sdk';
import { loadCommands } from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, shallowReactive } from 'vue';
import { host, panels } from '../src/index.ts';

const disposables: { dispose(): unknown }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

const load = async () => {
  const commands = await loadCommands(host, {
    declaredCommands: ['acme.hello.hello', 'acme.hello.open', 'acme.hello.data'],
    declaredPanels: ['acme.hello.view'],
  });
  disposables.push(commands);
  return commands;
};

describe('acme.hello: commands', () => {
  it('hello greets the name from the arguments, "world" without them', async () => {
    const commands = await load();
    expect(await commands.run('acme.hello.hello', 'Ada')).toEqual({
      kind: 'notify',
      text: 'Hello, Ada!',
    });
    expect(await commands.run('acme.hello.hello')).toEqual({
      kind: 'notify',
      text: 'Hello, world!',
    });
  });

  it('open asks the app to open the panel with properties', async () => {
    const commands = await load();
    expect(await commands.run('acme.hello.open')).toEqual({
      kind: 'openPanel',
      panelId: 'acme.hello.view',
      props: { name: 'Dolphy' },
    });
  });

  it('data returns what the panel shows', async () => {
    const commands = await load();
    expect(await commands.run('acme.hello.data')).toEqual({
      kind: 'data',
      value: { message: 'Hello from acme.hello' },
    });
  });
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
  const app = createApp({ render: () => h(panels['acme.hello.view']) });
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

  it('greets the world when it is opened without properties', async () => {
    const panel = await mountPanel(undefined, async () => ({ message: 'x' }));
    expect(panel.host.querySelector('h2')?.textContent).toBe('Hello, world!');
  });
});
```

`loadCommands` runs commands as the host does, with the same rules for results.
A panel is tested like any Vue component: `createApp` mounts it in `happy-dom`,
and `app.provide(PANEL_HANDLE_KEY, handle)` gives it the handle the app would
provide. The `call` of the handle answers `panel.call`; here it is a stub, and
in the events recipe it is wired to the real handlers.

## Try and ship

Run `pnpm dev`, start the app with `DOLPHY_DEV_EXTENSIONS`, open the palette and
run "Open the hello panel".
