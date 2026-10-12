# Contributing to Dolphy

Thanks for helping. Bug reports, courses, extensions and code are all welcome.

## Where things go

|                                 |                                                                   |
| ------------------------------- | ----------------------------------------------------------------- |
| A bug or an idea for the app    | an issue in this repository                                       |
| A new course                    | [dolphy-app/courses](https://github.com/dolphy-app/courses)       |
| A new extension                 | [dolphy-app/extensions](https://github.com/dolphy-app/extensions) |
| Code in the app or the packages | a pull request here, see below                                    |

## Run from source

Needs Node ≥ 22.12 and pnpm 12.9.1 (see `packageManager` in `package.json`).

```sh
pnpm install
pnpm dev:seed   # copy the sample courses (SQL, Git, HTTP, JavaScript) into the library
pnpm dev        # start the app
```

## Commands

| Command            | What it does                                   |
| ------------------ | ---------------------------------------------- |
| `pnpm dev`         | the desktop app in development mode            |
| `pnpm build`       | type-check, bundle and package the desktop app |
| `pnpm test`        | unit and property tests of every package       |
| `pnpm typecheck`   | `tsc -b` over `packages/*`                     |
| `pnpm lint`        | ESLint and Prettier checks                     |
| `pnpm fix`         | ESLint and Prettier, fixing what they can      |
| `pnpm smoke`       | end-to-end smoke test in a real Electron       |
| `pnpm screenshots` | regenerate the screenshots used in the README  |

The end-to-end suite (`pnpm -F @dolphy/desktop e2e`) runs the app in real Electron without taking your focus; details are in [apps/desktop/ARCHITECTURE.md](apps/desktop/ARCHITECTURE.md#e2e).

## Workflow

1. Branch from `develop`: `git switch -c feature/<short-kebab-name> origin/develop`. Never commit to `develop` or `main` directly.
2. Commit with [Conventional Commits](https://www.conventionalcommits.org) (`feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `perf`); the scope is a directory under `apps/` or `packages/`. A commit hook checks the message.
3. Run `pnpm fix`, then `pnpm lint` and `pnpm test`.
4. Open a pull request into `develop`. It is merged with a merge commit once CI is green.

Releases are cut from `develop` through `release-<version>` branches into `main`; versions and the changelog are generated from commit messages, so please don't edit them by hand.

## Understand the code

- [apps/desktop/ARCHITECTURE.md](apps/desktop/ARCHITECTURE.md): processes, layers, extensions, security and tests of the desktop app.
- [packages/ARCHITECTURE.md](packages/ARCHITECTURE.md): the packages, publishing and test strategy.
- `docs/` and `specs/` hold design notes, decisions and feature specs. They are written in Russian; [AGENTS.md](AGENTS.md) (also Russian) lists the repository rules for code style, UI strings and the git process.

## Public text is English

READMEs, package descriptions, commit messages, pull request titles and the changelog are written in English. Interface strings go through `vue-i18n` and are never hard-coded.
