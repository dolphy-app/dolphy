# Recipe: visibility conditions, a widget and dependencies

Show a command or a panel only where it makes sense (`when`), draw a component
into a screen of the app (an injection), and require another extension
(`dependencies`). This recipe has no template of its own: start from `blank`
and replace the files below, which are checked as a whole project. See
[quick-start.md](quick-start.md) for the commands.

## The manifest

File `extension.json` (when-dependencies):

```json
{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "acme.hello",
  "version": "0.1.0",
  "apiVersion": 1,
  "name": "Hello report",
  "description": "A report command that appears only on the Courses screen.",
  "author": "your-github-login",
  "tags": ["productivity"],
  "dependencies": [
    { "id": "acme.cards", "range": ">=1.0.0 <2.0.0" },
    { "id": "dolphy.choice" }
  ]
}
```

`dependencies` is the only part of this recipe that lives in the manifest: up to
16 extensions that must be present, enabled, loaded and in the version `range`
(comparators separated by a space, such as `>=1.0.0 <2.0.0`; no `^` or `~`).
Otherwise the extension is shown as "dependencies not met" in Settings →
Extensions, with the missing, disabled or mismatched one named, and contributes
nothing. Disabling or enabling a dependency updates the dependents at once.

Nothing installs a dependency for the user, and extensions cannot call each
other: a dependency only says "this must be there". A repeat and a dependency on
yourself are manifest errors; extensions that depend on each other in a circle
are not loaded.

## The code

File `src/index.ts` (when-dependencies):

```ts
export { client } from './client.ts';
export { server } from './server.ts';
```

File `src/server.ts` (when-dependencies):

```ts
import { defineServer } from '@dolphy-app/extension-sdk';

export const server = defineServer((s) => {
  s.registerCommand({
    id: 'acme.hello.report',
    title: { en: 'Course report', ru: 'Отчёт по курсу' },
    when: "route == 'courses' && course.active",
    run: () => ({ courses: 1 }),
  });
});
```

File `src/client.ts` (when-dependencies):

```ts
import { anchorSelector, defineClient } from '@dolphy-app/extension-sdk';
import { Board } from './board.ts';
import { PlanNote } from './plan-note.ts';

export const client = defineClient((c) => {
  c.addPanel({
    id: 'acme.hello.board',
    title: { en: 'Course board', ru: 'Доска курса' },
    when: 'course.active && !session.active',
    component: Board,
  });

  // drawn inside the "Daily plan" screen, at the anchor the app keeps stable
  c.addInjection({
    id: 'acme.hello.plan-note',
    target: anchorSelector('dailyPlan'),
    component: PlanNote,
  });
});
```

File `src/board.ts` (when-dependencies):

```ts
import { defineComponent, h } from 'vue';

export const Board = defineComponent({
  setup: () => () => h('p', 'Board'),
});
```

File `src/plan-note.ts` (when-dependencies):

```ts
import { useInjection } from '@dolphy-app/extension-sdk/client';
import { defineComponent, h } from 'vue';

// `useInjection()` tells the component where the app drew it
export const PlanNote = defineComponent({
  setup() {
    const injection = useInjection();
    return () => h('p', `Drawn at the daily plan: ${injection.position}`);
  },
});
```

- `when` is a boolean expression over five keys of the app window: `route`
  (the name of the current screen, one of `WHEN_ROUTES`), `course.active` (one
  course is in focus), `session.active` (a study session is open), `locale`
  (`ru` or `en`) and `theme.dark`. Operators: `==`, `!=`, `in ('a', 'b')`, `&&`,
  `||`, `!` and parentheses; strings are in single quotes. At most 200
  characters. It goes on a command (`server.registerCommand`, also on one of its
  `keybindings`), a client command (`client.addCommand`) or a panel
  (`client.addPanel`). An unknown key or value, a wrong type or a syntax error
  fails the registration with the position in the message.
- While the condition is false a command is not in the palette and its keys do
  nothing, and a panel's menu item is hidden. The value follows the route, the
  course, the session, the language and the theme without a reload. Your own code
  still reaches the command (`panel.call`) and the panel (`openPanel`): `when`
  hides, it does not forbid.
- `client.addInjection({ id, target, position?, component })` draws the
  component at every element that matches the CSS selector `target`: `before` or
  `after` it, or inside it as its first (`prepend`) or last (`append`, the
  default) child. The window watches its DOM: the component is mounted when a
  target appears and removed when it goes away or when the extension is
  unloaded. An injection has no `when`: it exists where the target does.
- `anchorSelector('dailyPlan')` is `[data-ext-anchor="dailyPlan"]`, the place
  the app marks in the "Daily plan" screen and keeps stable. Any other selector
  depends on the markup of the app, which can change between versions, so the
  injection may silently stop finding its target after an update; prefer an
  anchor.
- The injected component runs in the app's own tree: `inject`, Vuetify, the
  theme and the language work. A failure shows an error card in its place and
  does not touch the rest of the window.

## The test

File `test/index.test.ts` (when-dependencies):

```ts
// @vitest-environment happy-dom
import {
  INJECTION_HANDLE_KEY,
  anchorSelector,
  evaluateWhen,
  parseWhen,
} from '@dolphy-app/extension-sdk';
import type { WhenContext } from '@dolphy-app/extension-sdk';
import {
  createTestClient,
  createTestServer,
} from '@dolphy-app/extension-sdk/testing';
import { describe, expect, it } from 'vitest';
import { createApp, h } from 'vue';
import manifest from '../extension.json';
import { client, server } from '../src/index.ts';
import { PlanNote } from '../src/plan-note.ts';

const context = (overrides: Partial<WhenContext> = {}): WhenContext => ({
  route: 'courses',
  'course.active': true,
  'session.active': false,
  locale: 'en',
  'theme.dark': false,
  ...overrides,
});

const parsed = (when: string | null | undefined) => {
  if (when === null || when === undefined) throw new Error('no condition');
  return parseWhen(when);
};

describe('acme.hello: when', () => {
  it('shows the report on the Courses screen with a course in focus', async () => {
    const running = await createTestServer(server, {
      extensionId: 'acme.hello',
    });
    const report = running.registration.commands.find(
      ({ id }) => id === 'acme.hello.report',
    );
    const when = parsed(report?.when);
    expect(evaluateWhen(when, context())).toBe(true);
    expect(evaluateWhen(when, context({ route: 'daily-plan' }))).toBe(false);
    expect(evaluateWhen(when, context({ 'course.active': false }))).toBe(false);
    await running.dispose();
  });

  it('hides the board during a study session', async () => {
    const running = await createTestClient(client, {
      extensionId: 'acme.hello',
    });
    const board = running.panels.find(({ id }) => id === 'acme.hello.board');
    const when = parsed(board?.when);
    expect(evaluateWhen(when, context())).toBe(true);
    expect(evaluateWhen(when, context({ 'session.active': true }))).toBe(false);
    await running.dispose();
  });

  it('reports a typo in a key with its position', () => {
    expect(() => parseWhen("rout == 'courses'")).toThrow();
  });
});

describe('acme.hello: injection', () => {
  it('is drawn at the anchor of the daily plan', async () => {
    const running = await createTestClient(client, {
      extensionId: 'acme.hello',
    });
    expect(running.injections).toEqual([
      {
        id: 'acme.hello.plan-note',
        target: anchorSelector('dailyPlan'),
        position: 'append',
        component: PlanNote,
      },
    ]);
    await running.dispose();
  });

  it('the component reads where the app drew it', () => {
    const host = document.createElement('div');
    const app = createApp({ render: () => h(PlanNote) });
    app.provide(INJECTION_HANDLE_KEY, {
      target: document.createElement('div'),
      position: 'append',
    });
    app.mount(host);
    expect(host.textContent).toBe('Drawn at the daily plan: append');
    app.unmount();
  });
});

describe('acme.hello: dependencies', () => {
  it('names each required extension once, and not itself', () => {
    const ids = manifest.dependencies.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(manifest.id);
  });
});
```

`createTestServer` and `createTestClient` hand the test what the code
registered: `running.registration.commands` for the server (with `when` as
registered) and `running.panels` and `running.injections` for the client. The
test feeds that text to `parseWhen` and `evaluateWhen`, the functions the app
uses; `evaluateWhen` is pure, so pass an object with the five keys. The
dependencies are manifest data, so the test reads `extension.json`.

## Try and ship

Run `pnpm build` and `pnpm validate`, which fails on a bad `dependencies`
entry. The test parses every `when`, so `pnpm test` catches a typo before the
app does (the app fails the registration with the position). In the app the
extension's row in Settings → Extensions shows "dependencies not met" until
`acme.cards` is installed and enabled. Open the Daily plan screen to see the
injected note.
