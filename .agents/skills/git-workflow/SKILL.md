---
name: git-workflow
description: Git-процесс репозитория lms-platform-design через gh — ветка feature/<name> от develop, коммиты по Conventional Commits (commitlint), PR в develop с описанием и слияние после зелёного pipeline, релиз слиянием develop в main (semantic-release, сборка установщиков). Использовать при любой просьбе "закоммить", "сделай ветку", "открой PR/MR", "влей в develop", "сделай релиз", "выпусти версию", "влей в main", а также перед первым коммитом любой задачи. Git workflow with gh, Conventional Commits, PR to develop, semantic-release.
---

# Git-процесс через gh

Ветки: `main` (только релизы), `develop` (интеграционная), `feature/<feature-name>` (любая работа, kebab-case, латиница). Прямые коммиты и push в `develop` и `main` запрещены. Всё, что касается GitHub (PR, слияние, релиз), делается через `gh`, не через веб-интерфейс и не локальным `git merge` в `develop`/`main`.

Настройки репозитория (приватный, бесплатный тариф): защиты веток нет, поэтому дисциплину держат этот скилл, husky-хук `commit-msg` и job `commitlint` в CI. Слияние — только merge-коммитом (`--merge`): squash и rebase стирают отдельные коммиты, а semantic-release считает версию по ним.

## 1. Ветка

```sh
git fetch origin
git switch -c feature/<feature-name> origin/develop
```

Параллельная работа или чужие незакоммиченные изменения в основной рабочей копии: отдельный worktree рядом с репозиторием.

```sh
git worktree add -b feature/<feature-name> ../lms-platform-design-<feature-name> origin/develop
cd ../lms-platform-design-<feature-name> && pnpm install
```

`pnpm install` в новом worktree нужен для husky и зависимостей. После слияния worktree удаляется (шаг 5).

## 2. Коммиты

Conventional Commits, заголовок на английском, в нижнем регистре, без точки, до 100 символов: `<type>(<scope>): <subject>`. Проверяет commitlint (`commitlint.config.js`): хук `commit-msg` локально и job `commitlint` на PR в `develop`.

| type                                 | Когда                              | Версия при релизе |
| ------------------------------------ | ---------------------------------- | ----------------- |
| `feat`                               | новая возможность                  | minor             |
| `fix`                                | исправление ошибки                 | patch             |
| `perf`                               | ускорение без смены поведения      | patch             |
| `docs`, `test`, `refactor`, `style`  | документы, тесты, рефакторинг      | релиза нет        |
| `build`, `ci`, `chore`, `revert`     | сборка, CI, обслуживание, откат    | релиза нет        |
| `feat!`, `fix!` или `BREAKING CHANGE:` в теле | несовместимое изменение   | major             |

`scope` необязателен, но если задан — имя каталога из `apps/` или `packages/` (`desktop`, `engine`, `engine-rpc`, `ui`, …) либо `deps`, `docs`, `engine-ts`, `packages`, `release`, `repo`, `skills`. Новый пакет попадает в список автоматически. Скиллы агентов — `chore(skills)`, правила репозитория и конфиги — `chore(repo)` или `docs(repo)`.

Хорошо: `feat(desktop): add course scope switcher`, `fix(engine): keep started lessons below the passing threshold`. Плохо: `Update stuff`, `feat(Desktop): Add Switcher.`.

Один коммит — одно логическое изменение: от него зависит и changelog, и версия. `chore(release): …` создаёт только semantic-release, руками такие коммиты не писать. Хук нельзя обходить (`--no-verify`).

Перед push: `pnpm fix`, затем `pnpm lint`; если менялся код — `pnpm typecheck` и `pnpm test`.

## 3. PR в develop и слияние

```sh
git push -u origin HEAD

gh pr create --base develop --title "<type>(<scope>): <краткая суть фичи>" --body "$(cat <<'BODY'
## Что за фича
<1–2 предложения: зачем и что получает пользователь или разработчик>

## Что сделано
- <изменение 1>
- <изменение 2>
BODY
)"
```

Описание краткое: суть фичи и список сделанного, без пересказа диффа. Язык — русский (как документы), идентификаторы — как в коде. Заголовок PR — в стиле Conventional Commits (на версию он не влияет: версию считают коммиты ветки).

Слить можно только при двух условиях: нет конфликтов и pipeline PR зелёный. Порядок: проверить конфликты, дождаться CI, слить. Поле `mergeable` вычисляется асинхронно и сначала может быть `UNKNOWN`, поэтому опрашиваем:

```sh
pr=$(gh pr view --json number -q .number)
until [ "$(gh pr view "$pr" --json mergeable -q .mergeable)" != UNKNOWN ]; do sleep 2; done
gh pr view "$pr" --json mergeable,mergeStateStatus
```

- `CONFLICTING` → не сливать. Подтянуть `develop` в ветку, решить конфликты, проверить `pnpm lint`, запушить, повторить проверку:
  ```sh
  git fetch origin && git merge origin/develop   # конфликты → правка → git add → git commit
  git push
  ```
- `MERGEABLE` → дождаться pipeline. Сразу после создания PR проверки могут ещё не появиться (`no checks reported`), поэтому небольшая пауза:
  ```sh
  sleep 15 && gh pr checks "$pr" --watch --fail-fast --interval 10
  ```
  Код возврата 0 — все jobs (`lint`, `typecheck`, `test`, `build`, `commitlint`) зелёные, можно сливать. Иначе — не сливать: посмотреть лог упавшего job (`gh run view <run-id> --log-failed`; пока run идёт, `gh api --allow-escape-sequences repos/{owner}/{repo}/actions/jobs/<job-id>/logs`), исправить в этой же ветке отдельным коммитом, запушить и снова дождаться pipeline.
- Зелёный pipeline и `MERGEABLE` → `gh pr merge "$pr" --merge --subject "Merge feature/<feature-name> into develop"`. Без `--delete-branch`: после слияния `gh` переключает локальную копию на `develop`, а из worktree это падает (`develop` занят основной копией), и удаление ветки на сервере не выполняется. Проверить итог: `gh pr view "$pr" --json state -q .state` → `MERGED`.

PR в `main` (релиз) и PR `main` → `develop` (возврат релизного коммита) сливаются по тому же правилу: сначала зелёный pipeline.

## 4. Релиз (слияние develop в main)

Релиз делается только по просьбе. Порядок: все нужные фичи уже в `develop`.

```sh
git fetch origin
git log --oneline origin/main..origin/develop     # что войдёт; если пусто — релиза нет
```

Если среди коммитов нет ни одного `feat`, `fix`, `perf` или breaking, semantic-release версию не выпустит — сообщить об этом до слияния.

```sh
gh pr create --base main --head develop --title "release: merge develop into main" --body "$(cat <<'BODY'
## Что войдёт в релиз
- <фича или исправление, по одному пункту на PR из develop>
BODY
)"
```

Список для тела: `gh pr list --base develop --state merged --search "merged:>=<дата прошлого релиза>" --json number,title`; дату — из `gh release list --limit 1`. Дальше те же проверки `mergeable` и pipeline (шаг 3), затем:

```sh
gh pr merge "$pr" --merge --subject "Merge develop into main"   # без --delete-branch: develop не удаляется
```

Push в `main` запускает `.github/workflows/release.yml`:

1. semantic-release по коммитам с прошлого тега `v*` считает версию, дописывает `CHANGELOG.md`, поднимает `version` в корневом `package.json`, коммитит `chore(release): X.Y.Z [skip ci]` в `main`, ставит тег `vX.Y.Z` и создаёт GitHub Release.
2. Job `build` собирает неподписанные установщики (macOS `.dmg`, Windows `.exe`, Linux `.AppImage`) с версией из тега и прикладывает их к Release.

Дождаться и проверить:

```sh
run=$(gh run list --workflow release.yml --branch main --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$run" --exit-status
gh release view --json tagName,url,assets -q '{tag: .tagName, url: .url, assets: [.assets[].name]}'
```

Затем вернуть релизный коммит в `develop` (иначе там устаревшие `version` и `CHANGELOG.md`) — тоже PR, не прямой push:

```sh
gh pr create --base develop --head main --title "chore(release): sync main into develop" --body "Возврат релизного коммита semantic-release (CHANGELOG.md, version) в develop."
```

Дальше те же проверки `mergeable` и pipeline (шаг 3), затем `gh pr merge "$pr" --merge --subject "Merge main into develop"` (без `--delete-branch`).

## 5. После слияния

```sh
cd <основная рабочая копия>
git switch develop && git pull --ff-only
git branch -d feature/<feature-name>
git worktree remove ../lms-platform-design-<feature-name>   # если работали в worktree
git worktree prune
```

Удалённую ветку удалить явно: `git push origin --delete feature/<feature-name>`.

## Чего не делать

- Не коммитить и не пушить в `develop`/`main`; не делать `git merge feature/… ` в них локально.
- Не использовать `--squash` и `--rebase` при слиянии, не удалять `develop`/`main`.
- Не править `CHANGELOG.md` и версию в корневом `package.json` руками, не ставить теги `v*` вручную.
- Не обходить хуки (`--no-verify`), не переписывать историю уже запушенных веток (`push --force`) без явной просьбы.
- Не сливать PR с конфликтами, с красным или ещё не завершённым pipeline и без описания.
