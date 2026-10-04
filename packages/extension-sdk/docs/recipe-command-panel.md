# Recipe: a command and a panel

A command appears in the command palette and runs your code; a panel is a
screen in an isolated frame that the command can open. This recipe is the
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
      {
        "id": "acme.hello.open",
        "title": "Open the hello panel",
        "category": "Hello"
      },
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
- No permissions: commands, panels and `notify` need none.

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

// the panel runs in an isolated frame of the app window: no network, no
// window.dolphy; the only way out is `ctx.call` to the commands above
export const panels = {
  'acme.hello.view': defineExtensionPanel({
    async mount(container, ctx) {
      const doc = container.ownerDocument;
      const title = doc.createElement('h2');
      const line = doc.createElement('p');
      container.append(title, line);
      const name = (props: unknown): string =>
        typeof props === 'object' && props !== null && 'name' in props
          ? String(props.name)
          : 'world';
      title.textContent = `Hello, ${name(ctx.props)}!`;
      // the app opens the panel again with new properties: redraw the title
      ctx.signal.addEventListener(
        'abort',
        ctx.onProps((props) => {
          title.textContent = `Hello, ${name(props)}!`;
        }),
      );
      const data = (await ctx.call('acme.hello.data')) as { message: string };
      line.textContent = data.message;
    },
  }),
} satisfies ExtensionPanels;
```

- `commands` maps every declared id to a handler. The result is what the app
  does next: `notify(text)` shows a notification, `openPanel(id, props)` opens a
  panel with properties, any JSON value is data for the caller, nothing is fine.
  `args` is whatever the caller passes, so check its type.
- A panel is `defineExtensionPanel({ mount(container, ctx) })`. `ctx` has
  `panelId`, `props`, `signal` (aborted when the panel closes), `onProps(listener)`
  for new properties when the command opens the panel again, and
  `ctx.call(commandId, args)`.
- A panel runs in an isolated frame with no network and no access to the app;
  `ctx.call` to a declared command is the only way out. That is why the data
  command exists.
- The build writes `host` to `main.mjs` and `panels` to `panel.mjs`.

## The tests

File `test/index.test.ts` (command-panel):

```ts
// @vitest-environment happy-dom
import { loadCommands, loadPanel } from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { host, panels } from '../src/index.ts';

const disposables: { dispose(): unknown }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

const load = async () => {
  const commands = await loadCommands(host, {
    declaredCommands: [
      'acme.hello.hello',
      'acme.hello.open',
      'acme.hello.data',
    ],
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

describe('acme.hello: panel', () => {
  it('shows the data command reply and follows new properties', async () => {
    const panel = await loadPanel(panels, 'acme.hello.view', {
      props: { name: 'Ada' },
      call: () => ({ message: 'Hello from the test' }),
    });
    disposables.push(panel);
    expect(panel.container.querySelector('h2')?.textContent).toBe(
      'Hello, Ada!',
    );
    expect(panel.container.querySelector('p')?.textContent).toBe(
      'Hello from the test',
    );
    expect(panel.calls).toEqual([
      { commandId: 'acme.hello.data', args: undefined },
    ]);

    panel.setProps({ name: 'Grace' });
    expect(panel.container.querySelector('h2')?.textContent).toBe(
      'Hello, Grace!',
    );
  });

  it('stops listening for properties when the panel closes', async () => {
    const panel = await loadPanel(panels, 'acme.hello.view', {
      call: () => ({ message: 'x' }),
    });
    const heading = panel.container.querySelector('h2');
    panel.dispose();
    expect(panel.aborted).toBe(true);
    panel.setProps({ name: 'Late' });
    expect(heading?.textContent).toBe('Hello, world!');
  });
});
```

`loadCommands` runs commands as the host does, with the same rules for results.
`loadPanel` mounts a panel with a context like the frame's; its `call` option
answers `ctx.call`, and here it is wired to the real handlers so the panel is
tested against the command it depends on.

## Try and ship

Run `pnpm dev`, start the app with `DOLPHY_DEV_EXTENSIONS`, open the palette and
run "Open the hello panel".
