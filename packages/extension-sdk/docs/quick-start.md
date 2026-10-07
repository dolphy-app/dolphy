# Quick start

This guide takes you from nothing to a working Dolphy extension: a command in
the command palette that shows a notification. It is the smallest project the
generator makes (`--template blank`); the recipes next to this file build on the
same layout:

- [Exercise type](recipe-exercise-type.md): a new kind of task with its own answer input.
- [Theme](recipe-theme.md): colors, registered by the client part.
- [Command and panel](recipe-command-panel.md): palette commands and a panel, a Vue component in the app window.
- [Events and storage](recipe-event-storage.md): react to learning events and keep data.
- [Settings](recipe-settings.md): let the user configure the extension.
- [Visibility conditions and dependencies](recipe-when-dependencies.md): show a command only where it makes sense, a widget in the daily plan, require another extension.
- [Importer and exporter](recipe-import-export.md): bring a file in as a course, write a course out.
- [Without a build](no-build.md): a hand-written `extension.json`, `main.mjs` and `client.mjs`, no TypeScript.
- [Debugging](debugging.md): where to look when something does not work.

## What you need

- Node.js 22.12 or newer and pnpm.
- The Dolphy app, to see the extension work. Everything else (build, type
  check, tests) runs without it.

## 1. Create the project

```sh
npx @dolphy-app/create-extension my-extension --id acme.hello --template blank
cd my-extension
pnpm install
```

`--id` is the extension id: lowercase letters, digits, dots and hyphens. Every
id the extension registers (commands, panels, settings…) is the extension id or
starts with it and a dot, so pick one that is yours (a publisher prefix, then a
name). Without `--id` the id is the directory name in kebab-case. The
`--template` values:

| Template        | What you get                                                  |
| --------------- | ------------------------------------------------------------- |
| `exercise`      | a task type with an answer input and a setting (the default)  |
| `theme`         | a color theme                                                 |
| `command-panel` | palette commands and a panel                                  |
| `events`        | a learning event handler, storage, commands and a panel       |
| `blank`         | one palette command                                           |

An unknown name exits with code 2 and lists the available ones.

## 2. The files

The project is two files that matter. The manifest says who the extension is,
the code says what it adds.

File `extension.json` (quick start):

```json
{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "acme.hello",
  "version": "0.1.0",
  "apiVersion": 1,
  "name": "Hello command",
  "description": "A command-palette command that shows a notification.",
  "author": "your-github-login",
  "tags": ["productivity"]
}
```

`$schema` gives editors completion and checking. `id` is the identity of the
extension in the app and the catalog; it never changes after the first release.
Replace `your-github-login` in `author` with your GitHub login before you
publish. The manifest declares no commands, panels or settings: the code
registers them. The other keys are `platforms`, `minAppVersion`, `icon` and
`dependencies`. `main` and `client` are written by the build.

File `src/index.ts` (quick start):

```ts
import { defineServer, notify } from '@dolphy-app/extension-sdk';

// runs in the extension host: every call registers a contribution
export const server = defineServer((s) => {
  s.registerCommand({
    id: 'acme.hello.hello',
    title: { en: 'Say hello', ru: 'Поздороваться' },
    run: () => notify('Hello from acme.hello!'),
  });
});
```

`src/index.ts` exports up to two entries. `server` runs in the extension host
(Node) and registers commands, exercise types, settings, event handlers,
schedules, importers and exporters; `client` runs in the app window and adds
panels, injected components, answer views, markdown renderers, themes and
client commands. This project has only `server`. The host calls it when it
loads the extension; if it throws, or does not finish in 10 seconds, the
extension shows `load-failed` in Settings → Extensions and registers nothing
(see [debugging](debugging.md)).

`notify` returns a notification to the app. A text the user sees is a
`LocalizedText`: a plain string, or `{ en, ru }` as here. An id is written in
the code and must be the extension id or start with `acme.hello.`; the host
refuses an id that is taken or does not carry the prefix.

When both entries exist, keep each in its own file and re-export them from
`src/index.ts` (the recipes do): `server` must not import `vue`, `vuetify` or a
component, `client` must not import `node:*` modules, and the build reports a
violation with the file and the rule.

File `test/index.test.ts` (quick start):

```ts
import { createTestServer } from '@dolphy-app/extension-sdk/testing';
import { expect, it } from 'vitest';
import { server } from '../src/index.ts';

it('the hello command notifies', async () => {
  const running = await createTestServer(server, { extensionId: 'acme.hello' });
  expect(await running.commands.run('acme.hello.hello')).toEqual({
    kind: 'notify',
    text: 'Hello from acme.hello!',
  });
  await running.dispose();
});
```

The test runs the command the way the host does, without the app:
`createTestServer` from `@dolphy-app/extension-sdk/testing` starts `server` on
in-memory storage, settings and library, and `running.commands.run` applies the
rules the host applies to a command result. `createTestClient` does the same for
`client` (see the [command and panel recipe](recipe-command-panel.md)).

## 3. Build, check, test

```sh
pnpm build       # dolphy-ext build: writes dist-ext/acme.hello
pnpm validate    # parses the built manifest the way the app does
pnpm lint        # metadata and bundle checks the catalog review also runs
pnpm typecheck   # tsc
pnpm test        # vitest
```

`pnpm build` turns `src/index.ts` into the files the app loads. With this
template that is `dist-ext/acme.hello/extension.json` and `main.mjs`; the built
manifest names it in `main`. A project that exports `client` also gets
`client.mjs` and the `client` key. Keep `dist-ext` out of git; the generated
`.gitignore` does it.

## 4. Try it in the app

One command builds the project in watch mode and starts the installed Dolphy
app on the result:

```sh
pnpm exec dolphy-ext dev
```

The extension appears in Settings → Extensions with the origin "Development",
and the command appears in the command palette. Press Ctrl+C to stop the build
and the app. Quit a running Dolphy first: the app has one instance, a second
start does not pick up the extension directory. Where the app is looked up and
what to do when it is not found: [debugging](debugging.md), section 3.

To run the two parts yourself, start the build in watch mode with `pnpm dev`
(`dolphy-ext build --watch`) and start Dolphy with the variable
`DOLPHY_DEV_EXTENSIONS` set to the absolute path of `dist-ext` of your project.
It adds a developer root with the highest priority.

```sh
# from a checkout of the Dolphy repository
DOLPHY_DEV_EXTENSIONS=/path/to/my-extension/dist-ext pnpm dev
```

Save a file: the build writes the new files and the app applies them without a
restart. The window does not reload; the components of extensions in
development are recreated, so their state can be lost.

The extension code runs without restrictions: files, processes, threads and the
network are available. The test helpers run a handler in your process and do not
reproduce the host (time limits, the process boundary); try such code in the
app.

## 5. Next

- Pick the recipe closest to your task and generate that template.
- Before a pull request to the extension catalog run `pnpm build`,
  `pnpm validate`, `pnpm lint`, `pnpm typecheck` and `pnpm test`: all must pass.
  The generated `.github/workflows/ci.yml` runs the same steps on every push.
- Write in `README.md` what the extension does; the catalog
  review reads it.
