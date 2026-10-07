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
  extension.json          # source manifest (required), identity and metadata only
  src/index.ts            # all extension code: the `server` and `client` exports
  dolphy-ext.config.json  # optional
  assets/                 # optional, copied as is (checked, see "Style sheets, images and fonts")
```

`extension.json` holds identity and publication metadata (`id`, `version`,
`apiVersion`, `name`, `description`, `author`, `platforms`, `minAppVersion`,
`icon`, `tags`, `dependencies`). It declares no contributions: the extension
registers them by code. `main` and `client` of the source manifest are not
needed; the build writes them into the built manifest.

`src/index.ts` has two optional named exports:

| Export   | Value                           | Output file                               |
| -------- | ------------------------------- | ----------------------------------------- |
| `server` | `(context: ServerContext) => …` | `main.mjs` (Node bundle, extension host)  |
| `client` | `(context: ClientContext) => …` | `client.mjs` (browser bundle, app window) |

At least one of them must exist. `server` registers exercise types, grade
policies, commands, schedules, importers, exporters, settings and event
handlers; `client` adds panels, slot components, answer views, markdown
renderers, themes and client commands (see `@dolphy-app/extension-api`).

```ts
import { defineClient, defineServer } from '@dolphy-app/extension-sdk';

export const server = defineServer((s) => {
  s.registerCommand({ id: 'acme.open', title: 'Open', run: () => undefined });
});
export const client = defineClient((c) => {
  c.addPanel({ id: 'acme.panel', title: 'Acme', component: Screen });
});
```

- Each output file is built from a virtual entry that re-exports one export of
  `src/index.ts` under the same name (`main.mjs` exports `server`, `client.mjs` exports `client`); nothing is written into the project. Which
  files are built follows the exports, found statically (an exported constant,
  function or specifier, also through a relative re-export); author code is never
  executed by the build. The built manifest gets `"main": "./main.mjs"` when
  `server` exists and `"client": "./client.mjs"` when `client` exists, `null`
  otherwise; the other fields are those of the source manifest.
- The client file is built with `vue` and `vuetify` left out (the app gives its
  own instances through `globalThis.__dolphy`), so a bundle is a few KiB;
  `vuetify/styles` is dropped too. The server file keeps them out as well: a
  component defined at the top level of `src/index.ts` does not pull Vue into
  `main.mjs`. Tree shaking separates the parts, so keep the top level of
  `src/index.ts` (and of the modules it imports) to declarations. A library
  imported by one part needs `"sideEffects": false` in its `package.json` (or a
  list of the files that do have effects), otherwise its top level counts as code
  with effects and ends up in the other file.
- Boundaries, checked on every build and rebuild, with the file and the module in
  the message: a Node module (`node:*`, a builtin) or an `external` package from
  `dolphy-ext.config.json` that is still imported by `client.mjs` is an error;
  `vue` or `vuetify*` still imported by `main.mjs` is an error.
- No `src/index.ts`, or one that exports neither `server` nor `client`, is an
  error.
- Node bundle: ES module, target `node22`, not minified; only Node builtins and
  `external` packages stay external. Browser bundle: `es2022`, with `vue` and
  `vuetify` external. Every file is self-contained: no shared chunks.
- `dolphy-ext.config.json`:
  `{ "nodeEntries": { "worker.mjs": "src/worker.ts" }, "external": ["better-sqlite3"] }` —
  additional Node entries (output file → source), built as they are (only with a
  `server` export), and external packages.
- `assets/` and the icon are copied keeping their relative path.

## Style sheets, images and fonts

An extension can ship style sheets (`css`), images (`png`, `webp`, `jpg`, `jpeg`,
`svg`) and fonts (`woff2`). Two ways to carry a file, and when to choose which:

- **Inlined into the code.** `import css from './panel.css?inline'` gives the
  style sheet as a string; `import logo from './logo.png?url'` and
  `new URL('./logo.png', import.meta.url)` give a `data:` URI for a file up to
  4 KiB. Choose this for small things: one file to publish, nothing to address
  at run time. `url()` inside an
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
stays in the other part's bundle too, which then writes the same asset file.

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
by `validate`, `build` and `catalog check` (`CHECK-001`). Without `tags` the extension
has none in the catalog.

## Output

`<project>/dist-ext/<id>/` (`--out <dir>` changes the root; the extension
directory inside is always named after the `id`). The output root is a valid
discovery root and the value of `DOLPHY_DEV_EXTENSIONS`. After the build the result is checked with
`validate`; problems fail the build.

## CLI

```
dolphy-ext build [dir] [--out <dir>] [--watch]
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
of changes is reported once per rebuild: `rebuilt main.mjs, client.mjs`; an error
is printed once per distinct reason with the output files and exports it
affects (`error <id>: failed to bundle main.mjs (server from src/index.ts), …`).
`assets/` is copied at the start and after a manifest change.
`--watch` bundles carry inline source maps (`//# sourceMappingURL=data:…`), so
DevTools show your TypeScript in the client file; the Node bundle
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
`node_modules`, `dist-ext` and `.git`) against the rules below. `--ids a,b`
limits the check to the listed extensions (all directories by default);
`--published-index <path>` is the `index.v2.json` of the published catalog for
`CHECK-012` (no file means nothing is published); `--max-app-version <x.y.z>` is
the released app version for `CHECK-016`; `--skip-github-check` turns off the
`api.github.com` request for `CHECK-006` (the API token is `GITHUB_TOKEN`);
`--built <siteDir>` is the output of `catalog build`: the built version is read
from `<siteDir>/extensions/<id>/<version>/` for `CHECK-022`…`CHECK-025` and `CHECK-031`, which
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
of the form `_0x1a2b`. A source
map is an `error`: the catalog builds without maps.

| Rule        | What it checks                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `CHECK-001` | `extension.json` is readable and passes manifest parsing                                                                           |
| `CHECK-002` | the directory name equals the manifest `id`                                                                                        |
| `CHECK-003` | `name`, `description` and `author` are set                                                                                         |
| `CHECK-004` | `README.md` exists and is not empty                                                                                                |
| `CHECK-005` | `author` looks like a GitHub login                                                                                                 |
| `CHECK-006` | `author` is an existing GitHub user (no answer — `warning`)                                                                        |
| `CHECK-007` | `package.json` exists and parses                                                                                                   |
| `CHECK-008` | there is a lock file (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`)                                              |
| `CHECK-009` | no install or publish lifecycle scripts (`postinstall`, `prepare`…)                                                                |
| `CHECK-010` | dependencies come from the registry only (no git, http, file, link, workspace)                                                     |
| `CHECK-011` | `name` in `package.json` does not take someone else's scope (`warning`)                                                            |
| `CHECK-012` | the version is strictly greater than the published one                                                                             |
| `CHECK-013` | at most 200 files and 5 MB of sources, no file over 1 MB                                                                           |
| `CHECK-014` | no symbolic links                                                                                                                  |
| `CHECK-015` | no executable files (`.exe`, `.dll`, `.so`, `.dylib`, `.node`, `.sh`, `.bat`)                                                      |
| `CHECK-016` | `minAppVersion` is not newer than `--max-app-version`                                                                              |
| `CHECK-017` | files in `assets/` match their type: signature, size, pixels, safe SVG and CSS                                                     |
| `CHECK-018` | `icon` is a square 64–512 px PNG or WebP file up to 16 KiB                                                                         |
| `CHECK-019` | `description` is at least 20 characters (`warning`)                                                                                |
| `CHECK-021` | the id is not already published under another `author` (any case): first publisher owns the id                                     |
| `CHECK-022` | built code has no `eval(` or `new Function(` (`warning`, needs `--built`)                                                          |
| `CHECK-023` | built code does not look obfuscated (`warning`, needs `--built`)                                                                   |
| `CHECK-025` | built code has no embedded source map (needs `--built`)                                                                            |
| `CHECK-031` | `main.mjs` and `client.mjs` of the built version match the `main` and `client` fields of its manifest (needs `--built`)            |
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

The version record gets `tags` from the manifest of that version (omitted when
empty); tags are only the explicit ones of the manifest.

A `CHANGELOG.md` next to `README.md` is optional. When the project has one,
the build copies it into the version (it is listed in `files` with its size and
`sha256`), so the app shows "What's new" from it; write it as an ordinary
changelog with `## 1.2.0`, `## [1.2.0] - 2026-10-01` or `## v1.2.0` headings
(`CHECK-030`). A `CHANGELOG.md` over 64 KiB, not UTF-8 or with NUL fails the build.

One file is published: `index.v2.json` (`schemaVersion: 2`). Every version of
an extension is in it, whatever file types, `icon` and `tags` it uses. The app reads it next to the catalog address; the
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
  watchExtension,
  validateExtension,
} from '@dolphy-app/extension-tools';

const { id, dir, files } = await buildExtension({ root, outDir });
const handle = await watchExtension({ root, logger }); // handle.close()
const { ok, problems } = await validateExtension(dir);
```

Build errors are `BuildError` (its `message` matches the text the app prints
for the same manifest).

The examples in the "Точки вклада" and "Как написать
расширение" sections of `docs/design/extensions.md` are built and checked by
`test/docs-contributions.test.ts`.
