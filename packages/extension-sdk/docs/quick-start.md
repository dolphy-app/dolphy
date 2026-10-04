# Quick start

This guide takes you from nothing to a working Dolphy extension: a command in
the command palette that shows a notification. It is the smallest project the
generator makes (`--template blank`); the recipes next to this file build on the
same layout:

- [Exercise type](recipe-exercise-type.md): a new kind of task with its own answer input.
- [Theme](recipe-theme.md): colors, no code.
- [Command and panel](recipe-command-panel.md): palette commands and a screen in an isolated frame.
- [Events and storage](recipe-event-storage.md): react to learning events and keep data.
- [Settings](recipe-settings.md): let the user configure the extension.
- [Without a build](no-build.md): a hand-written `extension.json` and `main.mjs`, no TypeScript.
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
id the extension declares (commands, panels, settings…) starts with it, so pick
one that is yours (a publisher prefix, then a name). Without `--id` the id is the
directory name in kebab-case. The `--template` values:

| Template        | What you get                                                 |
| --------------- | ------------------------------------------------------------ |
| `exercise`      | a task type with an answer input and a setting (the default) |
| `theme`         | a color theme, no code                                       |
| `command-panel` | palette commands and a panel                                 |
| `events`        | a learning event handler, storage, commands and a panel      |
| `blank`         | one palette command                                          |

An unknown name exits with code 2 and lists the available ones.

## 2. The files

The project is two files that matter. The manifest declares what the extension
adds, the code implements it.

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
  "tags": ["productivity"],
  "contributes": {
    "commands": [{ "id": "acme.hello.hello", "title": "Say hello" }]
  }
}
```

`$schema` gives editors completion and checking. `id` is the identity of the
extension in the app and the catalog; it never changes after the first release.
Replace `your-github-login` in `author` with your GitHub login before you
publish. `contributes.commands` declares the command that appears in the palette.

File `src/index.ts` (quick start):

```ts
import { defineExtension, notify } from '@dolphy-app/extension-sdk';

// extension code: runs in the extension process of the app
// the command id comes from extension.json: a misspelt id or a declared id
// without a handler fails `pnpm typecheck`
export const host = defineExtension({
  commands: {
    'acme.hello.hello': () => notify('Hello from acme.hello!'),
  },
});
```

`host` is the code that runs in the extension process of the app.
`defineExtension` takes a handler for every command the manifest declares:
`notify` returns a notification to the app. The ids are types: `pnpm typecheck`
(and every build) writes `.dolphy/ids.d.ts` from `extension.json`, so a misspelt
id, or a declared command without a handler, does not compile.

File `test/index.test.ts` (quick start):

```ts
import { loadCommands } from '@dolphy-app/extension-sdk/testing';
import { expect, it } from 'vitest';
import { host } from '../src/index.ts';

it('the hello command notifies', async () => {
  const commands = await loadCommands(host, {
    declaredCommands: ['acme.hello.hello'],
  });
  expect(await commands.run('acme.hello.hello')).toEqual({
    kind: 'notify',
    text: 'Hello from acme.hello!',
  });
  await commands.dispose();
});
```

The test runs the command the way the host does, without the app:
`@dolphy-app/extension-sdk/testing` activates `host` with in-memory storage,
settings and commands.

## 3. Build, check, test

```sh
pnpm build       # dolphy-ext build: writes dist-ext/acme.hello
pnpm validate    # parses the built manifest the way the app does
pnpm lint        # metadata and bundle checks the catalog review also runs
pnpm typecheck   # dolphy-ext types, then tsc
pnpm test        # vitest
```

`pnpm build` turns `src/index.ts` into the files the app loads. With this
template that is `dist-ext/acme.hello/extension.json` and `main.mjs`. Keep
`dist-ext` and `.dolphy` out of git; the generated `.gitignore` does it.

## 4. Try it in the app

One command builds the project in watch mode and starts the installed Dolphy
app on the result:

```sh
pnpm exec dolphy-ext dev
```

The extension appears in Settings → Extensions with the origin "development",
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
restart. The window does not reload; answer inputs of extensions in development
are recreated, so their state can be lost.

An extension that is not bundled with the app and not trusted runs in a
restricted process: what the `permissions` of the manifest do not declare is
unavailable. The test helpers do not reproduce that; try permission-dependent
code in the app.

## 5. Next

- Pick the recipe closest to your task and generate that template.
- Before a pull request to the extension catalog run `pnpm build`,
  `pnpm validate`, `pnpm lint`, `pnpm typecheck` and `pnpm test`: all must pass.
  The generated `.github/workflows/ci.yml` runs the same steps on every push.
- Write in `README.md` what the extension does and what each permission is for;
  the catalog review reads it.
