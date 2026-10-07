# Recipe: a panel in React

A panel, an injection, an answer view or a markdown block can be drawn by
React instead of Vue: the extension turns its React component into a
`Mountable` with `reactComponent`, and the app gives it an element to draw
into. Several frameworks live in one window at once; an error in one
component replaces only that component with an error card. This recipe is the
`react-panel` template
(`npx @dolphy-app/create-extension <dir> --id acme.hello --template react-panel`).
The files below are exactly what the generator writes for the id `acme.hello`.
The commands and the panel are the ones of
[recipe-command-panel.md](recipe-command-panel.md); only the panel changes. For a
framework without a preset (Svelte, Lit, Solid) see
[recipe-mountable.md](recipe-mountable.md).

## The manifest and the build config

File `extension.json` (react-panel):

```json
{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "acme.hello",
  "version": "0.1.0",
  "apiVersion": 1,
  "name": "Hello React panel",
  "description": "Palette commands that greet the learner and open a panel drawn with React.",
  "author": "your-github-login",
  "tags": ["productivity"]
}
```

File `dolphy-ext.config.json` (react-panel):

```json
{
  "frameworks": ["react"]
}
```

`"frameworks"` lists the UI frameworks the client part is built for. The
default is `["vue"]`, which is always on; `"react"` adds the React build: `.tsx`
and `.jsx` files are compiled with the automatic JSX runtime (no `import React`),
and `react` and `react-dom` go into `client.mjs`. They are ordinary
dependencies of the project:

```sh
pnpm add -D react react-dom @types/react @types/react-dom
```

The TypeScript side needs the JSX mode in `tsconfig.json`:

<!-- fragment -->

```json
{
  "compilerOptions": {
    "jsx": "react-jsx"
  }
}
```

A `.tsx` file that has JSX but no `"react"` in `frameworks` fails the build
with a message that names the config.

## The server part

File `src/index.ts` (react-panel):

```ts
export { client } from './client.tsx';
export { server } from './server.ts';
```

File `src/server.ts` (react-panel):

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

The server part is the same as in the command and panel recipe: it has no UI
and never sees React.

## The client part

File `src/client.tsx` (react-panel):

```tsx
import { defineClient } from '@dolphy-app/extension-sdk';
import type { PanelHandle, PanelProps } from '@dolphy-app/extension-sdk';
import { reactComponent, usePanel } from '@dolphy-app/extension-sdk/react';
import { useEffect, useState } from 'react';

// `reactComponent` draws this component with React and gives it the props of
// the panel; `usePanel()` is the handle with `call` for the commands of the
// extension
const HelloPanel = ({ props }: PanelProps) => {
  const panel = usePanel();
  const [message, setMessage] = useState('');
  // the app opens the panel again with new properties: the component renders again
  const name =
    typeof props === 'object' && props !== null && 'name' in props
      ? String(props.name)
      : 'world';

  const load = async () => {
    const data = await panel.call('acme.hello.data');
    setMessage((data as { message: string }).message);
  };
  useEffect(() => {
    void load();
  }, []);

  return (
    <section>
      <h2>Hello, {name}!</h2>
      <p>{message}</p>
      <button type="button" onClick={() => void load()}>
        Reload
      </button>
    </section>
  );
};

// runs in the app window: the panel is a `Mountable` the app draws into its own element
export const client = defineClient((c) => {
  c.addPanel({
    id: 'acme.hello.view',
    title: { en: 'Hello', ru: 'Привет' },
    component: reactComponent<PanelProps, PanelHandle>(HelloPanel),
  });
});
```

- `reactComponent(Component)` from `@dolphy-app/extension-sdk/react` returns a
  `Mountable`. It draws `<Component {...props} />` with `createRoot` into the
  element the app gives it and draws again when the props, the theme or the
  language change. `reactComponent<PanelProps, PanelHandle>(Panel)` names the
  surface: the props type is `PanelProps` (`panelId`, `props`, `context`) in a
  panel, `InjectionProps` in an injection, `AnswerViewProps` in an answer view
  and `MarkdownBlockProps` in a markdown renderer. `{ strictMode: true }` as
  the second argument wraps the tree in `React.StrictMode`.
- The props of the component are `ctx.props`: here `props` is what the panel
  was opened with, and a repeated `openPanel` with new properties draws the
  component again.
- The hooks `useApp()`, `useEngine()`, `useRpc(contract)`, `usePanel()` and
  `useInjection()` are the ones of a Vue component, on React context.
  `useTheme()` and `useLocale()` return the theme and the language and render
  the component again when they change; `useMountContext()` is the whole
  `MountContext` (`emit`, `signal`, `reportError`, …). Outside a component that
  `reactComponent` draws they throw.
- An error of the render goes to `ctx.reportError` by itself, and the app shows
  the card "Extension <name>: <error>" with a "Retry" button in place of the
  panel; the rest of the window works. React does not catch the errors of an
  event handler or of async code: catch them there and call
  `useMountContext().reportError(error)`.

## The tests

File `test/index.test.ts` (react-panel):

```ts
// @vitest-environment happy-dom
import { isMountable } from '@dolphy-app/extension-sdk';
import type { PanelHandle, PanelProps } from '@dolphy-app/extension-sdk';
import {
  createTestClient,
  createTestServer,
  mountForTest,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { client, server } from '../src/index.ts';

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
    expect(isMountable(running.panels[0]?.component)).toBe(true);
  });
});

// draws the panel the way the app does: into an element, on a context the test controls
const mountPanel = async (
  props: PanelProps['props'],
  call: PanelHandle['call'],
) => {
  const running = await createTestClient(client, { extensionId: 'acme.hello' });
  disposables.push(running);
  const component = running.panels[0]?.component;
  if (!isMountable(component)) throw new Error('the panel is not a Mountable');
  const panelProps: PanelProps = {
    panelId: 'acme.hello.view',
    props,
    context: { courseId: null },
  };
  const mounted = await mountForTest(component, {
    props: panelProps,
    handle: { ...panelProps, call },
  });
  disposables.push({ dispose: () => mounted.unmount() });
  return { mounted, panelProps };
};

describe('acme.hello: panel', () => {
  it('shows the data command reply and follows new properties', async () => {
    const calls: string[] = [];
    const { mounted, panelProps } = await mountPanel(
      { name: 'Ada' },
      async (commandId) => {
        calls.push(commandId);
        return { message: 'Hello from the test' };
      },
    );
    expect(mounted.el.querySelector('h2')?.textContent).toBe('Hello, Ada!');
    await vi.waitFor(() =>
      expect(mounted.el.querySelector('p')?.textContent).toBe(
        'Hello from the test',
      ),
    );
    expect(calls).toEqual(['acme.hello.data']);

    mounted.setProps({ ...panelProps, props: { name: 'Grace' } });
    expect(mounted.el.querySelector('h2')?.textContent).toBe('Hello, Grace!');
  });

  it('greets the world when it is opened without properties', async () => {
    const { mounted } = await mountPanel(undefined, async () => ({
      message: 'x',
    }));
    expect(mounted.el.querySelector('h2')?.textContent).toBe('Hello, world!');
  });

  it('asks the data command again when the button is pressed', async () => {
    const calls: string[] = [];
    const { mounted } = await mountPanel(undefined, async (commandId) => {
      calls.push(commandId);
      return { message: 'x' };
    });
    mounted.el.querySelector('button')?.click();
    await vi.waitFor(() => expect(calls).toEqual(['acme.hello.data', 'acme.hello.data']));
  });
});
```

`mountForTest(mountable, { props, handle, … })` from
`@dolphy-app/extension-sdk/testing` mounts the `Mountable` into a new `<div>` on
a context the test controls, in `happy-dom`. It resolves to `{ el, ctx,
setProps, setTheme, setLocale, emitted, errors, unmount }`: `setProps` draws
the component with the next props, `emitted` and `errors` list the calls of
`ctx.emit` and `ctx.reportError`, `handle` is what `usePanel()` returns.
`createTestClient` records the `Mountable` as the `component` of the panel. The
component is drawn synchronously, but what it loads in an effect arrives
later, so the test waits for it with `vi.waitFor`.

## What to know

- No Vuetify components and no overlays of the app (`VDialog`, `VMenu`) in a
  React component: Vuetify is a Vue library. Draw the dialogs yourself. The
  theme reaches you through `useTheme()` (`{ id, dark }`) and through the
  CSS variables of the window, such as `rgb(var(--v-theme-primary))`.
- Every extension carries its own copy of React. A "hello, world" panel built
  the way the tool builds it, without minification, is about 565 KB in
  `client.mjs` and about 106 KB gzipped. There is no shared React between
  extensions.
- A plain `import './panel.css'` fails the build. Import the style sheet as
  text (`import css from './panel.css?inline'`) and render it in a `<style>`
  element of the component, or use the `style` attribute. The window document
  is shared, so give the class names a prefix that cannot clash with the app.
- Svelte, Solid and Lit have no preset; draw them from a `Mountable` (see
  [recipe-mountable.md](recipe-mountable.md)) if you bundle them yourself.

## Try and ship

Run `pnpm dev`, start the app with `DOLPHY_DEV_EXTENSIONS`, open the palette and
run "Open the hello panel".
