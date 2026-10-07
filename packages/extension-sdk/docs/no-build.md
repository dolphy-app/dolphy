# Without a build

An extension is a directory with an `extension.json` and, if it has code, one or
two ES modules: `main.mjs` for the `server` entry and `client.mjs` for the
`client` entry. `dolphy-ext build` only produces such a directory from a
TypeScript project; you can write it by hand. You do not need TypeScript, a
`package.json` or `dolphy-ext` for that. This page shows the smallest case: one
palette command and a panel, three hand-written files. Use it for a quick
experiment or when the code is a few lines; switch to the
[quick start](quick-start.md) layout when you want types, tests and bundling.

## The files

File `extension.json` (no build):

```json
{
  "id": "acme.plain",
  "version": "0.1.0",
  "apiVersion": 1,
  "main": "./main.mjs",
  "client": "./client.mjs",
  "name": "Plain hello",
  "description": "A palette command and a panel written by hand, without a build step.",
  "author": "your-github-login",
  "tags": ["productivity"]
}
```

File `main.mjs` (no build):

```js
export const server = (s) => {
  s.registerCommand({
    id: 'acme.plain.hello',
    title: 'Say hello',
    run: () => ({ notify: `Hello from ${s.extensionId}!` }),
  });
  s.registerCommand({
    id: 'acme.plain.open',
    title: 'Open the plain panel',
    run: () => ({ openPanel: 'acme.plain.view' }),
  });
};
```

File `client.mjs` (no build):

```js
// `vue` is the app's own instance: the window gives it through globalThis.__dolphy
const { defineComponent, h } = await globalThis.__dolphy.require('vue');

export const client = (c) => {
  c.addPanel({
    id: 'acme.plain.view',
    title: 'Plain hello',
    component: defineComponent({
      setup: () => () => h('p', 'Hello from a panel'),
    }),
  });
};
```

- `main` and `client` are written in the manifest: nothing fills them in. A part
  that is left out (`null` or no key) does not exist, so an extension may have
  only `main.mjs` or only `client.mjs`. Each is a path inside the directory that
  ends with `.mjs`.
- The contract of `main.mjs` is `export const server = (s) => { … }`, the same
  function `defineServer` takes in a project; `s` is the `ServerContext`
  (`registerCommand`, `registerSettings`, `on`, `storage`, `logger`, …). The
  contract of `client.mjs` is `export const client = (c) => { … }`
  (`addPanel`, `addInjection`, `addAnswerView`, `addMarkdownRenderer`,
  `addTheme`, `addCommand`). Either may return a cleanup function. `async`
  functions work. `server` is called when the host loads the extension; if it
  throws or takes more than 10 seconds the extension shows `load-failed` and
  registers nothing.
- Without a build there is no `import 'vue'`: `client.mjs` reads `vue` (and
  `vuetify`, `vuetify/components`, `vuetify/directives`) from
  `globalThis.__dolphy.require(name)`, which resolves to the app's own instance.
  Write the components with `h` or a render function: there is no template
  compiler. `main.mjs` never needs `vue`.
- There are no helpers, so a command returns the result object itself:
  `{ notify: text }` is what `notify(text)` makes and `{ openPanel: id, props }`
  is what `openPanel(id, props)` makes. Ids are written in the code and must be
  the extension id or start with `<id>.`.
- The modules must be plain JavaScript that the app runs as it is: no
  TypeScript, no bare imports of packages (nothing is installed next to them),
  and no `node:*` imports in `client.mjs`.

## Check and try

Put the files into a directory named exactly as the extension id,
`acme.plain/` (the app takes the id from the directory name and rejects a
manifest that disagrees), and check it:

```sh
npx --package @dolphy-app/extension-tools dolphy-ext validate ./acme.plain
```

`validate` parses the manifest the way the app does, checks that `main` and
`client` are files, and exits with code 1 on a problem. To try the extension,
put the directory into a folder and start the app with `DOLPHY_DEV_EXTENSIONS`
pointing at that folder (the folder, not the extension directory: it holds one
directory per extension), or copy the directory to `<userData>/extensions/` and
restart the app. Edits to the files are picked up without a restart when you use
`DOLPHY_DEV_EXTENSIONS`.

To test the server module without the app, run its entry with the SDK helper:

```sh
npm install --save-dev @dolphy-app/extension-sdk vitest
```

<!-- fragment -->

```js
import { createTestServer } from '@dolphy-app/extension-sdk/testing';
import { server } from './main.mjs';

const running = await createTestServer(server, { extensionId: 'acme.plain' });
console.log(await running.commands.run('acme.plain.hello'));
// { kind: 'notify', text: 'Hello from acme.plain!' }
```

`createTestServer` accepts the export of the module as it is, because it has the
shape of a server entry. `createTestClient(client, { extensionId })` does the
same for `client.mjs` and lists the panels it added.

## Publishing

The extension catalog reviews a project, not a bare directory: it requires a
`package.json` with a lock file and a `README.md` that explains what the
extension does (`dolphy-ext catalog check`). A hand-written directory is for
yourself or for handing a folder to someone. To publish, generate a project with
`create-dolphy-extension` and move the code into it.
