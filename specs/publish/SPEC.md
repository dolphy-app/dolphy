---
status: active
branch: feature/publish
created: 2026-10-01
closed: null
touches: [tools, extension-api, extension-sdk, extension-tools, create-extension]
depends-on: []
supersedes: null
superseded-by: null
---

# Публикация пакетов авторов в npm

Живой документ, пока `status` — `draft` или `active`: `Progress`, `Surprises & Discoveries`, `Decision Log` обновляются вместе с кодом. По завершении фичи переносится в `specs/archive/` и не меняется. Правила — скилл `spec-workflow`.

## Цель

Пакеты `@dolphy-app/extension-api`, `extension-sdk`, `extension-tools` и `create-extension` публикуются в npmjs (организация `dolphy-app`) вместе с релизом приложения. Автор расширения ставит их обычным `npm install` без токена и без `.npmrc`.

## Не цели

- Независимые версии пакетов и `semantic-release` на каждый пакет: версия по-прежнему общая и равна версии релиза приложения (отложено, см. Decision Log).
- Trusted publishing (OIDC) и provenance: репозиторий приватный, провенанс npm для приватных репозиториев не выдаётся; публикация идёт по токену.
- Публикация закрытых пакетов монорепозитория и приложения.
- Перенос ранее опубликованных версий из GitHub Packages.

## Требования

- R1. Job `publish-packages` в `.github/workflows/release.yml` публикует 4 пакета в `https://registry.npmjs.org` с `--access public`, аутентификация — секрет `NPM_TOKEN` (`NODE_AUTH_TOKEN`). `GITHUB_TOKEN` и `packages: write` не используются. Повторный запуск для уже выпущенной версии не падает. Проверка: просмотр workflow; `pnpm build:packages --version X.Y.Z && pnpm verify:packages`; фактический запуск после слияния (требуется `NPM_TOKEN`).
- R2. Сгенерированный `package.json` каждого пакета содержит `publishConfig: { access: 'public', registry: 'https://registry.npmjs.org' }`. Проверка: `node --test tools/lib/package-manifest.test.mjs`, `pnpm verify:packages`.
- R3. `pnpm verify:packages` устанавливает tarball'ы в пустой проект без `.npmrc` для реестра и без токена и проходит цепочку `create-dolphy-extension` → build/validate/test. Проверка: `pnpm verify:packages`.
- R4. `create-dolphy-extension` без `--local` не пишет `.npmrc` и не добавляет в README раздел про токен; сообщение CLI о токене убрано. Проверка: `packages/create-extension/test/generate.test.ts`.
- R5. `.github/workflows/packages.yml` на pull request делает `npm publish --dry-run` против npmjs без токена. Проверка: pipeline PR.
- R6. README пакетов, `packages/README.md`, `docs/design/extensions.md`, шаблон `tools/templates/package-readme.md` описывают npmjs, а не GitHub Packages; решение зафиксировано в ADR 0005, а в ADR 0004 статус пункта 6 помечен заменённым. Проверка: `git grep -n "npm.pkg.github.com\|GitHub Packages" -- . ':!specs/archive' ':!docs/adr'` пусто.

## Решения

Реестр npmjs вместо GitHub Packages: у владельца появилась организация `dolphy-app` на npm и токен, а GitHub Packages требует токен даже для установки публичных пакетов. Схема сборки не меняется: рабочие пакеты остаются `private`, публикуется сгенерированный `dist-publish/<пакет>` (`tools/build-packages.mjs`). `REGISTRY` в `tools/lib/package-manifest.mjs` — единственный источник адреса. Версия общая: `release` считает её `semantic-release` в корне, `publish-packages` собирает пакеты с этой версией.

Токен — granular access token npm с правом Read and write на scope `@dolphy-app`, хранится в секрете репозитория `NPM_TOKEN`; в коде и чате его нет. Если в организации включено обязательное 2FA, токен создаётся с обходом 2FA для автоматизации.

## Progress

- [x] 2026-10-01 спека и ADR 0005
- [x] 2026-10-01 `tools/` (реестр, `publishConfig`, verify) и тесты
- [x] 2026-10-01 workflows `release.yml`, `packages.yml`
- [x] 2026-10-01 `create-extension` без `.npmrc` и токена
- [x] 2026-10-01 документация
- [ ] секрет `NPM_TOKEN` в репозитории (владелец) и первый выпуск

## Surprises & Discoveries

- `npm publish --dry-run` без входа в npm проходит (предупреждение «requires you to be logged in»), токен в `packages.yml` не нужен.
- `pnpm verify:packages` прошёл на версии 0.2.0 без `.npmrc` и токена.

## Decision Log

- 2026-10-01. Общая версия пакетов, `semantic-release` остаётся один, в корне. Причина: `semantic-release` не поддерживает монорепозитории; `multi-semantic-release` плохо сочетается с приватными рабочими пакетами и публикацией из `dist-publish/`. Независимые версии понадобятся, когда `extension-api` начнёт расходиться с приложением, — отдельная спека.
- 2026-10-01. Публикация по токену, без OIDC и провенанса. Причина: репозиторий приватный; trusted publishing можно включить позже, когда пакеты уже существуют.

## Outcomes

Заполняется при закрытии.
