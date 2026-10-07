# Recipe: a component of any framework

The app draws a panel, an injection, an answer view or a markdown block with
Vue, or with a `Mountable`: an object with `mount(el, ctx)` that draws into the
element the app gives it and returns the cleanup. Nothing in a `Mountable`
depends on Vue, so it is the base for Svelte, Solid, Lit or plain DOM. This
recipe builds a panel on plain DOM, the smallest case, and tests it with
`mountForTest`. React has a preset built on the same contract:
[recipe-react.md](recipe-react.md). The command and panel basics are in
[recipe-command-panel.md](recipe-command-panel.md); the contracts use `zod`, so
the project lists `zod` in its `dependencies`.

## The manifest

File `extension.json` (mountable):

```json
{
  "id": "acme.counter",
  "version": "1.0.0",
  "apiVersion": 1
}
```

## The parts

File `src/index.ts` (mountable):

```ts
export { client } from './client.ts';
export { server } from './server.ts';
```

File `src/shared/rpc.ts` (mountable):

```ts
import { defineRpc } from '@dolphy-app/extension-sdk';
import { z } from 'zod';

export const sayHello = defineRpc({
  name: 'greeting.say-hello',
  input: z.object({ name: z.string() }),
  output: z.object({ text: z.string() }),
});
```

File `src/server.ts` (mountable):

```ts
import { defineServer } from '@dolphy-app/extension-sdk';
import { sayHello } from './shared/rpc.ts';

export const server = defineServer((s) => {
  s.handle(sayHello, async ({ name }) => ({ text: `Hello, ${name}!` }));
});
```

## The component

File `src/hello-panel.ts` (mountable):

```ts
import { defineMountable } from '@dolphy-app/extension-sdk';
import type { PanelHandle, PanelProps } from '@dolphy-app/extension-sdk';
import { sayHello } from './shared/rpc.ts';

// plain DOM: the element is yours, any framework mounts into it the same way
export const HelloPanel = defineMountable<PanelProps, PanelHandle>(
  (el, ctx) => {
    const title = document.createElement('h2');
    const text = document.createElement('p');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Ask the server';
    el.append(title, text, button);

    const nameOf = ({ props }: PanelProps) =>
      typeof props === 'string' ? props : 'world';
    const draw = (props: PanelProps) => {
      title.textContent = `Hello, ${nameOf(props)}!`;
    };
    draw(ctx.props);
    // the app opens the panel again with new properties
    const stopProps = ctx.onProps(draw);

    // the window is light or dark; the element is inside it
    const paint = ({ dark }: { dark: boolean }) => {
      el.dataset.dark = String(dark);
    };
    paint(ctx.theme);
    const stopTheme = ctx.onTheme(paint);

    // the server part answers a contract; an error is shown in place of the panel
    const ask = () => {
      ctx.callRpc(sayHello, { name: nameOf(ctx.props) }).then(
        (answer) => {
          if (!ctx.signal.aborted) text.textContent = answer.text;
        },
        (error: unknown) => ctx.reportError(error),
      );
    };
    button.addEventListener('click', ask);

    return () => {
      stopProps();
      stopTheme();
      button.removeEventListener('click', ask);
      el.replaceChildren();
    };
  },
);
```

File `src/client.ts` (mountable):

```ts
import { defineClient } from '@dolphy-app/extension-sdk';
import { HelloPanel } from './hello-panel.ts';

export const client = defineClient((c) => {
  c.addPanel({
    id: 'acme.counter.view',
    title: 'Hello',
    component: HelloPanel,
  });
});
```

- `defineMountable<Props, Handle>(mount)` builds the object and gives it the
  brand that `isMountable(value)` checks. `mount(el, ctx)` may return the
  cleanup or a promise of it. The app calls the cleanup when it removes the
  element: a route change, an extension turned off or removed, an injection
  whose target is gone.
- `Props` is the type of `ctx.props`: `PanelProps` (`panelId`, `props`,
  `context`) in a panel, `InjectionProps` (`target`, `position`) in an injection,
  `AnswerViewProps` in an answer view and `MarkdownBlockProps` (`source`,
  `language`) in a markdown renderer. `Handle` is the type of `ctx.handle`:
  `PanelHandle` in a panel, `InjectionHandle` in an injection and `undefined`
  elsewhere.
- The same component fits `client.addPanel`, `client.addInjection`,
  `client.addAnswerView` and `client.addMarkdownRenderer` as its `component`,
  where a Vue component fits.

## The context

`ctx` (`MountContext`) is everything a Vue component gets from `usePanel`,
`useApp`, `useEngine` and `useRpc`, without Vue:

| Field                   | What it is                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `props`, `onProps(fn)`  | The current props, a snapshot that is never changed in place, and a listener for the next one.          |
| `theme`, `onTheme(fn)`  | `{ id, dark }` of the window and a listener for a change.                                              |
| `locale`, `onLocale(fn)` | `'en'` or `'ru'` and a listener for a change.                                                        |
| `emit(event, payload?)` | Sends an event to the app. Only an answer view has events (see below); elsewhere it does nothing.       |
| `app`, `engine`         | The window API (`AppApi`) and the engine client, the same objects as `client.app` and `client.engine`. |
| `callRpc(contract, input)` | Calls the server part: validates the input and the answer with the contract; a failure rejects.      |
| `extensionId`           | The id of this extension.                                                                              |
| `signal`                | An `AbortSignal` aborted when the element is removed: pass it to `fetch`, check it after an `await`.  |
| `reportError(error)`    | Shows the card "Extension <name>: <error>" with a "Retry" button in place of the component.            |
| `handle`                | The panel handle (`panelId`, `props`, `context`, `call(commandId, args?)`) or the injection handle.    |

Every `on…` returns the function that stops listening; call it in the cleanup.
An exception that `mount` throws is reported the same way as `reportError`.

An answer view tells the app about the answer with `emit`:

<!-- fragment -->

```ts
import { defineMountable } from '@dolphy-app/extension-sdk';
import type { AnswerChange, AnswerViewProps } from '@dolphy-app/extension-api';

export const Choice = defineMountable<AnswerViewProps<string[], string>>(
  (el, ctx) => {
    const select = document.createElement('select');
    select.append(...ctx.props.view.map((option) => new Option(option)));
    select.disabled = ctx.props.disabled;
    select.addEventListener('change', () => {
      const change: AnswerChange<string> = {
        value: select.value,
        complete: true,
      };
      ctx.emit('change', change);
    });
    el.append(select);
    return () => el.replaceChildren();
  },
);
```

`emit('change', { value, complete })` reports the current answer and
`emit('submit')` asks the app to check it.

## The tests

File `test/index.test.ts` (mountable):

```ts
// @vitest-environment happy-dom
import { isMountable } from '@dolphy-app/extension-sdk';
import type { ExtensionEngine, PanelProps } from '@dolphy-app/extension-sdk';
import {
  createTestClient,
  createTestServer,
  mountForTest,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { client, server } from '../src/index.ts';
import { HelloPanel } from '../src/hello-panel.ts';
import { sayHello } from '../src/shared/rpc.ts';

const disposables: { dispose(): unknown }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

describe('acme.counter: server', () => {
  it('answers the contract', async () => {
    const running = await createTestServer(server, {
      extensionId: 'acme.counter',
    });
    disposables.push(running);
    expect(await running.rpc(sayHello, { name: 'Ada' })).toEqual({
      text: 'Hello, Ada!',
    });
  });
});

describe('acme.counter: client', () => {
  it('adds the panel as a mountable', async () => {
    const running = await createTestClient(client, {
      extensionId: 'acme.counter',
    });
    disposables.push(running);
    expect(running.panels.map((panel) => panel.id)).toEqual([
      'acme.counter.view',
    ]);
    expect(isMountable(running.panels[0]?.component)).toBe(true);
  });
});

const panelProps = (props: PanelProps['props']): PanelProps => ({
  panelId: 'acme.counter.view',
  props,
  context: { courseId: null },
});

// the engine of the window: `ctx.callRpc` goes through `extensions.invokeRpc`
const engineAnswering = (
  answer: (request: { name: string; input: unknown }) => Promise<unknown>,
) => ({ extensions: { invokeRpc: answer } }) as unknown as ExtensionEngine;

const mountPanel = async (
  props: PanelProps['props'],
  engine: ExtensionEngine,
) => {
  const mounted = await mountForTest(HelloPanel, {
    props: panelProps(props),
    handle: { ...panelProps(props), call: async () => undefined },
    engine,
    extensionId: 'acme.counter',
  });
  disposables.push({ dispose: () => mounted.unmount() });
  return mounted;
};

describe('acme.counter: panel', () => {
  it('greets, follows the props and the theme, asks the server', async () => {
    const asked: unknown[] = [];
    const mounted = await mountPanel(
      'Ada',
      engineAnswering(async (request) => {
        asked.push(request.input);
        return { text: 'Hello from the server' };
      }),
    );
    expect(mounted.el.querySelector('h2')?.textContent).toBe('Hello, Ada!');
    expect(mounted.el.dataset.dark).toBe('false');

    mounted.setProps(panelProps('Grace'));
    mounted.setTheme({ id: 'night', dark: true });
    expect(mounted.el.querySelector('h2')?.textContent).toBe('Hello, Grace!');
    expect(mounted.el.dataset.dark).toBe('true');

    mounted.el.querySelector('button')?.click();
    await vi.waitFor(() =>
      expect(mounted.el.querySelector('p')?.textContent).toBe(
        'Hello from the server',
      ),
    );
    expect(asked).toEqual([{ name: 'Grace' }]);
  });

  it('reports a failed call and cleans up on unmount', async () => {
    const mounted = await mountPanel(
      undefined,
      engineAnswering(async () => {
        throw new Error('server is down');
      }),
    );
    mounted.el.querySelector('button')?.click();
    await vi.waitFor(() => expect(mounted.errors).toHaveLength(1));

    await mounted.unmount();
    expect(mounted.ctx.signal.aborted).toBe(true);
    expect(mounted.el.childElementCount).toBe(0);
  });
});
```

`mountForTest(mountable, { props, handle, engine, … })` mounts the component
into a new `<div>` on a context the test controls. `setProps`, `setTheme` and
`setLocale` change the context and call the `on…` listeners; `emitted` lists
the `ctx.emit` calls as `[event, payload]`, `errors` the `ctx.reportError`
calls; `unmount()` aborts `ctx.signal` and runs the cleanup. Without `app` and
`engine` any use of them throws, so pass the ones the component touches. The
`engine` is also what `ctx.callRpc` talks to, as `useRpc` does in a window.

## Try and ship

Run `pnpm dev`, start the app with `DOLPHY_DEV_EXTENSIONS` and open the "Hello"
panel from the sidebar menu.
