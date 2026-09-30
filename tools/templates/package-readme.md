# {{name}}

{{description}}

Версия пакетов равна версии приложения Dolphy, из релиза которого они опубликованы ({{version}}).

{{usage}}

## Установка

Пакеты публикуются в GitHub Packages, а не в npmjs: даже публичный пакет ставится
только с персональным токеном (classic) с правом `read:packages`.

В `.npmrc` проекта (создаётся `create-dolphy-extension`):

```ini
{{scope}}:registry={{registry}}
```

В `~/.npmrc` пользователя (токен в репозиторий не кладут):

```ini
//npm.pkg.github.com/:_authToken=<TOKEN>
```

После этого:

```sh
npm install {{name}}
```

## Документация

[Расширения Dolphy]({{docsUrl}}).
