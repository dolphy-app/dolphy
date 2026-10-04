# @dolphy-app/extension-tools

Tools for extension authors: `dolphy-ext build` builds a project into an
extension directory, `dolphy-ext validate` checks a directory with the code the
app uses to load it (`inspectExtensionDir` from `@dolphy-app/extension-host`),
`dolphy-ext lint` checks a project before a pull request,
`dolphy-ext catalog check|build` checks and builds extensions for the catalog
(`dolphy-app/dolphy-extensions`, see "Catalog").

## Project layout

```
<project>/
  extension.json          # source manifest (required), same format as an installed one
  src/index.ts            # all extension code: host, views, panels, markdown
  dolphy-ext.config.json  # optional
  schema/, assets/        # optional directories, copied as is (assets/ is checked, see "Style sheets, images and fonts")
  locales/                # optional ru.json, en.json: texts for %key% labels (see "Translations")
```

`src/index.ts` has named exports; the build lays them out into the files the
manifest names (`main`, `renderer`, `module`):

| Export     | Value                                        | Output file                                |
| ---------- | -------------------------------------------- | ------------------------------------------ |
| `host`     | `defineExtension({ … })`                     | `main` (`main.mjs`, Node bundle)           |
| `views`    | exercise type id → `defineAnswerView(mount)` | the type's `renderer` (`view.mjs`)         |
| `panels`   | panel id → `defineExtensionPanel({ mount })` | the panel's `module` (`panel.mjs`)         |
| `markdown` | language → `defineMarkdownRenderer(render)`  | the renderer's `renderer` (`markdown.mjs`) |

```ts
import {
  defineAnswerView,
  defineExtension,
  defineExtensionPanel,
} from '@dolphy-app/extension-sdk';

export const host = defineExtension({ commands: { 'acme.open': () => null } });
export const views = {
  'acme.echo': defineAnswerView((api) => ({ update() {} })),
};
export const panels = { 'acme.panel': defineExtensionPanel({ mount() {} }) };
```

- Each output file is built from a virtual entry generated from the manifest;
  nothing is written into the project but `.dolphy/ids.d.ts` (see "Typed
  ids"). The entry imports only what the file
  needs from `src/index.ts`, so host code never reaches browser files and view,
  panel and renderer code never reaches `main.mjs`. The SDK `define…` functions
  are side-effect free, which is what lets the bundler drop the rest; keep the
  top level of `src/index.ts` (and of the modules it imports) to declarations.
  A library imported by host code needs `"sideEffects": false` in its
  `package.json` (or a list of the files that do have effects), otherwise its
  top level counts as code with effects and ends up in browser files.
- The entry of a browser file registers the answer elements (the tag comes from
  the manifest `element`, by default `<id with dots as dashes>-answer`) and
  exports the panel or renderer module. Panels and languages that share one
  file are served by that file, dispatching by `ctx.panelId` and by the block
  language.
- Checks against the manifest, on every build and every rebuild: each declared
  exercise type, panel and language needs a key in `views`, `panels` and
  `markdown`; a key the manifest does not declare is an error naming the key
  and the file; a manifest with `main` needs `host`. The keys are read from the
  source statically (an object literal, also through a local constant or a
  re-export from your own files); author code is never executed by the build.
- A Node module (`node:*`, a builtin) or an `external` package from
  `dolphy-ext.config.json` that is still imported by a browser file after the
  host code is dropped is a build error naming the file and the module.
- A manifest without code (only `themes`, `settings`, or `markdownRenderers`
  with `main: null`) builds without `host`; a theme needs no `src` directory at
  all. Commands (`contributes.commands`) are run by extension code, so they
  need `main` and `host`.
- No `src/index.ts` in an extension with code is an error with the migration
  steps from the old layout (`src/main.ts`, `src/view.ts`, `src/panel.ts`,
  `src/markdown.ts`), which is no longer supported.
- Output file names come from the manifest (`main`, `renderer`, `module`), for
  example `./ui/screen.js` produces `ui/screen.js`. Every file is
  self-contained: no shared chunks.
- Node bundles: ES module, target `node22`, not minified; only Node builtins and
  `external` packages stay external. Browser bundles: `es2022`, nothing
  external.
- `dolphy-ext.config.json`:
  `{ "nodeEntries": { "worker.mjs": "src/worker.ts" }, "external": ["better-sqlite3"] }` —
  additional Node entries (output file → source), built as they are, and
  external packages.
- Schema files the manifest references are copied keeping their relative path
  (except those already under `schema/` or `assets/`). `extension.json` is
  copied byte for byte; the normalised form is not written.

## Typed ids

`dolphy-ext types [dir]` writes `<dir>/.dolphy/ids.d.ts` from `extension.json`
alone: nothing of your code is run and no network is used. Every
`dolphy-ext build` and every `--watch` rebuild after `extension.json` changes
does the same. The file augments `ExtensionIds` of
`@dolphy-app/extension-sdk`, so the SDK knows the ids the manifest declares:

```ts
declare module '@dolphy-app/extension-sdk' {
  interface ExtensionIds {
    exerciseTypes: 'acme.echo';
    gradePolicies: never;
    commands: 'acme.open' | 'acme.close';
    events: 'attempt.closed';
    panels: never;
    markdownLanguages: never;
    settings: { 'acme.goal': number; 'acme.mode': 'fast' | 'slow' };
  }
}
```

A setting is typed by its definition: `boolean`, `string` (also for `text` and
`color`), `string[]` for `list`, `number`, or the union of the `enum` option
values. The output is deterministic and the file is
not rewritten when its content is unchanged, so a watcher on the project does
not loop. Include it in `tsconfig.json` as `".dolphy/ids.d.ts"` (a bare
`.dolphy` entry is skipped by TypeScript because it is a hidden directory) and
keep `.dolphy` out of git; it is never part of `dist-ext` or of a catalog
source check. What the SDK does with the ids is described in the README of
`@dolphy-app/extension-sdk`, "Typed ids".

## Style sheets, images and fonts

An extension can ship style sheets (`css`), images (`png`, `webp`, `jpg`, `jpeg`,
`svg`) and fonts (`woff2`). Two ways to carry a file, and when to choose which:

- **Inlined into the code.** `import css from './panel.css?inline'` gives the
  style sheet as a string; `import logo from './logo.png?url'` and
  `new URL('./logo.png', import.meta.url)` give a `data:` URI for a file up to
  4 KiB. Choose this for small things: one file to publish, nothing to address
  at run time, and a style sheet string works in any frame. `url()` inside an
  `?inline` style sheet is inlined too (a relative address means nothing in a
  string).
- **A separate file.** The same `?url` and `new URL(…)` forms write an image or
  a font above 4 KiB to `assets/<name>-<hash>.<ext>` of the output and return an
  address relative to the module (`new URL('assets/logo-3f2a9c1d.png',
import.meta.url)`). The name follows the content, so rebuilding the same
  sources writes the same file, and `catalog build` lists it with its `sha256`
  like any other. Files you put into `assets/` yourself are copied as they are
  and are reached the same way, with `new URL('assets/logo.png',
import.meta.url)`. Choose this for big images and fonts and for files you
  want to fetch lazily.

A plain `import './panel.css'` fails the build: a bundle cannot carry a
side-effect style sheet. Declare the import suffixes once for TypeScript, for
example in `src/env.d.ts`:

```ts
declare module '*?inline' {
  const text: string;
  export default text;
}
declare module '*?url' {
  const url: string;
  export default url;
}
```

Put `new URL(…)` inside the function that uses it: a module-level expression
stays in the host bundle too, which then writes the same asset file.

Limits (also those of `catalog check`): `css` up to 256 KiB, `svg` up to 64 KiB,
raster images up to 512 KiB each and at most 4096×4096 pixels, `woff2` up to
1 MiB, extensions in lower case. The build checks every such file in the output,
for the extension, the signature (PNG, JPEG, WebP, WOFF2), the size, the pixels
and the content, and fails with the file name and the reason:

- an SVG is accepted only from an allow-list: a well-formed XML document with an
  `svg` root and `xmlns`, known elements and attributes, without `script`,
  `foreignObject`, animation, `on*` attributes, `DOCTYPE`, entities, `href` /
  `xlink:href` other than `#id` and `data:image/png|jpeg|webp`, and `url()` other
  than `#id` and `data:image/png|jpeg|webp`. Clean an exported file (for
  example with SVGO) if the build names an element or an attribute;
- a style sheet has no `@import`, `expression(`, `src()`, string URLs in
  `image-set()`, and its `url()` points only to `data:image`, `data:font`, `#id` or a
  relative path inside the extension.

### Icon

`"icon": "assets/icon.png"` in `extension.json` is a `.png` or `.webp` file inside
the extension: square, 64 to 512 pixels, up to 16 KiB. It is copied into the
build wherever it lies; the app shows it at 32 px in the installed list, the
catalog and the install dialog. SVG icons are not accepted.

The app draws the icon on the surface of the current theme, without a backing
of its own, and keeps the aspect ratio. Give it an opaque background (a
rounded square is the usual shape): a transparent icon with a dark or a light
glyph disappears on a theme of the opposite brightness. A 64 px file is sharp
at the 2x scale of a typical high-density display; a bigger one is scaled down.

### Tags

`"tags": ["theme", "interface"]` in `extension.json` groups the extension in the
catalog filters: up to 5 unique values of `learning`, `language`, `content`,
`theme`, `interface`, `productivity` and `developer`. An unknown, a repeated
or a sixth tag is a manifest error (`tags.N: tag must be one of: …`) reported
by `validate`, `build` and `catalog check` (`CHECK-001`). Without `tags` the app
derives them from the contributions; an explicit list replaces the derived one.

## Translations

A label of the manifest can be `%key%` (the whole string; the key is
`[A-Za-z0-9_.-]{1,64}`): the app takes the text from `locales/<language>.json`
(`ru`, `en`), a flat object of strings (a file is at most 64 KiB, 500 keys, a
value at most 500 characters). The fields are `name`, `description`, and for
contributions `label`/`title`/`description`/`category`, a setting's `group` and
the labels of its `enum` options. The window picks the text of the interface
language, then `en`, then shows the `%key%` as it is; the catalog always shows
`en`. The `%key%` itself is still limited by the length of its field.

`locales/` is copied into the built extension. `dolphy-ext validate` (and
`build`, which runs it) and `catalog check` (`CHECK-026`):

- require `locales/en.json` when the manifest has any `%key%`;
- fail for a key that `en` lacks, for a text (in any language) that breaks the
  limit of its field, and for a file that is not valid JSON or not a flat
  object of strings within the limits;
- warn about a key of a file that the manifest does not use and about a file in
  `locales/` that is not `ru.json` or `en.json`.

`name` and `description` are judged in English by the other checks (`CHECK-003`,
`CHECK-019`, `lint`), and `catalog build` writes the English `name`,
`description` and `titles` into the index. The published `extension.json` keeps
the `%key%` strings.

## Output

`<project>/dist-ext/<id>/` (`--out <dir>` changes the root; the extension
directory inside is always named after the `id`). The output root is a valid
discovery root and the value of `DOLPHY_DEV_EXTENSIONS`. After the build the result is checked with
`validate`; problems fail the build.

## CLI

```
dolphy-ext build [dir] [--out <dir>] [--watch]
dolphy-ext types [dir]
dolphy-ext validate <dir>
dolphy-ext lint [dir] [--built <dir>]
dolphy-ext dev [dir] [--app <path>]
dolphy-ext catalog check <extensionsDir> [--ids a,b]
            [--published-index <path>] [--deprecated <path>]
            [--max-app-version <x.y.z>]
            [--built <siteDir>] [--skip-github-check] [--list-rules]
dolphy-ext catalog build --src <extensionsDir> --ids a,b --out <siteDir>
            [--previous-index <path>] [--revoked <path>]
            [--deprecated <path>] [--source-base <url>] [--published-at <iso>]
dolphy-ext catalog build --reindex --out <siteDir>
            [--previous-index <path>] [--revoked <path>]
            [--deprecated <path>] [--published-at <iso>]
dolphy-ext --help
```

Exit codes: 0 — success, 1 — build or check problems (for `catalog check`, at
least one `error` finding; `warning` does not change the code), 2 — bad
arguments (`catalog` also has `nothing to reindex`: no source index).
`build`, `validate` and `catalog build` problems are printed to stderr as
`error <id-or-directory>: <message>`, the summary goes to stdout
(`built <id> -> <dir> (N files)` / `<dir>: ok` /
`published <id>@<version> (N files, M bytes)`). `catalog check` findings go to
stdout, one line `error|warning <id> <RULE-ID> <field>: <message>`; a clean
check prints nothing.

`--watch` rebuilds the affected files when `src/index.ts` (or anything it
imports) changes and reloads everything when `extension.json` changes. A burst
of changes is reported once per rebuild: `rebuilt main.mjs, view.mjs`; an error
is printed once per distinct reason with the output files and exports it
affects (`error <id>: failed to bundle main.mjs (host from src/index.ts), …`).
Schemas and `assets/` are copied at the start and after a manifest change.
`extension.json` changes also rewrite `.dolphy/ids.d.ts` (only when its content
changes).
`--watch` bundles carry inline source maps (`//# sourceMappingURL=data:…`), so
DevTools show your TypeScript in views, panels and renderers; the Node bundle
`main.mjs` carries one too, but the app does not enable source maps for the
extension process, so stack traces in the log point at `main.mjs`. A plain
`build` and `catalog build` never write source maps (`catalog check` rejects
them, `CHECK-025`).
Running from the repository:
`pnpm -F @dolphy-app/extension-tools dolphy-ext build <dir>`.

### `dev [dir] [--app <path>]`

Starts a `--watch` build of the project in `dir` (default: the current
directory) and the installed Dolphy app with
`DOLPHY_DEV_EXTENSIONS=<dir>/dist-ext`, so the app lists the extension (origin
`dev`) and applies every rebuild without a restart. Ctrl+C stops the build and
the app, exit code 0. The app is, in this order: `--app`, the `DOLPHY_APP`
environment variable, the standard place of the platform (macOS
`/Applications/Dolphy.app`, then `~/Applications/Dolphy.app`; Windows
`%LOCALAPPDATA%\Programs\Dolphy\Dolphy.exe`; Linux the newest
`~/Applications/Dolphy-Linux-*.AppImage`). `--app` takes a macOS `.app` bundle
or an executable. No app found is exit code 2 with the places that were looked
at; the path is printed when the app starts. The app has a single instance: if
it quits within 5 seconds the command prints "Dolphy is probably already
running: quit it and run again" and exits with code 1. In the app, `F12`,
`Cmd+Alt+I` (macOS) and `Ctrl+Shift+I` toggle DevTools while
`DOLPHY_DEV_EXTENSIONS` is set.

## Catalog

The `catalog` subcommands serve the extension catalog repository
(`dolphy-app/dolphy-extensions`; the design and the chain of trust are in the
"Установка и каталог" section of `docs/design/extensions.md`). The index format,
version selection and revocation are handled by `@dolphy-app/extension-catalog`,
the same code the app uses.

### `lint [dir]`

Checks the project in `dir` (default: the current directory) the way the catalog
will, before you open a pull request: `name`, `description` (at least 20
characters), `author` and `tags` of `extension.json` (warnings), `README.md`
(missing or empty is an `error`, exit code 1) and the built code
(`CHECK-022`…`CHECK-025`, always warnings). The project is built into a
temporary directory; `--built <dir>` checks an existing built extension
directory instead. Output lines are those of `catalog check`
(`warning <id> <RULE-ID> <field>: <message>`); `LINT-001` is `tags` not set.
No output and code 0 means no findings.

### `catalog check <extensionsDir>`

Checks the sources in `<extensionsDir>/<id>/` (a `dolphy-ext` project without
`node_modules`, `dist-ext`, `.dolphy` and `.git`) against the rules below. `--ids a,b`
limits the check to the listed extensions (all directories by default);
`--published-index <path>` is the `index.v2.json` of the published catalog for
`CHECK-012` (no file means nothing is published); `--max-app-version <x.y.z>` is
the released app version for `CHECK-016`; `--skip-github-check` turns off the
`api.github.com` request for `CHECK-006` (the API token is `GITHUB_TOKEN`);
`--built <siteDir>` is the output of `catalog build`: the built version is read
from `<siteDir>/extensions/<id>/<version>/` for `CHECK-022`…`CHECK-025`, which
are silent without the flag (the source tree has no bundle, so run `check` a
second time after `catalog build`); a missing built version is one `warning`.
`CHECK-021` needs `--published-index`. `--deprecated <path>` checks the form of
`deprecated.json` (see `catalog build`) and, together with `--published-index`,
that every alternative exists in the published index; its findings are printed
as `error <id> deprecated <field>: <message>` (a file that cannot be read or
parsed is one finding under the file name). `--list-rules` prints the rules and exits.

The bundle rules are heuristics over the whole bundle, dependencies included
(a validator library may legitimately use `new Function`), so they only
warn and the reviewer decides. `CHECK-023` fires on a file of 20 KiB or more
with an average line longer than 500 characters, or on 20 distinct identifiers
of the form `_0x1a2b`. `CHECK-024` ignores `www.w3.org` XML namespaces. A source
map is an `error`: the catalog builds without maps.

| Rule        | What it checks                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `CHECK-001` | `extension.json` is readable and passes manifest parsing                                         |
| `CHECK-002` | the directory name equals the manifest `id`                                                      |
| `CHECK-003` | `name`, `description` and `author` are set                                                       |
| `CHECK-004` | `README.md` exists and is not empty                                                              |
| `CHECK-005` | `author` looks like a GitHub login                                                               |
| `CHECK-006` | `author` is an existing GitHub user (no answer — `warning`)                                      |
| `CHECK-007` | `package.json` exists and parses                                                                 |
| `CHECK-008` | there is a lock file (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`)            |
| `CHECK-009` | no install or publish lifecycle scripts (`postinstall`, `prepare`…)                              |
| `CHECK-010` | dependencies come from the registry only (no git, http, file, link, workspace)                   |
| `CHECK-011` | `name` in `package.json` does not take someone else's scope (`warning`)                          |
| `CHECK-012` | the version is strictly greater than the published one                                           |
| `CHECK-013` | at most 200 files and 5 MB of sources, no file over 1 MB                                         |
| `CHECK-014` | no symbolic links                                                                                |
| `CHECK-015` | no executable files (`.exe`, `.dll`, `.so`, `.dylib`, `.node`, `.sh`, `.bat`)                    |
| `CHECK-016` | `minAppVersion` is not newer than `--max-app-version`                                            |
| `CHECK-017` | files in `assets/` match their type: signature, size, pixels, safe SVG and CSS                   |
| `CHECK-018` | `icon` is a square 64–512 px PNG or WebP file up to 16 KiB                                       |
| `CHECK-019` | `description` is at least 20 characters (`warning`)                                              |
| `CHECK-020` | every `permissions` entry is mentioned in `README.md` (`warning`)                                |
| `CHECK-021` | the id is not already published under another `author` (any case): first publisher owns the id   |
| `CHECK-022` | built code has no `eval(` or `new Function(` (`warning`, needs `--built`)                        |
| `CHECK-023` | built code does not look obfuscated (`warning`, needs `--built`)                                 |
| `CHECK-024` | built code has no `http(s)://` URL without the `network` permission (`warning`, needs `--built`) |
| `CHECK-025` | built code has no embedded source map (needs `--built`)                                          |
| `CHECK-026` | `locales/*.json`: `en` is complete, texts fit their fields, files are valid (see "Translations") |
| `CHECK-030` | `CHANGELOG.md` (optional) is at most 64 KiB of UTF-8 without NUL; no `## <version>` section for the current version is a `warning` |

The rules are data in code (`src/catalog/rules.ts`, the `RULES` table); the
semantic review against `rules/rules.json` of the catalog repository is a
separate step, not the CLI.

### `catalog build`

`--src <extensionsDir> --ids a,b --out <siteDir>`: for each id it builds the
project with the same code as `dolphy-ext build`, adds `README.md` (required),
computes the `size` and `sha256` of the files and puts the version into
`<siteDir>/extensions/<id>/<version>/`, then updates two index files (an extension
keeps at most its 5 latest versions, newest first). The manifest must contain
`name`, `description` and `author`. A version is published once: building the
same number with different content is an error. Version files are `json`, `js`,
`mjs`, `md`, `txt`, `css`, `svg`, `png`, `webp`, `jpg`, `jpeg`, `woff2` with safe names
only, at most 100 files and 10 MB; each asset passes the checks of "Style sheets,
images and fonts" and the icon travels in the index as a `data:` URI. Any error
leaves `<siteDir>` untouched.

The build also writes what the catalog shows next to the identifiers. The entry
gets `titles`: the `label` (themes, grade policies, settings) or `title`
(exercise types and markdown renderers when they have one, commands, panels)
of every contribution of the newest manifest, by contribution
point; points without contributions are omitted, and so is the whole key when
nothing has a title. The version record gets `tags` from the manifest of that
version (omitted when empty). Rebuilding without a version bump refreshes the
titles.

A `CHANGELOG.md` next to `README.md` is optional. When the project has one,
the build copies it into the version (it is listed in `files` with its size and
`sha256`), so the app shows "What's new" from it; write it as an ordinary
changelog with `## 1.2.0`, `## [1.2.0] - 2026-10-01` or `## v1.2.0` headings
(`CHECK-030`). A `CHANGELOG.md` over 64 KiB, not UTF-8 or with NUL fails the build.

One file is published: `index.v2.json` (`schemaVersion: 2`). Every version of
an extension is in it, whatever file types, permissions, `icon`, `tags` and
contribution points it uses. The app reads it next to the catalog address; the
address (`catalogUrl`) stays the identity of installed extensions. No
`index.json` is written.

- `--previous-index <path>` — the source index (`<out>/index.v2.json` by default);
- `--revoked <path>` — a JSON array of `{ id, versions, reason }` (without the
  flag the list from the source index is used);
- `--deprecated <path>` — `deprecated.json`, a JSON array of
  `{ id, versions?, reason, alternatives }` (`versions` is a range as in
  `revoked.json`, no key means every version; `reason` is 1–200 characters;
  up to 3 `alternatives`, ids). The file is authoritative: each listed entry
  gets `deprecated: { versions | null, reason, alternatives }`, entries
  that are no longer listed lose the key. Without the flag the deprecations of
  the source index stay. A repeated `id`, an `id` that is not in the index, an
  alternative that is not in the index, a bad range or an unreadable file fail
  the build and nothing is written. Deprecation is a warning shown by the app,
  not a revocation: the extension can still be installed;
- `--source-base <url>` — the base of the `source` field (by default the
  `extensions` tree of `dolphy-app/dolphy-extensions`);
- `--published-at <iso>` — `publishedAt` of the new versions (now by default).

`catalog build --reindex --out <siteDir>` replaces only `revoked`, `deprecated`
and `generatedAt` in the index (extension entries do not change; `--src` and
`--ids` are not needed): this is how a version revocation is published
without a new build.

A local catalog for the app:
`dolphy-ext catalog build --src <src> --ids <id> --out <site>`, any static
server over `<site>` and
`DOLPHY_EXTENSION_CATALOG_URL=http://localhost:<port>/index.json pnpm dev`.

The published `@dolphy-app/extension-tools` package contains only the CLI
(`bin` `dolphy-ext`) and no library entry; the API below is for the repository.

## API

```ts
import {
  buildExtension,
  generateTypes,
  watchExtension,
  validateExtension,
} from '@dolphy-app/extension-tools';

const { id, dir, files } = await buildExtension({ root, outDir });
const handle = await watchExtension({ root, logger }); // handle.close()
const { ok, problems, warnings } = await validateExtension(dir);
const { file, changed } = await generateTypes({ root }); // .dolphy/ids.d.ts
```

Build errors are `BuildError` (its `message` matches the text the app prints
for the same manifest).

The examples in the "Точки вклада", "Права и изоляция" and "Как написать
расширение" sections of `docs/design/extensions.md` are built and checked by
`test/docs-contributions.test.ts` (a theme is a project of one `extension.json`;
a markdown renderer or a grade policy comes with one `src/index.ts`).

## Permissions

`permissions` in `extension.json` is parsed by the same `parseManifest` as in the
app: `dolphy-ext validate` (and the check at the end of `dolphy-ext build`)
rejects an unknown name (`permissions.0: …`) and a duplicate
(`duplicate permission '…'`). The valid names are `EXTENSION_PERMISSIONS` from
`@dolphy-app/extension-api`. A manifest example with permissions is in
`docs/design/extensions.md`, "Права и изоляция"; it is checked by
`test/docs-contributions.test.ts` together with the "Точки вклада" examples.

The `settings` points (settings the user changes in the app) and `events`
(subscription to learning events) are checked by the same `parseManifest`. An
extension with `contributes.events` must declare the `learning.events`
permission, otherwise `validate` and `build` reject the manifest.
`ctx.storage` needs no permission. `dolphy-ext catalog build` writes
`contributes.settings` and `contributes.events` into the index entry only when
they are not empty, and `learning.events` goes into the `permissions` of the
version.
