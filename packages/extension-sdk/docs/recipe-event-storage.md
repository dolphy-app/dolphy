# Recipe: events and storage

React to what the learner does and remember it. This recipe is the `events`
template
(`npx @dolphy-app/create-extension <dir> --id acme.hello --template events`): a
day streak counter that listens to closed attempts, keeps the streak in storage
and shows it in a panel. The files below are exactly what the generator writes
for the id `acme.hello`. See [quick-start.md](quick-start.md) for the commands.

## The manifest

File `extension.json` (events):

```json
{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "acme.hello",
  "version": "0.1.0",
  "apiVersion": 1,
  "name": "Day streak",
  "description": "Counts the days in a row with a closed attempt and shows the streak.",
  "author": "your-github-login",
  "tags": ["learning"]
}
```

Nothing about events is in the manifest: `server.on` is the subscription.

## The server part

File `src/index.ts` (events):

```ts
export { client } from './client.ts';
export { server } from './server.ts';
```

File `src/streak.ts` (events):

```ts
// a `type`, not an `interface`: an interface has no index signature and is
// not JSON for `server.storage`
export type Streak = {
  days: number;
  last: string;
};

const DAY_MS = 86_400_000;

const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

// the streak grows when an attempt is closed the day after the last one;
// the same day changes nothing, a skipped day starts over
export const advance = (streak: Streak | undefined, at: number): Streak => {
  const day = dayOf(at);
  if (streak?.last === day) return streak;
  const continues =
    streak !== undefined && dayOf(Date.parse(streak.last) + DAY_MS) === day;
  return { days: continues ? streak.days + 1 : 1, last: day };
};
```

File `src/server.ts` (events):

```ts
import { defineServer, notify, openPanel } from '@dolphy-app/extension-sdk';
import { advance } from './streak.ts';
import type { Streak } from './streak.ts';

const KEY = 'streak';

// runs in the extension host: every call registers a contribution
export const server = defineServer((s) => {
  // delivered asynchronously, once per recorded attempt
  s.on('attempt.closed', async ({ at, outcome }) => {
    if (outcome === 'gave-up') return;
    const streak = await s.storage.get<Streak>(KEY);
    await s.storage.set(KEY, advance(streak, at));
  });

  // data for the panel: hidden from the palette, the panel calls it
  s.registerCommand({
    id: 'acme.hello.data',
    title: 'Streak data',
    palette: false,
    run: async () =>
      (await s.storage.get<Streak>(KEY)) ?? { days: 0, last: '' },
  });

  s.registerCommand({
    id: 'acme.hello.show',
    title: { en: 'Show the streak', ru: 'Показать серию' },
    category: 'Streak',
    run: async () => {
      const streak = await s.storage.get<Streak>(KEY);
      if (streak === undefined) {
        return notify('No streak yet: finish your first exercise.');
      }
      return openPanel('acme.hello.view', { days: streak.days });
    },
  });
});
```

- `server.on(name, handler)` subscribes to a learning event: `session.started`,
  `session.finished` or `attempt.closed`. The payloads carry ids, the grade, the
  outcome and the time, never the learner's answer or the exercise text. One
  handler per event. Delivery is asynchronous, in order and at most once; a
  handler gets 2 seconds, the queue holds 100 events per extension, and a
  failing handler only reaches the log.
- `server.storage` is JSON under string keys, private to the extension, kept
  across restarts and updates. The value must be JSON: that is why `Streak` is a
  `type`, not an `interface`. Ceilings: key 128 characters, value 64 KiB, 256
  keys, 1 MiB in total; exceeding one throws `StorageQuotaError`.
- `advance` is a pure function in its own file, so the test can import it. The
  hidden command `acme.hello.data` is how the panel reads the stored value.

## The client part

File `src/client.ts` (events):

```ts
import { defineClient } from '@dolphy-app/extension-sdk';
import { StreakPanel } from './streak-panel.ts';

// runs in the app window: the panel is a Vue component the app draws
export const client = defineClient((c) => {
  c.addPanel({
    id: 'acme.hello.view',
    title: { en: 'Streak', ru: 'Серия' },
    component: StreakPanel,
  });
});
```

File `src/streak-panel.ts` (events):

```ts
import { usePanel } from '@dolphy-app/extension-sdk/client';
import { defineComponent, h, ref, watchEffect } from 'vue';
import type { Streak } from './streak.ts';

// the only way to the data is `panel.call` to the commands of the server
export const StreakPanel = defineComponent({
  setup() {
    const panel = usePanel();
    const text = ref('');
    // the command opens the panel again with new properties: ask again
    watchEffect(async () => {
      void panel.props;
      const streak = (await panel.call('acme.hello.data')) as Streak;
      text.value =
        streak.days === 0
          ? 'No streak yet.'
          : `Streak: ${streak.days} days, last day ${streak.last}`;
    });
    return () => h('p', text.value);
  },
});
```

- The panel is a Vue component registered with `client.addPanel`: `usePanel()`
  gives it `call` for the commands of the server part and the reactive `props`.
  Reading `panel.props` inside `watchEffect` makes the panel ask again when the
  `show` command opens it with new properties.

## The tests

File `test/index.test.ts` (events):

```ts
// @vitest-environment happy-dom
import { PANEL_HANDLE_KEY } from '@dolphy-app/extension-sdk';
import type {
  JsonValue,
  LearningEventPayloads,
  PanelHandle,
} from '@dolphy-app/extension-sdk';
import {
  createTestClient,
  createTestServer,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, shallowReactive } from 'vue';
import { client, server } from '../src/index.ts';
import { StreakPanel } from '../src/streak-panel.ts';

const disposables: { dispose(): unknown }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

type Attempt = LearningEventPayloads['attempt.closed'];

const attempt = (day: string, outcome: Attempt['outcome'] = 'passed'): Attempt => ({
  exerciseId: 'e',
  courseId: 'c',
  lessonId: 'l',
  grade: 4,
  outcome,
  source: 'runner',
  at: Date.parse(`${day}T12:00:00Z`),
});

const start = async () => {
  const running = await createTestServer(server, { extensionId: 'acme.hello' });
  disposables.push(running);
  return running;
};

// draws the panel the way the app does: the handle is provided to the component
const mountPanel = async (call: PanelHandle['call']) => {
  const handle = shallowReactive({
    panelId: 'acme.hello.view',
    props: undefined as JsonValue | undefined,
    context: { courseId: null },
    call,
  });
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({ render: () => h(StreakPanel) });
  app.provide(PANEL_HANDLE_KEY, handle);
  app.mount(host);
  disposables.push({
    dispose: () => {
      app.unmount();
      host.remove();
    },
  });
  // the panel asks a command: wait for the reply, then for the redraw
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
  return host;
};

describe('acme.hello: events and storage', () => {
  it('subscribes to attempt.closed', async () => {
    const running = await start();
    expect(running.registration.events).toEqual(['attempt.closed']);
  });

  it('counts consecutive days, ignores a repeat on the same day', async () => {
    const running = await start();
    await running.events.emit('attempt.closed', attempt('2026-10-01'));
    await running.events.emit('attempt.closed', attempt('2026-10-01'));
    await running.events.emit('attempt.closed', attempt('2026-10-02'));
    expect(await running.storage.get('streak')).toEqual({
      days: 2,
      last: '2026-10-02',
    });
  });

  it('a skipped day starts over; giving up leaves the streak alone', async () => {
    const running = await start();
    await running.events.emit('attempt.closed', attempt('2026-10-01'));
    await running.events.emit('attempt.closed', attempt('2026-10-02'));
    await running.events.emit('attempt.closed', attempt('2026-10-03', 'gave-up'));
    expect(await running.storage.get('streak')).toEqual({
      days: 2,
      last: '2026-10-02',
    });
    await running.events.emit('attempt.closed', attempt('2026-10-05'));
    expect(await running.storage.get('streak')).toEqual({
      days: 1,
      last: '2026-10-05',
    });
  });
});

describe('acme.hello: commands and panel', () => {
  it('without a streak the show command notifies, the data command returns zeros', async () => {
    const running = await start();
    expect(await running.commands.run('acme.hello.show')).toMatchObject({
      kind: 'notify',
    });
    expect(await running.commands.run('acme.hello.data')).toEqual({
      kind: 'data',
      value: { days: 0, last: '' },
    });
  });

  it('with a streak the show command opens the panel with the days', async () => {
    const running = await start();
    await running.events.emit('attempt.closed', attempt('2026-10-01'));
    expect(await running.commands.run('acme.hello.show')).toEqual({
      kind: 'openPanel',
      panelId: 'acme.hello.view',
      props: { days: 1 },
    });
  });

  it('the client adds the panel the show command opens', async () => {
    const running = await createTestClient(client, { extensionId: 'acme.hello' });
    disposables.push(running);
    expect(running.panels.map((panel) => panel.id)).toEqual(['acme.hello.view']);
  });

  it('the panel shows what the data command returns', async () => {
    const running = await start();
    await running.events.emit('attempt.closed', attempt('2026-10-01'));
    const panel = await mountPanel(async (commandId) => {
      const result = await running.commands.run(commandId);
      return result.kind === 'data' ? (result.value as JsonValue) : undefined;
    });
    expect(panel.querySelector('p')?.textContent).toBe(
      'Streak: 1 days, last day 2026-10-01',
    );
  });
});
```

`createTestServer(server, { extensionId })` starts `server`, and
`running.events.emit(name, payload)` delivers an event the way the host does and
awaits the handler; `running.registration.events` lists the subscriptions.
`running.storage` is in memory with the same ceilings as the app, and the test
reads what the handler wrote. Unlike the host, the harness does not swallow a
handler's failure and does not count the 2 seconds.

The panel is mounted with `createApp` in `happy-dom`;
`app.provide(PANEL_HANDLE_KEY, handle)` gives it a handle whose `call` runs the
real command handlers of the running server.

## Try and ship

Run `pnpm dev`, start the app with `DOLPHY_DEV_EXTENSIONS`, close an attempt in
a lesson, then run "Show the streak" from the palette.
