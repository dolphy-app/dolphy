# @dolphy-app/extension-sdk

SDK for extension authors ("exercise types"). The whole public API of
`@dolphy-app/extension-api` is re-exported from here; you do not install it
separately.

## Guide

The package ships a guide in `docs/` (in `node_modules/@dolphy-app/extension-sdk/docs/`
after the install); every code example in it is built, checked and run by the
repository's tests:

- [`docs/quick-start.md`](docs/quick-start.md) — from an empty directory to a
  command in the palette;
- recipes, each equal to a `create-dolphy-extension --template` project:
  [`docs/recipe-exercise-type.md`](docs/recipe-exercise-type.md),
  [`docs/recipe-theme.md`](docs/recipe-theme.md),
  [`docs/recipe-command-panel.md`](docs/recipe-command-panel.md),
  [`docs/recipe-event-storage.md`](docs/recipe-event-storage.md) and
  [`docs/recipe-settings.md`](docs/recipe-settings.md);
- [`docs/no-build.md`](docs/no-build.md) — an extension from two hand-written
  files, no TypeScript and no build;
- [`docs/debugging.md`](docs/debugging.md) — tests, checks, the development loop
  (`dolphy-ext dev`), DevTools and the log.

An extension's code is one file, `src/index.ts`, with named exports. The build
(`dolphy-ext build`, `@dolphy-app/extension-tools`) lays it out into
`main.mjs`, `view.mjs`, `panel.mjs` and `markdown.mjs`:

```ts
// src/index.ts
import { defineAnswerView, defineExtension } from '@dolphy-app/extension-sdk';
import type { ExtensionViews } from '@dolphy-app/extension-sdk';

// code of the extension host process (main.mjs)
export const host = defineExtension({
  exerciseTypes: {
    'acme.echo': {
      project: () => ({}),
      grade: ({ spec, answer }) =>
        answer === (spec as { expected: string }).expected
          ? { outcome: 'passed' }
          : { outcome: 'failed', reason: 'mismatch' },
    },
  },
});

// answer input in the app window (view.mjs): exercise type id -> view
export const views = {
  'acme.echo': defineAnswerView((api, props) => {
    const input = document.createElement('input');
    input.oninput = () => api.setAnswer(input.value, input.value.length > 0);
    api.root.append(input);
    return { update: (next) => void (input.disabled = next.disabled) };
  }),
} satisfies ExtensionViews;
```

```ts
// test/index.test.ts — checks without the app
import { loadExerciseType, loadView } from '@dolphy-app/extension-sdk/testing';
import { host, views } from '../src/index.ts';

const echo = await loadExerciseType(host, 'acme.echo');
await echo.grade({ spec: { expected: '42' }, answer: '42' }); // { outcome: 'passed' }

const view = await loadView(views, 'acme.echo'); // needs a DOM (happy-dom)
view.query<HTMLInputElement>('input'); // the view's shadow DOM
```

Importing `src/index.ts` has no side effects: `defineAnswerView` and the other
`define…` functions only describe things, so the file can be imported in tests
in plain Node. The package is `"sideEffects": false`. The custom element with
the tag from the manifest `element` is defined by the browser file the build
generates, not by your code.

- `defineAnswerView(mount)` — an entry of `views` (key: exercise type id).
  `mount(api, props)` gets `api.root` (shadow root), `api.label` (the app's
  `aria-label`), `api.setAnswer(value, complete)` and `api.submit()`, and
  returns `{ update(props), destroy?() }`; `props` are `view`, `value`,
  `disabled`, `verdict`.
- `defineExtensionPanel({ mount(container, ctx) })` — an entry of `panels`
  (key: panel id).
- `defineMarkdownRenderer(render)` — an entry of `markdown` (key: block
  language); `render(source, container, { language, signal })`. When it throws,
  the app keeps the original block text.
- `defineExtension({ exerciseTypes?, gradePolicies?, events?, commands?, activate?, deactivate? })`
  — the `host` export. `gradePolicies` is a dictionary `id -> GradePolicyHandler`;
  policies are registered and released together with the exercise types;
  `events` is a dictionary `event name -> handler` (see "State, settings and
  events").
- The keys of `views`, `panels` and `markdown` must be exactly the exercise
  types, panels and languages the manifest declares; the build reports a
  missing or extra key, and `satisfies ExtensionViews` (`ExtensionPanels`,
  `ExtensionMarkdown`) makes the compiler report it first (see "Typed ids").

Themes need no code: they are data in `extension.json`. Details on all
contribution points are in `docs/design/extensions.md`, "Точки вклада".

## Typed ids

`dolphy-ext types` (and every `dolphy-ext build`, also each `--watch` rebuild
after `extension.json` changes) reads `extension.json` and writes
`.dolphy/ids.d.ts`. It augments `ExtensionIds` of this package, so the ids the
manifest declares become types. No author code is run. Add the file to
`tsconfig.json` (`"include": ["src", ".dolphy/ids.d.ts"]` — a bare `.dolphy`
entry is skipped because it is a hidden directory) and keep `.dolphy` out of
git; the project template does both.

```ts
// extension.json declares: exercise type acme.echo, commands acme.a and
// acme.b, the event attempt.closed, setting acme.goal (number)
import { defineExtension, inActivate } from '@dolphy-app/extension-sdk';

export const host = defineExtension({
  // each record names exactly the declared ids: a missing or an extra key does
  // not compile
  exerciseTypes: { 'acme.echo': echo },
  events: { 'attempt.closed': ({ grade }) => void grade },
  // `inActivate` — "this id is registered in activate, with ctx"
  commands: { 'acme.a': () => 'a', 'acme.b': inActivate },
  activate(ctx) {
    ctx.settings.get('acme.goal'); // number
    ctx.settings.get('acme.nope'); // error: not declared
    ctx.commands.register('acme.b', () => ctx.settings.get('acme.goal'));
  },
});
```

- `defineExtension({ exerciseTypes, gradePolicies, events, commands })` — a
  record is required when the manifest declares ids of its kind (and must be
  left out when it declares none), and it names every declared id exactly once.
  A handler that needs `ctx` is written in `activate`; its id gets the value
  `inActivate` in the record. The host still warns after activation about a
  declared id nobody registered.
- `ctx.settings.get(id)` returns the type of the setting: `boolean`, `string`
  (also for `text` and `color`), `string[]` for a `list`, `number`, or the union
  of the option values of an `enum`.
  `ctx.settings.onDidChange` hands over `{ id, value }` that narrows `value` by
  `id`. `ctx.commands.register`, `ctx.events.on` (the handler payload follows
  the event name), `ctx.registerExerciseType` and `ctx.registerGradePolicy`
  accept the declared ids only; so do `ctx.call` in a panel and `openPanel`.
- Write `export const views = { … } satisfies ExtensionViews` (likewise
  `panels` with `ExtensionPanels` and `markdown` with `ExtensionMarkdown`):
  the keys must be exactly the declared exercise types, panels and languages.
- Without `.dolphy/ids.d.ts` (no generated file) every id is a plain `string`,
  `ctx.settings.get` returns `boolean | string | number | string[]`, and the records are
  optional and open.

## Testing helpers

`@dolphy-app/extension-sdk/testing`:

- `loadExerciseType(host, type)`, `loadGradePolicy(host, id)`,
  `loadEvents(host, options?)`, `loadCommands(host, options?)` activate the
  `host` export as it is, with in-memory storage, settings, events and
  commands, and give the test the handlers (`grade`, `evaluate`, `emit`, `run`,
  `dispose()`). `loadExerciseType` checks the shape of results;
  `loadGradePolicy` checks that a result is an integer 1–5 or `null`.
- `loadView(views, id, options?)` mounts the view in the test DOM (happy-dom or
  jsdom) with the same element the app creates. `options`: initial `view`,
  `value`, `disabled`, `verdict`, `label` (the host `aria-label`) and
  `container`. It returns `changes` (`dolphy-answer-change` details, in order),
  `submissions`, `update(props)` (sets properties and waits until the view has
  applied them), `query(selector)` / `queryAll(selector)` over the shadow DOM,
  `root`, `element` and `dispose()`.
- `loadPanel(panels, id, options?)` mounts the panel with the context the frame
  gives it. `options`: `props`, `call(commandId, args)` (the answer to
  `ctx.call`; without it calls are rejected) and `container`. It returns
  `container`, `calls`, `aborted`, `setProps(props)` (delivers new `ctx.onProps`
  values) and `dispose()` (aborts `ctx.signal`).
- `createSchemaValidator(schema)`, `createMemoryLibrary(files)`,
  `createMemoryStorage()`, `createMemorySettings(definitions, values?)`,
  `createMemoryEvents(options?)`, `createMemoryCommands(options?)`,
  `createMemoryStats(options?)`.

```ts
// src/index.ts — a grade policy (needs main)
import { defineExtension } from '@dolphy-app/extension-sdk';

export const host = defineExtension({
  gradePolicies: {
    // 1–5 or null ("self-assessment needed"); a failing policy falls back to passAtN
    'acme.policy.generous': ({ verdicts, gaveUp }) =>
      gaveUp
        ? 1
        : verdicts.some(({ outcome }) => outcome === 'passed')
          ? 5
          : null,
  },
});
```

```ts
// test/index.test.ts
import { loadGradePolicy } from '@dolphy-app/extension-sdk/testing';
import { host } from '../src/index.ts';

const policy = await loadGradePolicy(host, 'acme.policy.generous');
await policy.evaluate({ verdicts: [{ outcome: 'passed' }], gaveUp: false }); // 5
```

## State, settings and events

Three capabilities of the context `ctx`; details and manifest examples are in
`docs/design/extensions.md`.

```ts
// extension.json: "permissions": ["learning.events"],
// "contributes": { "events": [{ "event": "attempt.closed" }],
//   "settings": [{ "id": "acme.streak.goal", "type": "number", "label": "Daily goal",
//     "default": 3, "min": 1, "max": 20, "integer": true }] }
import {
  defineExtension,
  type ExtensionContext,
} from '@dolphy-app/extension-sdk';

let ctx: ExtensionContext;
export const host = defineExtension({
  activate: (context) => void (ctx = context),
  events: {
    'attempt.closed': async ({ at }) => {
      const day = new Date(at).toISOString().slice(0, 10);
      const done = (await ctx.storage.get<number>(day)) ?? 0;
      await ctx.storage.set(day, done + 1);
      if (done + 1 === ctx.settings.get('acme.streak.goal')) {
        ctx.logger.info({ day }, 'daily goal reached');
      }
    },
  },
});
```

- `ctx.storage` — `get<T>(key)`, `set(key, value)`, `delete(key)`, `keys()`: JSON
  under string keys, each extension has its own space; data survives restart,
  update and disabling. No permission is needed, but there are ceilings
  (`EXTENSION_STORAGE_LIMITS`): key — 128 characters, value — 64 KiB, 256 keys,
  1 MiB in total. Exceeding one throws `StorageQuotaError` (`kind`, `limit`),
  nothing is written. Works in the restricted process too.
- `ctx.settings` — `get(id)` (synchronous: the user's value or the
  `default`; an `id` outside the manifest throws) and `onDidChange(handler)`: a
  change in "Settings → Extensions" reaches the running extension without a
  restart.
- `ctx.events.on(name, handler)` (and `events` in `defineExtension`) — the
  learning events `session.started`, `session.finished`, `attempt.closed`; they
  need the `learning.events` permission and a declaration in
  `contributes.events`, otherwise it throws. One handler per event. Delivery is
  asynchronous, in order, at most once; a handler gets 2 s; the queue holds 100
  events per extension (the oldest are dropped with a warning in the log); a
  handler's failure, exception and timeout affect only the log.
- `ctx.stats` — aggregated learning statistics; needs the `learning.stats`
  permission, otherwise every call rejects with `PermissionError('learning.stats')`
  (in the restricted process too: the engine decides, not the process).
  `streak({ courseId? })` gives `{ current, longest }` in days, `daily({ from, to, courseId? })`
  one `{ date, attempts, correct, accuracy }` per date from `from` to `to`
  inclusive (`YYYY-MM-DD`, at most `EXTENSION_STATS_LIMITS.dailyDays` = 366;
  `accuracy` is `correct / attempts`, `null` without attempts). Days are local
  days of the user; an attempt is correct at grade 3 or higher; `current` is
  not broken while today has no attempts yet (the streak up to yesterday
  counts); a progress reset does not erase the history; an unknown course gives
  zeros. The answer holds numbers and dates only: no exercise or course ids.
- The host logs a warning after activation for the exercise types, grade
  policies, events and commands the manifest declares but the code did not
  register.
- Test helpers: `createMemoryStorage()` (same ceilings and
  `StorageQuotaError`), `createMemorySettings(definitions, values?)` (values are
  checked against the definitions, `set(id, value)` calls `onDidChange`),
  `createMemoryEvents(options?)` (`emit(name, payload)` sends an event to the
  subscriber) and `loadEvents(host, { settings?, settingValues?, declared?, storage? })`,
  which activates the module and returns `emit`, `storage`, `settings`. Unlike
  the host, the helpers do not swallow a handler failure and do not count 2 s.
  `loadExerciseType` and `loadGradePolicy` accept ready-made `storage`,
  `settings` and `events` (objects from these helpers).
- `createMemoryStats({ attempts?, timeZone?, now?, permitted? })` is `ctx.stats`
  over a list of attempts (`{ at, grade, courseId? }`; more through
  `record(attempt)`) with the app's rules: local days in `timeZone`, correct at
  grade 3 or higher, the same range limits. `permitted: false` makes every call
  reject with `PermissionError('learning.stats')`. All `load*` helpers take
  `stats`; by default the statistics are empty.

## Commands and panels

A command is the `contributes.commands` point (needs main), a panel is
`contributes.panels` (a screen in an isolated frame, module `./panel.mjs` by
default, main is not needed).

```ts
// src/index.ts — handlers by id; every command is declared in the manifest
import {
  defineExtension,
  defineExtensionPanel,
  notify,
  openPanel,
  type ExtensionPanels,
} from '@dolphy-app/extension-sdk';

export const host = defineExtension({
  commands: {
    'acme.tools.open': () => openPanel('acme.tools.main', { from: 'palette' }),
    'acme.tools.ping': () => notify('pong'),
  },
});

export const panels = {
  'acme.tools.main': defineExtensionPanel({
    mount(container, ctx) {
      container.textContent = `${ctx.panelId}: ${JSON.stringify(ctx.props)}`;
      void ctx.call('acme.tools.ping'); // any declared command, palette: false included
    },
  }),
} satisfies ExtensionPanels;
```

```ts
// test/index.test.ts — checks without the app
import { loadCommands, loadPanel } from '@dolphy-app/extension-sdk/testing';
import { host, panels } from '../src/index.ts';

const commands = await loadCommands(host, {
  declaredCommands: ['acme.tools.open', 'acme.tools.ping'],
  declaredPanels: ['acme.tools.main'],
});
await commands.run('acme.tools.ping'); // { kind: 'notify', text: 'pong' }

const panel = await loadPanel(panels, 'acme.tools.main', {
  props: { from: 'test' },
  call: async () => undefined,
});
panel.calls; // [{ commandId: 'acme.tools.ping', args: undefined }]
```

- `defineExtension({ commands })` — a dictionary `id -> CommandHandler`; so does
  `ctx.commands.register(id, handler)`. The result is `notify(text)` (1–500
  characters), `openPanel(id, props?)`, a JSON value or nothing.
- `defineExtensionPanel({ mount(container, ctx) })` — `ctx` has `panelId`,
  `props`, `signal`, `call(commandId, args?)`, `onProps(listener)`.
- `loadCommands(host, options?)` gives `run(id, args?)` → `CommandOutcome`,
  `ids()`, `dispose()`; it throws on an unregistered command and an invalid
  result (the rules are `normalizeCommandResult` from
  `@dolphy-app/extension-api`).

## Style sheets, images and fonts

A panel, an answer element and a content renderer run in an isolated frame and
can bring their own style sheets (`css`), images (`png`, `webp`, `jpg`, `jpeg`,
`svg`) and fonts (`woff2`). `dolphy-ext build` carries them in two ways:

```ts
// src/index.ts — inlined: a string and a small data URI, no extra file
import css from './panel.css?inline'; // style sheet as a string
import mark from './mark.png?url'; // up to 4 KiB: a data: URI

export const panels = {
  'acme.tools.main': defineExtensionPanel({
    mount(container) {
      const style = document.createElement('style');
      style.textContent = css;
      container.append(style);

      // a separate file: above 4 KiB the build writes assets/hero-<hash>.png
      const hero = document.createElement('img');
      hero.src = new URL('./hero.png', import.meta.url).href;
      hero.alt = '';
      // a file you put into assets/ yourself
      const font = new FontFace(
        'Acme',
        `url(${new URL('assets/acme.woff2', import.meta.url).href})`,
      );
      container.append(hero);
      void font.load().then(() => document.fonts.add(font));
    },
  }),
};
```

The frame loads scripts, style sheets, images and fonts only from its own
extension (`dolphy-ext://<id>/…`, plus `data:` and `blob:`): a file of another
extension is blocked, and so are `extension.json` and `README.md`. Build every
URL from `import.meta.url` (the frame page has no `<base>`); inside a style sheet
`url(font.woff2)` is relative to the sheet. A `<link rel="stylesheet">` works in
a container, in `document.head` and in a shadow root, but `@font-face` registers a
font only in a document-level sheet, so an element with a shadow root that needs
its own font must link the sheet into `document.head` too. Use an SVG as an image
(`<img>`, `url()`); it is never run as a document.

Choose the inlined form for small things (one file, nothing to fetch) and a
separate file for big images and fonts; the details, the limits and what the
build refuses (unsafe SVG, `@import`, external `url()`, a forged image header) are
in the README of `@dolphy-app/extension-tools`. A plain `import './panel.css'` is
an error. Declare the suffixes for TypeScript once:
`declare module '*?inline' { const text: string; export default text; }` and the
same for `'*?url'`.

The manifest `icon` (`"icon": "assets/icon.png"`, a square 64–512 px PNG or WebP up
to 16 KiB) is what the app shows for the extension at 32 px.

## Permissions and `ctx.library`

An extension that is not bundled and not trusted runs in a restricted process
(`docs/design/extensions.md`, "Права и изоляция"): what `permissions` of the
manifest does not declare is unavailable. The SDK exports
`EXTENSION_PERMISSIONS` (`library.read`, `process.spawn`, `worker.threads`,
`native.addons`, `network`, `learning.events`, `learning.stats`) and the
`PermissionError` class
(`permission`, `code: 'EXT_PERMISSION'`).

- `ctx.library` in the restricted process is a proxy: `readText` and `stat`
  requests are run by the parent, and only if `library.read` is declared.
  Without it both methods throw `PermissionError` (checked before the parent is
  asked; the parent refuses too). An uncaught handler exception becomes a
  `handler-failed` error, a check becomes an `error` verdict.
- Spawning processes, threads and native modules without `process.spawn`,
  `worker.threads` and `native.addons` fail with `ERR_ACCESS_DENIED` from Node;
  `network` is informational, it does not limit network access of code.
- A trusted extension and a bundled one have no restrictions.
- `@dolphy-app/extension-sdk/testing` runs a handler in your process, without
  restrictions and without checking `permissions`: `PermissionError` and
  `ERR_ACCESS_DENIED` are not reproduced there, so check permissions in the app
  (as a third-party, untrusted extension).
