# Packages

The libraries behind [Dolphy](../README.md): the learning engine, its storage and RPC layers, and the extension platform. Packages marked **npm** are published to [npmjs](https://www.npmjs.com/org/dolphy-app); the rest are internal to the monorepo.

## Learning engine

| Package                         | What it does                                                       |
| ------------------------------- | ------------------------------------------------------------------ |
| `@dolphy-app/engine`            | course graph, scheduler, placement test, planning, journal merging |
| `@dolphy-app/engine-contract`   | the typed API between the app window and the engine                |
| `@dolphy-app/engine-rpc`        | RPC transport for that contract                                    |
| `@dolphy-app/engine-sqlite`     | journal, settings and extension data in a single SQLite file       |
| `@dolphy-app/engine-git`        | fetch courses from a Git repository                                |
| `@dolphy-app/engine-sql-runner` | run learners' SQL answers in isolated worker processes             |
| `@dolphy-app/keybindings`       | keybinding registry and `when` clauses, **npm**                    |
| `@dolphy-app/ui`                | shared Vue components                                              |
| `@dolphy-app/testkit`           | fakes and builders for tests                                       |

## Extensions

| Package                         | What it does                                                             |
| ------------------------------- | ------------------------------------------------------------------------ |
| `@dolphy-app/extension-api`     | the public extension API and manifest, **npm**                           |
| `@dolphy-app/extension-sdk`     | helpers for writing extensions, **npm**                                  |
| `@dolphy-app/extension-tools`   | `dolphy-ext` CLI: build, validate and check catalog submissions, **npm** |
| `@dolphy-app/create-extension`  | project generator for new extensions, **npm**                            |
| `@dolphy-app/extension-ui`      | UI kit for extension panels and answer views                             |
| `@dolphy-app/extension-host`    | the process that runs extensions                                         |
| `@dolphy-app/extension-catalog` | catalog index format and version resolution                              |
| `@dolphy-app/extension-install` | download, verify and install extensions from the catalog                 |
| `@dolphy-app/ext-choice`        | built-in extension: multiple choice exercises                            |
| `@dolphy-app/ext-js`            | built-in extension: JavaScript exercises checked by running tests        |
| `@dolphy-app/ext-math`          | built-in extension: math in Markdown                                     |
| `@dolphy-app/ext-sql`           | built-in extension: SQL exercises checked by running queries             |

Package layout, design notes, publishing and test strategy: [ARCHITECTURE.md](ARCHITECTURE.md).
