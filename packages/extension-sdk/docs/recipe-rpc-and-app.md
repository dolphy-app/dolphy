# Recipe: calls between the parts, the engine and the window

A component of the client part can ask the server part for something, call the
engine itself and drive the window: open a course, show a toast, mount a
component into an element. This recipe builds a panel that lists the courses
and records an attempt, with `defineRpc`, `useRpc`, `useEngine`, `useApp` and
`server.engine`. There is no template for it; add the pieces to any project
(see [quick-start.md](quick-start.md)). The contracts use `zod`, so the project
lists `zod` in its `dependencies`; the build puts it into the bundles. The
command and panel basics are in [recipe-command-panel.md](recipe-command-panel.md).

## The manifest

File `extension.json` (rpc-and-app):

```json
{
  "id": "acme.direct",
  "version": "1.0.0",
  "apiVersion": 1
}
```

## The contracts

File `src/index.ts` (rpc-and-app):

```ts
export { client } from './client.ts';
export { server } from './server.ts';
```

File `src/shared/rpc.ts` (rpc-and-app):

```ts
import { defineRpc } from '@dolphy-app/extension-sdk';
import { z } from 'zod';

// imported by both parts: the name and the schemas of a call
export const courseNames = defineRpc({
  name: 'courses.names',
  input: z.object({}),
  output: z.object({ names: z.array(z.string()) }),
});

export const markKnown = defineRpc({
  name: 'attempts.mark-known',
  input: z.object({ exerciseId: z.string().min(1) }),
  output: z.object({ eventId: z.string() }),
});
```

- `defineRpc({ name, input, output })` returns the contract as is. `name` is
  lower-case segments separated by dots, at least two, up to 120 characters
  (`greeting.say-hello`); a malformed name throws. `input` and `output` are
  `zod` schemas. `defineRpc` does not import `vue`, so server code imports it
  too (it is also exported from `@dolphy-app/extension-sdk/rpc`).
- Both sides validate: `useRpc` checks the input before the call and the
  answer after it, the server checks the input before the handler and the
  result after it. The data crosses the process boundary as JSON, so keep it
  plain values (at most 200 000 characters of input).

## The server part

File `src/server.ts` (rpc-and-app):

```ts
import { defineServer } from '@dolphy-app/extension-sdk';
import { courseNames, markKnown } from './shared/rpc.ts';

export const server = defineServer((s) => {
  s.handle(courseNames, async () => {
    const page = await s.engine.library.listCourses();
    return { names: page.items.map((course) => course.name) };
  });

  s.handle(markKnown, async ({ exerciseId }) => {
    const result = await s.engine.practice.recordAttempt({
      requestId: crypto.randomUUID(),
      exerciseId,
      grade: 5,
    });
    return { eventId: result.eventId };
  });
});
```

- `server.handle(contract, handler)` answers a contract: one handler per name,
  at most 64 per extension. The handler has 10 seconds. An error it throws
  reaches the component with its message.
- `server.engine` is the engine client (`ExtensionEngine`): every method of the
  engine contract, writing ones included, and `subscribe` for the engine
  events, but not `close`. A write goes into the same log as the window's own
  writes, so record only what the learner really did.

## The client part

File `src/client.ts` (rpc-and-app):

```ts
import { defineClient } from '@dolphy-app/extension-sdk';
import { Panel } from './panel.ts';

export const client = defineClient((c) => {
  c.addPanel({
    id: 'acme.direct.view',
    title: { en: 'Direct', ru: 'Прямой доступ' },
    component: Panel,
  });
});
```

File `src/panel.ts` (rpc-and-app):

```ts
import { useApp, useEngine, useRpc } from '@dolphy-app/extension-sdk/client';
import { defineComponent, h, ref } from 'vue';
import { courseNames, markKnown } from './shared/rpc.ts';

export const Panel = defineComponent({
  setup() {
    const app = useApp();
    const engine = useEngine();
    const loadNames = useRpc(courseNames);
    const mark = useRpc(markKnown);
    const names = ref<string[]>([]);

    const report = (error: unknown) =>
      app.notify(
        error instanceof Error ? error.message : String(error),
        'error',
      );

    // through the server part: `courses.names`
    const loadFromServer = async () => {
      try {
        names.value = (await loadNames({})).names;
      } catch (error) {
        report(error);
      }
    };

    // straight from the component: the same engine client
    const loadHere = async () => {
      try {
        const page = await engine.library.listCourses();
        names.value = page.items.map((course) => course.name);
      } catch (error) {
        report(error);
      }
    };

    const markExercise = async (exerciseId: string) => {
      try {
        await mark({ exerciseId });
        app.notify('Recorded');
      } catch (error) {
        report(error);
      }
    };

    return () =>
      h('div', [
        h(
          'button',
          { 'data-role': 'server', onClick: loadFromServer },
          'Server',
        ),
        h('button', { 'data-role': 'here', onClick: loadHere }, 'Here'),
        h(
          'button',
          { 'data-role': 'mark', onClick: () => markExercise('') },
          'Mark with an empty id',
        ),
        h(
          'ul',
          names.value.map((name) => h('li', name)),
        ),
      ]);
  },
});
```

- `useRpc(contract)` is called in `setup` and returns `(input) => Promise<output>`.
  A schema violation, an error of the handler and an unavailable server reject
  the promise with an `Error` that carries the message.
- `useEngine()` is the client of the window itself: `engine.library`,
  `engine.practice`, `engine.settings`, … and `engine.subscribe`.
- `useApp()` is a fixed list of window capabilities: `openCourse(courseId)`,
  `openLesson(courseId, lessonId)`, `openExercise(courseId, lessonId, exerciseId)`,
  `openPanel(extensionId, panelId, props?)`, `openSettings(extensionId?)`,
  `notify(message, kind?)`, the reactive `theme` (`{ id, dark }`) and `locale`
  (`'en' | 'ru'`), `runCommand(commandKey)` for a palette command
  (`extension:<extension id>:<command id>`) and `mountAt(target, component,
props?)`. The window's stores and router are not reachable.
- `app.mountAt('#some-element', Component, props)` mounts a component into an
  element of the window (a CSS selector is resolved once, at the call; a
  missing element throws) and returns a `Disposable`. The component gets
  Vuetify, the theme, `useApp()`, `useEngine()` and `useRpc()` like a panel.
  For a component that follows the DOM, use `client.addInjection`.
- All three work only in a component the app draws; elsewhere they throw.

## The tests

File `test/index.test.ts` (rpc-and-app):

```ts
// @vitest-environment happy-dom
import {
  APP_KEY,
  ENGINE_KEY,
  EXTENSION_ID_KEY,
} from '@dolphy-app/extension-sdk';
import type { AppApi, ExtensionEngine } from '@dolphy-app/extension-sdk';
import {
  createTestClient,
  createTestServer,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { client, server } from '../src/index.ts';
import { Panel } from '../src/panel.ts';
import { courseNames, markKnown } from '../src/shared/rpc.ts';

const disposables: { dispose(): unknown }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

// only the methods the code under test calls
const recorded: unknown[] = [];
const engine = {
  library: {
    listCourses: async () => ({ items: [{ name: 'Git' }, { name: 'SQL' }] }),
  },
  practice: {
    recordAttempt: async (request: unknown) => {
      recorded.push(request);
      return { eventId: 'event-1' };
    },
  },
} as unknown as ExtensionEngine;

describe('acme.direct: server', () => {
  it('answers the contracts through the engine', async () => {
    const running = await createTestServer(server, {
      extensionId: 'acme.direct',
      engine,
    });
    disposables.push(running);
    expect(running.registration.rpcs).toEqual([
      'courses.names',
      'attempts.mark-known',
    ]);
    expect(await running.rpc(courseNames, {})).toEqual({
      names: ['Git', 'SQL'],
    });
    expect(await running.rpc(markKnown, { exerciseId: 'git::a::q1' })).toEqual({
      eventId: 'event-1',
    });
    expect(recorded).toMatchObject([{ exerciseId: 'git::a::q1', grade: 5 }]);
  });

  it('rejects an input that breaks the contract before the handler runs', async () => {
    const running = await createTestServer(server, {
      extensionId: 'acme.direct',
      engine,
    });
    disposables.push(running);
    const before = recorded.length;
    await expect(running.rpc(markKnown, { exerciseId: '' })).rejects.toThrow();
    expect(recorded).toHaveLength(before);
  });
});

describe('acme.direct: client', () => {
  it('adds the panel', async () => {
    const running = await createTestClient(client, {
      extensionId: 'acme.direct',
    });
    disposables.push(running);
    expect(running.panels.map((panel) => panel.id)).toEqual([
      'acme.direct.view',
    ]);
  });
});

// draws the panel the way the app does: the keys are provided to the component
const mountPanel = (invoked: string[], toasts: string[]) => {
  const app = {
    notify: (message: string, kind?: string) =>
      toasts.push(`${kind ?? 'info'}: ${message}`),
  } as unknown as AppApi;
  const windowEngine = {
    ...engine,
    extensions: {
      invokeRpc: async (request: { name: string }) => {
        invoked.push(request.name);
        return { names: ['From the server'] };
      },
    },
  } as unknown as ExtensionEngine;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createApp({ render: () => h(Panel) });
  root.provide(EXTENSION_ID_KEY, 'acme.direct');
  root.provide(APP_KEY, app);
  root.provide(ENGINE_KEY, windowEngine);
  root.mount(host);
  disposables.push({
    dispose: () => {
      root.unmount();
      host.remove();
    },
  });
  return host;
};

const click = async (host: HTMLElement, role: string) => {
  host.querySelector<HTMLButtonElement>(`[data-role="${role}"]`)?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
};

describe('acme.direct: panel', () => {
  it('lists the courses through the server and straight from the engine', async () => {
    const invoked: string[] = [];
    const host = mountPanel(invoked, []);
    await click(host, 'server');
    expect(invoked).toEqual(['courses.names']);
    expect(host.querySelector('li')?.textContent).toBe('From the server');

    await click(host, 'here');
    expect(
      [...host.querySelectorAll('li')].map((li) => li.textContent),
    ).toEqual(['Git', 'SQL']);
  });

  it('shows a rejected call as an error toast and does not reach the server', async () => {
    const invoked: string[] = [];
    const toasts: string[] = [];
    const host = mountPanel(invoked, toasts);
    await click(host, 'mark');
    expect(invoked).toEqual([]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatch(/^error: /);
  });
});
```

`createTestServer(server, { extensionId, engine })` gives the code the engine
you pass as `s.engine`; without it any use of `s.engine` throws. `running.rpc(contract, input)`
calls the handler the way the host does: the input must pass the contract's
schema and so must the result; an unregistered name and an error of the handler
reject the promise. `running.registration.rpcs` lists the names.

A component that uses `useRpc`, `useApp` or `useEngine` is mounted like any Vue
component in `happy-dom`: `app.provide(EXTENSION_ID_KEY, id)`,
`app.provide(APP_KEY, appApi)` and `app.provide(ENGINE_KEY, engine)` give it
what the app would. `createTestClient(client, { extensionId, app, engine })`
passes `app` and `engine` to the entry as `client.app` and `client.engine`.

## Try and ship

Run `pnpm dev`, start the app with `DOLPHY_DEV_EXTENSIONS` and open the "Direct"
panel from the sidebar menu.
