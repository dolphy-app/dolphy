# @dolphy-app/extension-sdk

SDK автора расширений («видов заданий»). Всё публичное API `@dolphy-app/extension-api`
реэкспортируется отсюда, отдельно ставить его не нужно.

```ts
// main.ts — код расширения (utilityProcess)
import { defineExtension } from '@dolphy-app/extension-sdk';
export default defineExtension({
  exerciseTypes: {
    'acme.echo': {
      project: () => ({}),
      grade: ({ spec, answer }) =>
        answer === (spec as { expected: string }).expected
          ? { outcome: 'passed' }
          : { outcome: 'failed', reason: 'mismatch' },
    },
  },
});

// view.ts — элемент ввода ответа (окно приложения)
import { defineAnswerElement } from '@dolphy-app/extension-sdk';
defineAnswerElement('acme-echo-answer', (api, props) => {
  const input = document.createElement('input');
  input.oninput = () => api.setAnswer(input.value, input.value.length > 0);
  api.root.append(input);
  return { update: (next) => void (input.disabled = next.disabled) };
});

// main.test.ts — проверка без приложения
import { loadExerciseType } from '@dolphy-app/extension-sdk/testing';
const echo = await loadExerciseType(module, 'acme.echo');
await echo.grade({ spec: { expected: '42' }, answer: '42' }); // { outcome: 'passed' }
```

## Вклады без кода и правила оценки

```ts
// main.ts — правило оценки (вклад `gradePolicies`, нужен main)
import { defineExtension } from '@dolphy-app/extension-sdk';
export default defineExtension({
  gradePolicies: {
    // 1–5 или null («нужна самооценка»); сбой правила — оценка по passAtN
    'acme.policy.generous': ({ verdicts, gaveUp }) =>
      gaveUp
        ? 1
        : verdicts.some(({ outcome }) => outcome === 'passed')
          ? 5
          : null,
  },
});

// markdown.ts — рендерер содержимого (вклад `markdownRenderers`, main не нужен)
import { defineMarkdownRenderer } from '@dolphy-app/extension-sdk';
export default defineMarkdownRenderer((source, container, { language }) => {
  container.textContent = `${language}: ${source}`;
});

// main.test.ts — проверка правила без приложения
import { loadGradePolicy } from '@dolphy-app/extension-sdk/testing';
const policy = await loadGradePolicy(module, 'acme.policy.generous');
await policy.evaluate({ verdicts: [{ outcome: 'passed' }], gaveUp: false }); // 5
```

- `defineExtension({ exerciseTypes?, gradePolicies?, events?, activate?, deactivate? })` —
  `gradePolicies` — словарь `id → GradePolicyHandler`; правила регистрируются
  и освобождаются вместе с видами заданий; `events` — словарь
  `имя события → обработчик` (см. «Состояние, настройки и события»).
- `defineMarkdownRenderer(render)` — `export default` модуля рендерера
  содержимого (`render(source, container, { language, signal })`); при
  исключении приложение оставляет исходный текст блока.
- `loadGradePolicy(module, id)` (`@dolphy-app/extension-sdk/testing`) — `evaluate`
  проверяет, что результат — целое 1–5 или `null`.

Темам код не нужен: это данные в `extension.json`. Подробности по всем
точкам вклада — `docs/design/extensions.md`, «Точки вклада».

## Состояние, настройки и события

Три возможности контекста `ctx`; детали и примеры манифестов — в
`docs/design/extensions.md`.

```ts
// extension.json: "permissions": ["learning.events"],
// "contributes": { "events": [{ "event": "attempt.closed" }],
//   "settings": [{ "id": "acme.streak.goal", "type": "number", "label": "Цель в день",
//     "default": 3, "min": 1, "max": 20, "integer": true }] }
import {
  defineExtension,
  type ExtensionContext,
} from '@dolphy-app/extension-sdk';

let ctx: ExtensionContext;
export default defineExtension({
  activate: (context) => void (ctx = context),
  events: {
    'attempt.closed': async ({ at }) => {
      const day = new Date(at).toISOString().slice(0, 10);
      const done = (await ctx.storage.get<number>(day)) ?? 0;
      await ctx.storage.set(day, done + 1);
      if (done + 1 === ctx.settings.get<number>('acme.streak.goal')) {
        ctx.logger.info({ day }, 'daily goal reached');
      }
    },
  },
});
```

- `ctx.storage` — `get<T>(key)`, `set(key, value)`, `delete(key)`, `keys()`:
  JSON по строковым ключам, у каждого расширения своё пространство; данные
  переживают перезапуск, обновление и отключение. Разрешение не нужно, но есть
  потолки (`EXTENSION_STORAGE_LIMITS`): ключ — 128 символов, значение — 64 КиБ,
  256 ключей, 1 МиБ всего. Превышение бросает `StorageQuotaError` (`kind`,
  `limit`), запись не происходит. Работает и в ограниченном процессе.
- `ctx.settings` — `get<T>(id)` (синхронно: значение пользователя или
  `default`; `id` не из манифеста бросает) и `onDidChange(handler)`: изменение
  в «Настройки → Расширения» доходит до работающего расширения без перезапуска.
- `ctx.events.on(name, handler)` (и `events` в `defineExtension`) — события
  обучения `session.started`, `session.finished`, `attempt.closed`; нужны
  разрешение `learning.events` и объявление события в `contributes.events`,
  иначе бросает. Один обработчик на событие. Доставка асинхронная, по порядку,
  не более одного раза; на обработчик — 2 с; очередь — 100 событий на
  расширение (самые старые отбрасываются с предупреждением в лог); сбой,
  исключение и таймаут обработчика влияют только на лог.
- `@dolphy-app/extension-sdk/testing`: `createMemoryStorage()` (те же потолки и
  `StorageQuotaError`), `createMemorySettings(definitions, values?)` (значения
  проверяются по определениям, `set(id, value)` зовёт `onDidChange`),
  `createMemoryEvents(options?)` (`emit(name, payload)` отправляет событие
  подписчику) и `loadEvents(module, { settings?, settingValues?, declared?, storage? })` —
  активирует модуль и отдаёт `emit`, `storage`, `settings`. В отличие от хоста,
  тестовые помощники не проглатывают сбой обработчика и не отсчитывают 2 с.
  `loadExerciseType` и `loadGradePolicy` принимают готовые `storage`,
  `settings` и `events` (объекты из этих помощников).

## Команды и панели

Команда — вклад `contributes.commands` (нужен main), панель —
`contributes.panels` (экран в изолированной рамке, модуль `./panel.mjs` по
умолчанию, main не нужен).

```ts
// main.ts — обработчики по id; каждая команда объявлена в манифесте
import { defineExtension, notify, openPanel } from '@dolphy-app/extension-sdk';
export default defineExtension({
  commands: {
    'acme.tools.open': () => openPanel('acme.tools.main', { from: 'palette' }),
    'acme.tools.ping': () => notify('pong'),
  },
});

// panel.ts — export default модуля панели
import { defineExtensionPanel } from '@dolphy-app/extension-sdk';
export default defineExtensionPanel({
  mount(container, ctx) {
    container.textContent = `${ctx.panelId}: ${JSON.stringify(ctx.props)}`;
    void ctx.call('acme.tools.ping'); // любая объявленная команда, в том числе palette: false
  },
});

// main.test.ts — проверка без приложения
import { loadCommands } from '@dolphy-app/extension-sdk/testing';
const commands = await loadCommands(module, {
  declaredCommands: ['acme.tools.open', 'acme.tools.ping'],
  declaredPanels: ['acme.tools.main'],
});
await commands.run('acme.tools.ping'); // { kind: 'notify', text: 'pong' }
```

- `defineExtension({ commands })` — словарь `id → CommandHandler`; то же делает
  `ctx.commands.register(id, handler)`. Результат — `notify(text)` (1–500
  символов), `openPanel(id, props?)`, JSON-значение или ничего.
- `defineExtensionPanel({ mount(container, ctx) })` — `ctx`: `panelId`, `props`,
  `signal`, `call(commandId, args?)`, `onProps(listener)`.
- `loadCommands(module, options?)` (`/testing`) отдаёт `run(id, args?)` →
  `CommandOutcome`, `ids()`, `dispose()`; бросает на незарегистрированную
  команду и недопустимый результат (правила — `normalizeCommandResult` из
  `@dolphy-app/extension-api`).

## Права и `ctx.library`

Расширение не из поставки и не доверенное исполняется в ограниченном процессе
(`docs/design/extensions.md`, «Права и изоляция»): что не объявлено в
`permissions` манифеста, недоступно. Из SDK доступны `EXTENSION_PERMISSIONS`
(`library.read`, `process.spawn`, `worker.threads`, `native.addons`, `network`,
`learning.events`) и класс `PermissionError` (`permission`, `code: 'EXT_PERMISSION'`).

- `ctx.library` в ограниченном процессе — прокси: запросы `readText` и `stat`
  выполняет родитель, и только если объявлено `library.read`. Без него оба
  метода бросают `PermissionError` (проверка идёт до обращения к родителю;
  родитель отказывает и сам). Непойманное исключение обработчика даёт ошибку
  `handler-failed`, проверка — вердикт `error`.
- Запуск процессов, потоки и нативные модули без `process.spawn`,
  `worker.threads` и `native.addons` падают с `ERR_ACCESS_DENIED` от Node;
  `network` — справочное разрешение, сеть кода им не ограничивается.
- У доверенного расширения и у расширения из поставки ограничений нет.
- `@dolphy-app/extension-sdk/testing` запускает обработчик в вашем процессе, без
  ограничений и без проверки `permissions`: `PermissionError` и
  `ERR_ACCESS_DENIED` там не воспроизводятся, проверяйте разрешения в
  приложении (вид — от стороннего, не доверенного расширения).
