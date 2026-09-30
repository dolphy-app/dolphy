# lms-platform-design

**English** · [Русский](README.ru.md)

A local adaptive learning platform: a knowledge graph, spaced repetition (FSRS), courses as Markdown in Git, and answers checked by deterministic runners (SQL). Data and progress stay on the device (SQLite, `engine.db`); there is no server. The repository holds both the system design documents and the code: the business-logic layer `engine-ts` (a TypeScript port of Trane on ts-fsrs) and a desktop app on Electron.

## Status

| Part                        | Status                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Engine (`packages/engine*`) | implemented: course loading and compilation, attempt journal, scheduler, placement diagnostic, SQL answer checking, journal merge between devices; package map in `packages/README.md` (Russian)       |
| App (`apps/desktop`)        | daily plan, course catalog and course switcher, study session (SQL runner and self-grading), settings (scheduler, library, theme, `ru`/`en` language); structure in `apps/desktop/README.md` (Russian) |
| Not done                    | knowledge graph, analytics, Vault and adding content, command palette search                                                                                                                           |

Installers (macOS `.dmg`, Windows `.exe`, Linux `.AppImage`) are built on every release and attached to [GitHub Releases](../../releases). They are unsigned, so the OS warns on first launch.

## Quick start

Requires Node ≥ 22.12 (`.nvmrc`) and pnpm 9.15.9 (the `packageManager` field).

```sh
pnpm install
pnpm dev:seed   # put the SQL course and the Git, HTTP, JavaScript courses from apps/desktop/dev-library into the library
pnpm dev        # the app in development mode
```

| Command          | What it does                                     |
| ---------------- | ------------------------------------------------ |
| `pnpm test`      | tests of all packages (`vitest`)                 |
| `pnpm typecheck` | types per package (`tsc -b`)                     |
| `pnpm lint`      | ESLint and Prettier                              |
| `pnpm build`     | build the app and an installer for this platform |
| `pnpm smoke`     | end-to-end smoke in a real Electron              |

The full command list and repository rules (style, UI, git process, releases, CI) are in `AGENTS.md` (Russian). Changes go `feature/*` → PR into `develop` → release by merging into `main`; versions, `CHANGELOG.md` and tags are produced by semantic-release from Conventional Commits.

## Repository layout

| Path                            | What                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `apps/desktop`                  | Electron + Vue 3 + Vite + Vuetify; the engine runs in a `utilityProcess`            |
| `packages/`                     | `@lms/*` packages of the business-logic layer and complex UI components (`@lms/ui`) |
| `docs/`, `engine-ts/`, `spike/` | system design documents, research and spike reports; no code                        |
| `vendor/metaskills`, `.agents/` | skills for agents (a git submodule and directories), see "Skills"                   |

The documents are written in Russian; identifiers and code are in English. Markers used in them: [ИЗМЕРЕНО] — obtained by a run, [ВЫВОД] — a conclusion, [ОЦЕНКА] — a calculation, [НЕ ПОДТВЕРЖДЕНО] — not verified. To start reading the design, see `engine-ts/README.md`.

## Document map

| Path                                                                                                   | What                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/design/platform-synthesis.md`                                                                    | synthesis of the research, platform requirements F1–F7 (§4), architecture                                                                                                                                                           |
| `docs/design/mvp-trane.md`, `mvp-trane-vs-knowledge-spaces.md`, `build-vs-port.md`, `fsrs-in-trane.md` | options for building the core (Trane as the MVP engine, comparison with knowledge spaces, port versus own core, FSRS in Trane)                                                                                                      |
| `docs/research/`                                                                                       | research: Trane (overview, source audit, spike), Math Academy, Vanderbilt Knowledge Spaces, RemNote, Mochi, FSRS versus PowerLaw, FSRS in Trane (scorer, history truncation, integration)                                           |
| `engine-ts/README.md`                                                                                  | reading order, M0 start, open questions, pitfalls                                                                                                                                                                                   |
| `engine-ts/design/`                                                                                    | main design v1 (`engine-ts.md`), API contract, test strategy, diagram (`.html`)                                                                                                                                                     |
| `engine-ts/research/`                                                                                  | 4 specs of Trane behavior, 8 spike reports (FSRS, PowerLaw, loader, F1–F7), `facts-stack.md`                                                                                                                                        |
| `spike/REPORT-audit.md`, `spike/REPORT-spike.md`                                                       | reports of the first round of Trane spikes; `REPORT-audit.md` differs from `docs/research/trane-source-audit.md` (48 KB versus 39.8 KB), `REPORT-spike.md` is a copy of `docs/research/trane-spike.md` with a different status note |

Paths inside the documents are written from the root of the original project and kept as they are in this repository (`docs/…`, `engine-ts/design/…`, `engine-ts/research/…`, `spike/REPORT-*.md`).

## Artifacts outside the repository

The sandbox code stayed in `/Users/tinkerbells/projects/lms-platform/` and is not part of git. References to these paths in the documents point there.

| Path in the documents                                                 | What                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine-ts/spike/`                                                    | 8 prototypes and benchmarks (`compiler`, `diagnostic`, `fire-plan`, `fsrs-check`, `journal-sync`, `loader-bench`, `powerlaw-port`, `sql-runner`; `loader-bench` has no tests, only benchmarks) and the `probes/`, `specs/` probes; dependencies are installed with `npm ci` |
| `engine-ts/reference/trane-pristine/`                                 | Rust reference of Trane v0.34.1 = tag `v0.34.1`, commit `6f5f84a85667b4bf0402b1185ae5a889ff57e01d` (https://github.com/trane-project/trane), needed for golden tests                                                                                                        |
| `engine-ts/reference/sql-course/`, `engine-ts/reference/fsrs-scorer/` | a sample course of 7 lessons and a Rust FSRS adapter (12 tests)                                                                                                                                                                                                             |
| `spike/fsrs-vs-trane/`                                                | the "FSRS versus PowerLaw" experiment (Rust + Python, CSV)                                                                                                                                                                                                                  |

## Skills

[metarhia/metaskills](https://github.com/metarhia/metaskills) (MIT) is connected as the git submodule `vendor/metaskills`, pinned to version 1.0.5 (commit `fe4c4230ea054e4b354d9e81400e26299f1be6d7`). Seven skills: `js-conventions`, `js-data-structures`, `data-structures`, `metautil-data-structures`, `js-gof`, `error-handling`, `npm-publish`.

Agents see them through symlinks: `.agents/skills/<name>` → `vendor/metaskills/skills/<name>`, `.claude/skills/<name>` → `.agents/skills/<name>` (as in `~/.claude/skills`). The symlinks are stored in git. Verified: a headless `omp -p` session started in this directory sees all seven skills in its system prompt [ИЗМЕРЕНО].

```sh
git submodule update --init && scripts/link-skills.sh          # after cloning without --recurse-submodules
git submodule update --remote vendor/metaskills && scripts/link-skills.sh   # update the skills
```

Why not `npx metaskills`: it creates one link `<ide>/skills/metaskills` to the whole folder, that is the layout `skills/metaskills/<name>/SKILL.md`, while omp looks for skills exactly one level below `skills/` (omp documentation, `skills.md`). So `scripts/link-skills.sh` links each skill separately.

The skill [`vuetify-skilld`](https://github.com/harlan-zw/vue-ecosystem-skills/tree/main/skills/vuetify-skilld) (harlan-zw/vue-ecosystem-skills, Vuetify 4.0.1) is stored in git as a regular directory `.agents/skills/vuetify-skilld` (a copy from GitHub, not via market.lobehub.com); `.claude/skills/vuetify-skilld` is a symlink to it. `scripts/link-skills.sh` does not touch it: the script removes only dangling links to `vendor/metaskills`.

The skill [`feature-sliced-design`](https://github.com/feature-sliced/skills) (Feature-Sliced Design v2.1) was installed with `npx skills add https://github.com/feature-sliced/skills --skill feature-sliced-design` (with `DISABLE_TELEMETRY=1`); the CLI puts a copy into `.claude/skills/`, the directory was moved to `.agents/skills/feature-sliced-design`, and `.claude/skills/` holds a symlink, like the others. The source and hash are recorded in `skills-lock.json`.

Our own skill `storybook-vue-stories` (`.agents/skills/storybook-vue-stories`, symlink in `.claude/skills/`) explains how to write Storybook stories for Vue 3 components (CSF 3, Storybook 10, Vuetify, `play`); based on the article https://habr.com/ru/articles/761570/.

The skill `vue-design-reviewer` (`.agents/skills/vue-design-reviewer`, symlink in `.claude/skills/`) is a visual review of a Vue page or component; for components with stories the check goes through Storybook, a report only by default. Based on [web-design-reviewer](https://github.com/github/awesome-copilot/blob/main/skills/web-design-reviewer/SKILL.md) from github/awesome-copilot, using the built-in omp `browser` instead of Playwright MCP.

The skill [`vue-i18n-skilld`](https://github.com/skilld-dev/vue-ecosystem-skills/tree/main/skills/vue-i18n-skilld) (skilld-dev/vue-ecosystem-skills, vue-i18n 11.4.12; listing https://mcpmarket.com/tools/skills/vue-i18n-internationalization) was copied from GitHub into `.agents/skills/vue-i18n-skilld`, with a symlink in `.claude/skills/`. `vue-i18n` is not yet connected to the project.

Our own skill `git-workflow` (`.agents/skills/git-workflow`, symlink in `.claude/skills/`) describes the git process through `gh`: a `feature/<name>` branch from `develop`, commits by Conventional Commits (commitlint, the husky `commit-msg` hook), a PR into `develop` with a short description and a merge commit after a green pipeline, and a release by merging `develop` into `main`. Releases use semantic-release (`release.config.js`, `.github/workflows/release.yml`): version, `CHANGELOG.md`, tag, GitHub Release and `apps/desktop` installers. The release scheme comes from `experience-mf-listing` (semantic-release + commitlint); the CI build follows the `pr-build` and `release` workflows of [longtail-labs/slide.code](https://github.com/longtail-labs/slide.code) (without Conveyor and signing).

Linter and formatter: ESLint (`eslint-config-metarhia`) + Prettier, as `js-conventions` requires; chosen instead of the Biome from the original `engine-ts` design (M0).
