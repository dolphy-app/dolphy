# @dolphy-app/extension-sdk

SDK for extension authors. The whole public API of
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
  [`docs/recipe-event-storage.md`](docs/recipe-event-storage.md),
  [`docs/recipe-settings.md`](docs/recipe-settings.md),
  [`docs/recipe-import-export.md`](docs/recipe-import-export.md),
  [`docs/recipe-when-dependencies.md`](docs/recipe-when-dependencies.md);
- [`docs/no-build.md`](docs/no-build.md) — an extension from hand-written
  files, no TypeScript and no build;
- [`docs/debugging.md`](docs/debugging.md) — tests, checks, the development loop
  (`dolphy-ext dev`), DevTools and the log.

## Two entries

`extension.json` holds the identity of the extension (id, version, name,
author, tags, dependencies). Everything the extension adds to the app is
registered by code. `src/index.ts` exports up to two entries:

- `server` — runs in the extension host process; registers exercise types,
  grade policies, settings, event handlers, commands, schedules, importers and
  exporters. `dolphy-ext build` writes it to `main.mjs`.
- `client` — runs in the app window; adds panels, injected components, answer
  views, markdown renderers, themes and client commands. `dolphy-ext build`
  writes it to `client.mjs`.

`dolphy-ext build` writes the names of the built files into `main` and
`client` of the built `extension.json`. An extension may have either entry or
both. Ids are written in the code, prefixed with the extension id.

```ts
// src/index.ts
export { client } from './client.ts';
export { server } from './server.ts';
```

```ts
// src/server.ts — the extension host
import { defineExerciseType, defineServer } from '@dolphy-app/extension-sdk';

export const server = defineServer((s) => {
  s.registerExerciseType(
    defineExerciseType<{ expected: string }, string, Record<string, never>>({
      id: 'acme.echo',
      specSchema: {
        type: 'object',
        required: ['expected'],
        properties: { expected: { type: 'string' } },
      },
      answerSchema: { type: 'string' },
      project: () => ({}),
      grade: ({ spec, answer }) =>
        answer === spec.expected
          ? { outcome: 'passed' }
          : { outcome: 'failed', reason: 'mismatch' },
    }),
  );
});
```

```ts
// src/client.ts — the app window
import { defineClient } from '@dolphy-app/extension-sdk';
import { EchoAnswer } from './echo-answer.ts';

export const client = defineClient((c) => {
  c.addAnswerView('acme.echo', EchoAnswer);
});
```

```ts
// test/index.test.ts — checks without the app
import { createTestServer } from '@dolphy-app/extension-sdk/testing';
import { server } from '../src/index.ts';

const running = await createTestServer(server);
await running.exerciseType('acme.echo').grade({
  spec: { expected: '42' },
  answer: '42',
}); // { outcome: 'passed' }
```

Keep the two parts in separate files and re-export them from `src/index.ts`:
the server part must not import `vue`, `vuetify` or a component, the client part
must not import `node:*` modules; the build reports a violation with the file
and the rule. Importing `src/index.ts` has no side effects: `defineServer`
and `defineClient` return their argument unchanged and are marked
`/*#__NO_SIDE_EFFECTS__*/`. The package is `"sideEffects": false`.

- `defineServer(entry)` — `entry(server)` gets a `ServerContext`; every
  `register…` call returns a `Disposable` that removes the contribution. The
  host runs the entry when it loads the extension (not lazily). A failure, an
  invalid registration or more than 10 seconds leave the extension without any
  contribution and show `load-failed` in "Settings → Extensions". The entry may
  return a cleanup function (or a `Disposable`), called when the extension is
  unloaded.
- `defineClient(entry)` — `entry(client)` gets a `ClientContext` where the
  components are Vue components: `addPanel({ id, title, component, icon?, when? })`,
  `addInjection({ id, target, position?, component })`,
  `addAnswerView(exerciseTypeId, component)`,
  `addMarkdownRenderer(language, component)`, `addTheme(registration)`,
  `addCommand({ id, title, run, … })`. Components are passed directly; there is
  no wrapper to call.
- `defineExerciseType(registration)` — only infers `Spec`, `Answer` and `View`
  from the handlers of an exercise type registration.
- Texts the user sees (`title`, `label`, `description`, `category`, `group`)
  are `LocalizedText`: a string, or `{ en, ru? }`; `resolveLocalizedText(text,
locale)` picks one.

### Components

- An answer view takes the props of `AnswerViewProps` (`view`, `value`,
  `disabled`, `verdict`, `label`) and emits `change` with an `AnswerChange`
  (`{ value, complete }`) and `submit` without data.
- A markdown renderer takes the props of `MarkdownBlockProps` (`source`,
  `language`). When it fails the app shows an error block in place of the block
  and the rest of the text stays.
- `usePanel()` from `@dolphy-app/extension-sdk/client`, inside a panel
  component, returns the handle: `panelId`, the reactive `props` the panel was
  opened with (a repeated `openPanel(id, props)` updates them in place), the
  reactive `context` (`{ courseId }`) and `call(commandId, args?)`, which
  reaches the commands of this extension (`palette: false` ones included).
  Outside a panel it throws.
- `useInjection()`, inside an injected component, returns `target` (the
  element the component is drawn at) and `position`. Outside an injected
  component it throws.
- `usePanel()` takes the command ids as a type parameter:
  `usePanel<'acme.go' | 'acme.stop'>()` narrows `call`.

### Injection

`client.addInjection({ id, target, position?, component })` draws a component
at every element of the window that matches the CSS selector `target`: `before`
or `after` it, or inside it as its first (`prepend`) or last (`append`, the
default) child. The window watches its DOM: the component is mounted when a
target appears, removed when it goes away, and removed when the injection is
disposed or the extension is unloaded. `id` is unique within the extension.
The component runs in the app's own tree, so `inject`, Vuetify, the theme and
the language work; a failure shows an error card in its place and does not
affect the rest of the window.

The app marks stable places with the `data-ext-anchor` attribute
(`ANCHOR_ATTRIBUTE`); `anchorSelector('dailyPlan')` selects the "Daily plan"
screen's anchor. Any other selector depends on the app's markup, which may
change between versions.

`vue` and `vuetify` (`vuetify/components`, `vuetify/directives`) are imported as
usual in client code; the build leaves them out of the bundle and the app gives
the components its own instances, so the theme and language of the app apply
(`vuetify/styles` is dropped too).

## Commands, panels and `when`

```ts
// src/server.ts
import { defineServer, notify, openPanel } from '@dolphy-app/extension-sdk';

export const server = defineServer((s) => {
  s.registerCommand({
    id: 'acme.tools.open',
    title: { en: 'Open tools', ru: 'Открыть инструменты' },
    run: () => openPanel('acme.tools.main', { from: 'palette' }),
  });
  s.registerCommand({
    id: 'acme.tools.ping',
    title: 'Ping',
    palette: false, // reachable from the panel only
    run: () => notify('pong'),
  });
});
```

```ts
// src/client.ts
import { defineClient } from '@dolphy-app/extension-sdk';
import { usePanel } from '@dolphy-app/extension-sdk/client';
import { defineComponent, h } from 'vue';

const Main = defineComponent({
  setup() {
    const panel = usePanel();
    void panel.call('acme.tools.ping');
    return () => h('p', `${panel.panelId}: ${JSON.stringify(panel.props)}`);
  },
});

export const client = defineClient((c) => {
  c.addPanel({ id: 'acme.tools.main', title: 'Tools', component: Main });
});
```

- A command handler `run(args)` returns `notify(text)` (1–500 characters),
  `openPanel(id, props?)`, a JSON value or nothing. It has
  `EXTENSION_COMMAND_LIMITS.handlerMs` (10 s).
- Commands and panels take an optional `icon`, a name from `EXTENSION_ICONS`
  (`puzzle` by default), drawn by the app decoratively. A command also takes
  `description`, `category`, `palette` and `keybindings` (up to
  `EXTENSION_COMMAND_LIMITS.keybindingsPerCommand`).
- `client.addCommand({ id, title, run })` adds a command whose handler runs in
  the window: `run` takes no arguments and returns nothing.
- `when` on a command, a panel or a key binding is a boolean expression over
  `route`, `course.active`, `session.active`, `locale` and `theme.dark` (`==`,
  `!=`, `in ('a', 'b')`, `&&`, `||`, `!`, parentheses, single-quoted strings,
  at most 200 characters). While it is false the command is not in the palette
  and its keys do nothing and the panel's menu item is hidden; your own code
  still reaches them. A bad expression fails the registration with the position
  in the message. `parseWhen(text)` and `evaluateWhen(expr, context)` are
  exported for tests.

## Server context

`defineServer((s) => …)` — `s` has:

- `s.registerExerciseType(registration)` — `{ id, title?, specSchema,
answerSchema, project, grade, referenceAnswer? }`. The schemas are JSON Schema
  2020-12 objects; the app checks `spec` and the answer against them before the
  handlers run. `project` hides the secrets of the spec from the answer view,
  `grade` returns a `GradeResult`.
- `s.registerGradePolicy({ id, label, evaluate })` — `evaluate` returns an
  integer 1–5 or `null` ("self-assessment needed"); a failing policy falls back
  to `passAtN`.
- `s.registerSettings(definitions)` — the settings of "Settings → Extensions"
  (`boolean`, `string`, `text`, `color`, `list`, `number`, `enum`); the app draws
  the form. `s.settings.get(id)` returns the user's value or the `default`
  (an id nobody registered throws) and `s.settings.onDidChange(handler)` gets
  `{ id, value }` after a change, without a restart.
- `s.on(event, handler)` — the learning events `session.started`,
  `session.finished`, `attempt.closed`. One handler per event. Delivery is
  asynchronous, in order, at most once; a handler gets 2 s; the queue holds 100
  events per extension (the oldest are dropped with a warning in the log); a
  failure only reaches the log.
- `s.registerCommand(registration)` — see above.
- `s.schedule(registration, handler)` — runs `handler` (no arguments, at most
  `EXTENSION_SCHEDULE_LIMITS.handlerMs` = 10 s) by the local clock while the app
  runs. `{ id, every: 'daily', at: 'HH:MM' }` fires once a day,
  `{ id, every: 'hourly' }` at the start of every hour. A firing found more than
  2 minutes after its moment is skipped and never replayed; a handler still
  running from the previous firing misses the next one; a failure is only
  logged. The user can switch an extension's schedules off.
- `s.registerImporter(registration)` / `s.registerExporter(registration)` — see
  below.
- `s.storage` — `get<T>(key)`, `set(key, value)`, `delete(key)`, `keys()`: JSON
  under string keys, a private space per extension that survives restart,
  update and disabling. Ceilings (`EXTENSION_STORAGE_LIMITS`): key — 128
  characters, value — 64 KiB, 256 keys, 1 MiB in total. Exceeding one throws
  `StorageQuotaError` (`kind`, `limit`); nothing is written.
- `s.secrets` — `get(key)`, `set(key, value)`, `delete(key)`: strings encrypted
  by the system key store, a private space per extension. Ceilings
  (`EXTENSION_SECRET_LIMITS`): key — 128 characters, value — 4 KiB, 32 keys.
  Without a key store `set` and `get` of an existing key throw
  `SecretsUnavailableError`; `get` of a missing key gives `undefined` and
  `delete` works. Never log a secret.
- `s.stats` — `streak({ courseId? })` gives `{ current, longest }` in days,
  `daily({ from, to, courseId? })` one `{ date, attempts, correct, accuracy }`
  per date (`YYYY-MM-DD`, at most `EXTENSION_STATS_LIMITS.dailyDays` = 366).
  Days are local days of the user; an attempt is correct at grade 3 or higher.
  Numbers and dates only: no exercise or course ids.
- `s.notifications.show({ title, body })` — a system notification (title 1–80,
  body up to 300 characters, plain text) that names the extension. Resolves
  `true`; `false` means the system does not support notifications or the user
  switched them off for the extension. At most 3 per minute and 30 per hour:
  over the limit `show` rejects with `NotificationRateLimitError`.
- `s.library` — reads the course library: `readText` and `stat`.
- `s.logger`, `s.extensionId`.

## Importers and exporters

An importer turns a file the user picked into a new course directory; an
exporter writes a course or the learning progress to a file. The user's choice
of a file is the consent.

```ts
import {
  defineServer,
  type CourseExportInput,
  type TextImportInput,
} from '@dolphy-app/extension-sdk';

export const server = defineServer((s) => {
  s.registerImporter({
    id: 'acme.csv.import',
    title: 'CSV cards',
    accept: ['.csv'],
    input: 'text', // `bytes` hands over a Uint8Array instead
    // The tree is a course in the library layout: `course_manifest.json`,
    // `lesson_manifest.json` and `exercise_manifest.json` files plus texts
    run: (input) => {
      const { name, text } = input as TextImportInput;
      return {
        files: {
          'cards/course_manifest.json': JSON.stringify({
            id: 'cards',
            name,
            dependencies: [],
            encompassed: [],
            superseded: [],
          }),
          'cards/rows.csv': text,
        },
      };
    },
  });
  s.registerExporter({
    id: 'acme.csv.export',
    title: 'Course as JSON',
    scope: 'course', // or 'progress'
    run: (input) => {
      const { title, files } = input as CourseExportInput;
      return { filename: `${title}.json`, text: JSON.stringify(files) };
    },
  });
});
```

- An importer returns `{ files: Record<path, text> }`: at most 5000 files,
  2 MiB each, 20 MiB in all; a path is relative, uses `/`, and has no `..`,
  empty or dot-leading segment, backslash, control character, or case-only
  duplicate. An exporter returns `{ filename, text }` or `{ filename, bytes }`
  of at most 20 MiB; the file name has no path separator and is at most 120
  characters. A handler has 30 seconds.
- The app compiles the returned tree before it writes anything, shows a
  summary with diagnostics, and writes `imported/<extension id>-<file name>`
  atomically; with an error, nothing is left on disk.

## Dependencies

`dependencies: [{ id, range? }]` in `extension.json` (up to 16; `range` is
comparators separated by a space, such as `>=1.0.0 <2.0.0`) makes the extension
load only when each dependency is present, enabled, loaded and in range;
otherwise the app shows "dependencies not met" with the reason and the
extension contributes nothing. Dependencies are not installed for the user, and
extensions cannot call each other.

## Testing

`@dolphy-app/extension-sdk/testing` runs the entries in your process, on
in-memory fakes, without the host or the app.

`createTestServer(server, options?)` runs the `server` entry and resolves to a
harness:

- `registration` — what the entry registered, as the host's registrar hands it
  to the engine (`ServerRegistration`). The harness checks types and that an id
  is registered once; the host does the rest of the validation. With
  `extensionId` set, an id must be equal to it or start with `<extensionId>.`.
- `commands.run(id, args?)` → `CommandOutcome` (`none`, `notify`, `openPanel`,
  `data`); it applies the argument and result bounds of the host
  (`normalizeCommandResult`) and rejects with `invalid command result: …`.
- `events.emit(name, payload)` — delivers to the subscribed handler and awaits
  it; with no subscription the event is skipped, as in the host.
- `schedule.fire(id)` — runs the handler and resolves `true`; `false` while the
  handler of the previous firing is still running.
- `exerciseType(id)` → `project(spec)`, `grade({ spec, answer, … })` (checks the
  shape of the result), `referenceAnswer(spec)`; `gradePolicy(id).evaluate(input)`
  (an integer 1–5 or `null`); `importer(id).run(input)` and
  `exporter(id).run(input)` apply the host's rules (the `text`/`bytes` form, the
  `scope`, the sizes and `normalizeImportResult` / `normalizeExportResult`) and
  reject with `invalid import result: …` / `invalid export result: …`.
- `storage`, `secrets`, `settings`, `stats`, `notifications`, `library` — the
  fakes the entry received; `settings.set(id, value)` changes a value as the
  user does in the dialog.
- `dispose()` — runs the cleanup the entry returned.

Options: `extensionId`, `library`, `logger`, `storage`, `secrets`, `stats`,
`notifications` (objects from the helpers below) and
`settingValues` (user values by setting id, in place of the defaults; every id
must be registered by the entry). Unlike the host, a handler failure is not
swallowed but rejects the promise, and the handler timeouts are not applied.

`createTestClient(client, options?)` runs the `client` entry on a recording
context: `panels`, `injections`, `answerViews`, `markdownRenderers`, `themes`,
`commands`. Mount the components with `createApp` from `vue` in `happy-dom` and
provide `PANEL_HANDLE_KEY` / `INJECTION_HANDLE_KEY` as the app does.

```ts
const running = await createTestServer(server, { extensionId: 'acme' });
await running.events.emit('attempt.closed', {
  exerciseId: 'e',
  courseId: 'c',
  lessonId: 'l',
  grade: 4,
  outcome: 'passed',
  source: 'runner',
  at: Date.now(),
});
expect(await running.storage.get('last-grade')).toBe(4);
```

The fakes are exported too: `createMemoryStorage()` (same ceilings and
`StorageQuotaError`), `createMemorySecrets({ available? })` (`setAvailable(false)`
imitates a missing key store), `createMemorySettings(definitions?, values?)`
(`set`, `register`), `createMemoryStats({ attempts?, timeZone?, now? })`
(`record(attempt)`; local days, correct at grade 3 or higher),
`createMemoryNotifications({ supported?, enabled?, now? })` (`shown` lists what
the app would show), `createMemoryLibrary(files)` and
`createSchemaValidator(schema)`.

## Style sheets, images and fonts

A component can bring its own style sheets (`css`), images (`png`, `webp`,
`jpg`, `jpeg`, `svg`) and fonts (`woff2`). `dolphy-ext build` carries them in
two ways:

```ts
// inlined: a string and a small data URI, no extra file
import css from './panel.css?inline'; // style sheet as a string
import mark from './mark.png?url'; // up to 4 KiB: a data: URI
```

A string from `?inline` goes into the component (for example a `<style>`
element in its template); above 4 KiB an image becomes a file,
`assets/hero-<hash>.png`, addressed with `new URL('./hero.png', import.meta.url)`.
Use an SVG as an image (`<img>`, `url()`); it is never run as a document.

Choose the inlined form for small things and a separate file for big images and
fonts; the details, the limits and what the build refuses (unsafe SVG,
`@import`, external `url()`, a forged image header) are in the README of
`@dolphy-app/extension-tools`. A plain `import './panel.css'` is an error.
Declare the suffixes for TypeScript once:
`declare module '*?inline' { const text: string; export default text; }` and the
same for `'*?url'`.

The manifest `icon` (`"icon": "assets/icon.png"`, a square 64–512 px PNG or WebP up
to 16 KiB) is what the app shows for the extension at 32 px.

## Execution environment

Extension code runs without restrictions: files, processes, threads, native
modules and the network are available. The server part runs in the extension
host process, the client part in the app window. An uncaught handler exception
becomes a `handler-failed` error, a check becomes an `error` verdict.
`@dolphy-app/extension-sdk/testing` runs a handler in your process, without the
host: timeouts and the process boundary are not reproduced there, so try such
code in the app.
