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
  "permissions": ["learning.events"],
  "tags": ["learning"],
  "contributes": {
    "events": [{ "event": "attempt.closed" }],
    "commands": [
      { "id": "acme.hello.show", "title": "Show the streak", "category": "Streak" },
      { "id": "acme.hello.data", "title": "Streak data", "palette": false }
    ],
    "panels": [{ "id": "acme.hello.view", "title": "Streak" }]
  }
}
```

- `permissions: ["learning.events"]` and `contributes.events` are both required
  to receive an event. The events are `session.started`, `session.finished` and
  `attempt.closed`. The payloads carry ids, the grade, the outcome and the time,
  never the learner's answer or the exercise text.
- Mention the permission in your `README.md` and say what it is for: the catalog
  review asks.
- Storage and settings need no permission.

## The code

File `src/index.ts` (events):

```ts
import {
  defineExtension,
  defineExtensionPanel,
  inActivate,
  notify,
  openPanel,
} from '@dolphy-app/extension-sdk';
import type { ExtensionPanels } from '@dolphy-app/extension-sdk';

// a `type`, not an `interface`: an interface has no index signature and is
// not JSON for `ctx.storage`
export type Streak = {
  days: number;
  last: string;
};

const KEY = 'streak';
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

// every event and command declared in extension.json is listed here;
// `inActivate` means "registered in `activate`": the handlers need `ctx`
export const host = defineExtension({
  events: { 'attempt.closed': inActivate },
  commands: { 'acme.hello.show': inActivate, 'acme.hello.data': inActivate },
  activate(ctx) {
    // delivered asynchronously, once per recorded attempt
    ctx.events.on('attempt.closed', async ({ at, outcome }) => {
      if (outcome === 'gave-up') return;
      const streak = await ctx.storage.get<Streak>(KEY);
      await ctx.storage.set(KEY, advance(streak, at));
    });

    // data for the panel: hidden from the palette, the panel calls it
    ctx.commands.register(
      'acme.hello.data',
      async () => (await ctx.storage.get<Streak>(KEY)) ?? { days: 0, last: '' },
    );

    ctx.commands.register('acme.hello.show', async () => {
      const streak = await ctx.storage.get<Streak>(KEY);
      if (streak === undefined) {
        return notify('No streak yet: finish your first exercise.');
      }
      return openPanel('acme.hello.view', { days: streak.days });
    });
  },
});

// the panel runs in an isolated frame: no network, the only way out is `ctx.call`
export const panels = {
  'acme.hello.view': defineExtensionPanel({
    async mount(container, ctx) {
      const line = container.ownerDocument.createElement('p');
      container.append(line);
      const render = async () => {
        const streak = (await ctx.call('acme.hello.data')) as Streak;
        line.textContent =
          streak.days === 0
            ? 'No streak yet.'
            : `Streak: ${streak.days} days, last day ${streak.last}`;
      };
      // the command opens the panel again with new properties: redraw
      ctx.signal.addEventListener(
        'abort',
        ctx.onProps(() => void render()),
      );
      await render();
    },
  }),
} satisfies ExtensionPanels;
```

- `ctx.events.on(name, handler)`: one handler per event. Delivery is
  asynchronous, in order and at most once; a handler gets 2 seconds, the queue
  holds 100 events per extension, and a failing handler only reaches the log.
- `ctx.storage` is JSON under string keys, private to the extension, kept across
  restarts and updates. The value must be JSON: that is why `Streak` is a
  `type`, not an `interface`. Ceilings: key 128 characters, value 64 KiB, 256
  keys, 1 MiB in total; exceeding one throws `StorageQuotaError`.
- `advance` is a pure function exported for the test. The hidden command
  `acme.hello.data` is how the panel reads the stored value.

## The tests

File `test/index.test.ts` (events):

```ts
// @vitest-environment happy-dom
import type { LearningEventPayloads } from '@dolphy-app/extension-api';
import {
  createMemoryStorage,
  loadCommands,
  loadEvents,
  loadPanel,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { host, panels } from '../src/index.ts';

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

const load = async () => {
  const storage = createMemoryStorage();
  const events = await loadEvents(host, {
    storage,
    declared: ['attempt.closed'],
  });
  const commands = await loadCommands(host, {
    storage,
    declaredCommands: ['acme.hello.show', 'acme.hello.data'],
    declaredPanels: ['acme.hello.view'],
  });
  disposables.push(events, commands);
  return { storage, events, commands };
};

describe('acme.hello: events and storage', () => {
  it('counts consecutive days, ignores a repeat on the same day', async () => {
    const { storage, events } = await load();
    await events.emit('attempt.closed', attempt('2026-10-01'));
    await events.emit('attempt.closed', attempt('2026-10-01'));
    await events.emit('attempt.closed', attempt('2026-10-02'));
    expect(await storage.get('streak')).toEqual({
      days: 2,
      last: '2026-10-02',
    });
  });

  it('a skipped day starts over; giving up leaves the streak alone', async () => {
    const { storage, events } = await load();
    await events.emit('attempt.closed', attempt('2026-10-01'));
    await events.emit('attempt.closed', attempt('2026-10-02'));
    await events.emit('attempt.closed', attempt('2026-10-03', 'gave-up'));
    expect(await storage.get('streak')).toEqual({
      days: 2,
      last: '2026-10-02',
    });
    await events.emit('attempt.closed', attempt('2026-10-05'));
    expect(await storage.get('streak')).toEqual({
      days: 1,
      last: '2026-10-05',
    });
  });
});

describe('acme.hello: commands and panel', () => {
  it('without a streak the show command notifies, the data command returns zeros', async () => {
    const { commands } = await load();
    expect(await commands.run('acme.hello.show')).toMatchObject({ kind: 'notify' });
    expect(await commands.run('acme.hello.data')).toEqual({
      kind: 'data',
      value: { days: 0, last: '' },
    });
  });

  it('with a streak the show command opens the panel with the days', async () => {
    const { events, commands } = await load();
    await events.emit('attempt.closed', attempt('2026-10-01'));
    expect(await commands.run('acme.hello.show')).toEqual({
      kind: 'openPanel',
      panelId: 'acme.hello.view',
      props: { days: 1 },
    });
  });

  it('the panel shows what the data command returns', async () => {
    const { events, commands } = await load();
    await events.emit('attempt.closed', attempt('2026-10-01'));
    const panel = await loadPanel(panels, 'acme.hello.view', {
      call: async (commandId) => {
        const result = await commands.run(commandId);
        return result.kind === 'data' ? result.value : undefined;
      },
    });
    disposables.push(panel);
    expect(panel.container.querySelector('p')?.textContent).toBe(
      'Streak: 1 days, last day 2026-10-01',
    );
  });
});
```

`loadEvents` activates the extension and gives `emit(name, payload)`, so the test
sends events the way the host delivers them. `createMemoryStorage` has the same
ceilings as the app. Pass the same `storage` to `loadEvents` and `loadCommands`
and both see one state. Unlike the host, the helpers do not swallow a handler's
failure and do not count the 2 seconds.

## Try and ship

Run `pnpm dev`, start the app with `DOLPHY_DEV_EXTENSIONS`, close an attempt in
a lesson, then run "Show the streak" from the palette.
