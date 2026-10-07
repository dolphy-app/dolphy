# Without a build

An extension is a directory with an `extension.json` and, if it has code, an ES
module. You do not need TypeScript, a `package.json` or `dolphy-ext` to write
one. This page shows the smallest case: one palette command and a panel, three
hand-written files. Use it for a quick experiment or when the code is a few lines; switch to
the [quick start](quick-start.md) layout when you want typed ids, tests and
bundling.

## The files

File `extension.json` (no build):

```json
{
  "id": "acme.plain",
  "version": "0.1.0",
  "apiVersion": 1,
  "name": "Plain hello",
  "description": "A palette command and a panel written by hand, without a build step.",
  "author": "your-github-login",
  "tags": ["productivity"],
  "contributes": {
    "commands": [{ "id": "acme.plain.hello", "title": "Say hello" }],
    "panels": [{ "id": "acme.plain.view", "title": "Plain hello" }]
  }
}
```

File `main.mjs` (no build):

```js
export default {
  activate(ctx) {
    ctx.commands.register('acme.plain.hello', () => ({
      notify: `Hello from ${ctx.extensionId}!`,
    }));
  },
};
```

File `panel.mjs` (no build):

```js
// `vue` is the app's own instance: the window gives it through globalThis.__dolphy
const { defineComponent, h } = await globalThis.__dolphy.require('vue');

export default {
  panels: {
    'acme.plain.view': defineComponent({
      setup: () => () => h('p', 'Hello from a panel'),
    }),
  },
};
```

- `main` is left out: for an extension with commands it defaults to `./main.mjs`,
  so the module sits next to the manifest under that name.
- `export default { activate(ctx) }` is the whole contract of the module. `ctx`
  is the same context as in the typed projects (`commands`, `settings`,
  `storage`, `events`, `logger`, `library`); `deactivate()` is optional.
- `panel.mjs` is the default module of a panel. Its default export is a table of
  Vue components by id: `{ views?, panels?, widgets?, markdown? }` (an answer
  view is `views[<exercise type id>]` in `./view.mjs`, a widget is
  `widgets[<id>]` in `./widget.mjs`, a markdown renderer is `markdown[<language>]`
  in `./markdown.mjs`). Without a build there is no `import 'vue'`: the module
  reads `vue` (and `vuetify`, `vuetify/components`, `vuetify/directives`) from
  `globalThis.__dolphy.require(name)`, which resolves to the app's own instance.
  Write the components with `h` or a render function: there is no template
  compiler.
- There are no helpers, so a command returns the result object itself:
  `{ notify: text }` is what `notify(text)` makes (the SDK helper does nothing
  more). Every id must be
  declared in the manifest, and a declared id nobody registers produces a
  warning in the log.
- The modules must be plain JavaScript that the app runs as it is: no
  TypeScript, no bare imports of packages (nothing is installed next to them).

## Check and try

Put the files into a directory named exactly as the extension id,
`acme.plain/` (the app takes the id from the directory name and rejects a
manifest that disagrees), and check it:

```sh
npx --package @dolphy-app/extension-tools dolphy-ext validate ./acme.plain
```

`validate` parses the manifest the way the app does and exits with code 1 on a
problem. To try the extension, put the directory into a folder and start the
app with `DOLPHY_DEV_EXTENSIONS` pointing at that folder (the folder, not the
extension directory: it holds one directory per extension), or copy the
directory to `<userData>/extensions/` and restart the app. Edits to the files are
picked up without a restart when you use `DOLPHY_DEV_EXTENSIONS`.

To test the module without the app, activate it with the SDK helper:

```sh
npm install --save-dev @dolphy-app/extension-sdk vitest
```

<!-- fragment -->

```js
import { loadCommands } from '@dolphy-app/extension-sdk/testing';
import extension from './main.mjs';

const commands = await loadCommands(extension, {
  declaredCommands: ['acme.plain.hello'],
});
console.log(await commands.run('acme.plain.hello'));
// { kind: 'notify', text: 'Hello from …!' }
```

`loadCommands` accepts the default export as it is, because the module has the
shape of a host module (`activate`, `deactivate`).

## Publishing

The extension catalog reviews a project, not a bare directory: it requires a
`package.json` with a lock file and a `README.md` that explains what the
extension does (`dolphy-ext catalog check`). A hand-written directory is for
yourself or for handing a folder to someone. To publish, generate a project with
`create-dolphy-extension` and move the code into it.
