# @dolphy-app/extension-tools

Tools for extension authors: `dolphy-ext build` builds a project into an
extension directory, `dolphy-ext validate` checks a directory with the code the
app uses to load it (`inspectExtensionDir` from `@dolphy-app/extension-host`),
`dolphy-ext catalog check|build` checks and builds extensions for the catalog
(`dolphy-app/dolphy-extensions`, see "Catalog").

## Project layout

```
<project>/
  extension.json          # source manifest (required), same format as an installed one
  src/index.ts            # all extension code: host, views, panels, markdown
  dolphy-ext.config.json  # optional
  schema/, assets/        # optional directories, copied as is
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
  nothing is written into the project. The entry imports only what the file
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

## Output

`<project>/dist-ext/<id>/` (`--out <dir>` changes the root; the extension
directory inside is always named after the `id`). The output root is a valid
discovery root and the value of `DOLPHY_DEV_EXTENSIONS`. After the build the result is checked with
`validate`; problems fail the build.

## CLI

```
dolphy-ext build [dir] [--out <dir>] [--watch]
dolphy-ext validate <dir>
dolphy-ext catalog check <extensionsDir> [--ids a,b]
            [--published-index <path>] [--max-app-version <x.y.z>]
            [--skip-github-check] [--list-rules]
dolphy-ext catalog build --src <extensionsDir> --ids a,b --out <siteDir>
            [--previous-index <path>] [--revoked <path>]
            [--source-base <url>] [--published-at <iso>]
dolphy-ext catalog build --reindex --out <siteDir>
            [--previous-index <path>] [--revoked <path>] [--published-at <iso>]
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
Running from the repository:
`pnpm -F @dolphy-app/extension-tools dolphy-ext build <dir>`.

## Catalog

The `catalog` subcommands serve the extension catalog repository
(`dolphy-app/dolphy-extensions`; the design and the chain of trust are in the
"Установка и каталог" section of `docs/design/extensions.md`). The index format,
version selection and revocation are handled by `@dolphy-app/extension-catalog`,
the same code the app uses.

### `catalog check <extensionsDir>`

Checks the sources in `<extensionsDir>/<id>/` (a `dolphy-ext` project without
`node_modules`, `dist-ext` and `.git`) against the rules below. `--ids a,b`
limits the check to the listed extensions (all directories by default);
`--published-index <path>` is the `index.json` of the published catalog for
`CHECK-012` (no file means nothing is published); `--max-app-version <x.y.z>` is
the released app version for `CHECK-016`; `--skip-github-check` turns off the
`api.github.com` request for `CHECK-006` (the API token is `GITHUB_TOKEN`);
`--list-rules` prints the rules and exits.

| Rule        | What it checks                                                                        |
| ----------- | ------------------------------------------------------------------------------------- |
| `CHECK-001` | `extension.json` is readable and passes manifest parsing                              |
| `CHECK-002` | the directory name equals the manifest `id`                                           |
| `CHECK-003` | `name`, `description` and `author` are set                                            |
| `CHECK-004` | `README.md` exists and is not empty                                                   |
| `CHECK-005` | `author` looks like a GitHub login                                                    |
| `CHECK-006` | `author` is an existing GitHub user (no answer — `warning`)                           |
| `CHECK-007` | `package.json` exists and parses                                                      |
| `CHECK-008` | there is a lock file (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`) |
| `CHECK-009` | no install or publish lifecycle scripts (`postinstall`, `prepare`…)                   |
| `CHECK-010` | dependencies come from the registry only (no git, http, file, link, workspace)        |
| `CHECK-011` | `name` in `package.json` does not take someone else's scope (`warning`)               |
| `CHECK-012` | the version is strictly greater than the published one                                |
| `CHECK-013` | at most 200 files and 5 MB of sources, no file over 1 MB                              |
| `CHECK-014` | no symbolic links                                                                     |
| `CHECK-015` | no executable files (`.exe`, `.dll`, `.so`, `.dylib`, `.node`, `.sh`, `.bat`)         |
| `CHECK-016` | `minAppVersion` is not newer than `--max-app-version`                                 |

The rules are data in code (`src/catalog/rules.ts`, the `RULES` table); the
semantic review against `rules/rules.json` of the catalog repository is a
separate step, not the CLI.

### `catalog build`

`--src <extensionsDir> --ids a,b --out <siteDir>`: for each id it builds the
project with the same code as `dolphy-ext build`, adds `README.md` (required),
computes the `size` and `sha256` of the files and puts the version into
`<siteDir>/extensions/<id>/<version>/`, then updates `<siteDir>/index.json` (an
extension keeps at most its 5 latest versions, newest first). The manifest must
contain `name`, `description` and `author`. A version is published once:
building the same number with different content is an error. Version files are
`json`, `js`, `mjs`, `md`, `txt` with safe names only, at most 50 files and
10 MB. Any error leaves `<siteDir>` untouched.

- `--previous-index <path>` — the source index (`<out>/index.json` by default);
- `--revoked <path>` — a JSON array of `{ id, versions, reason }` (without the
  flag the list from the source index is used);
- `--source-base <url>` — the base of the `source` field (by default the
  `extensions` tree of `dolphy-app/dolphy-extensions`);
- `--published-at <iso>` — `publishedAt` of the new versions (now by default).

`catalog build --reindex --out <siteDir>` replaces only `revoked` and
`generatedAt` in the existing index (extension entries do not change; `--src`
and `--ids` are not needed): this is how a version revocation is published
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
