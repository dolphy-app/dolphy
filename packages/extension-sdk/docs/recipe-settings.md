# Recipe: settings

Let the user configure the extension in Settings → Extensions. The code
registers the definitions; the app draws the form, validates the values and
stores them; your code reads them. This recipe has no template of its own:
start from `blank` and replace the three files below, which are checked as a
whole project. See [quick-start.md](quick-start.md) for the commands.

## The manifest

File `extension.json` (settings):

```json
{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "acme.hello",
  "version": "0.1.0",
  "apiVersion": 1,
  "name": "Hello settings",
  "description": "A greeting command whose text follows the user's settings.",
  "author": "your-github-login",
  "tags": ["productivity"]
}
```

The manifest holds the identity only; the settings are registered by the code.

## The code

File `src/index.ts` (settings):

```ts
import { defineServer, notify } from '@dolphy-app/extension-sdk';

export const server = defineServer((s) => {
  s.registerSettings([
    {
      id: 'acme.hello.name',
      type: 'string',
      label: { en: 'Name to greet', ru: 'Кого приветствовать' },
      default: 'world',
      maxLength: 40,
    },
    {
      id: 'acme.hello.times',
      type: 'number',
      label: { en: 'Exclamation marks', ru: 'Восклицательные знаки' },
      default: 1,
      min: 1,
      max: 5,
      integer: true,
    },
    {
      id: 'acme.hello.style',
      type: 'enum',
      label: { en: 'Style', ru: 'Стиль' },
      default: 'plain',
      options: [
        { value: 'plain', label: { en: 'Plain', ru: 'Обычный' } },
        { value: 'loud', label: { en: 'Loud', ru: 'Громкий' } },
      ],
    },
  ]);

  s.registerCommand({
    id: 'acme.hello.greet',
    title: { en: 'Greet', ru: 'Поприветствовать' },
    run: () => {
      // `get` is synchronous and returns the user's value or the default
      const name = String(s.settings.get('acme.hello.name'));
      const marks = '!'.repeat(Number(s.settings.get('acme.hello.times')));
      const text = `Hello, ${name}${marks}`;
      return notify(
        s.settings.get('acme.hello.style') === 'loud'
          ? text.toUpperCase()
          : text,
      );
    },
  });

  // a change in Settings → Extensions reaches the running extension
  s.settings.onDidChange((change) => {
    s.logger.info({ id: change.id, value: change.value }, 'setting changed');
  });
});
```

- `server.registerSettings(definitions)` adds the settings to Settings →
  Extensions. Types: `boolean`, `string` (`maxLength`), `text` (a multi-line
  string), `color` (`#rrggbb`), `list` (`maxItems`, `itemMaxLength`), `number`
  (`min`, `max`, `integer`) and `enum` (`options: [{ value, label }]`).
- A setting `id` is the extension id or starts with `<id>.`, and is registered
  once. `default` must satisfy the constraints, otherwise the registration
  fails and the extension shows `load-failed`.
- `label`, `description` and `group` are `LocalizedText`: a string, or
  `{ en, ru }` as here. `order` sorts the form; `visibleWhen: { setting, equals }`
  hides a field while another setting of the extension has a different value.
- `server.settings.get(id)` returns the user's value or the default (an id
  nobody registered throws) as a `SettingValue`; narrow it where you use it,
  as `String(…)` and `Number(…)` do here. Read a value where you use it. Cache
  it only if you also subscribe with `onDidChange`.
- The app validates every value (type, range, integer, length, `options`)
  before it reaches you, so the code needs no checks of its own.

## The test

File `test/index.test.ts` (settings):

```ts
import { createTestServer } from '@dolphy-app/extension-sdk/testing';
import { expect, it } from 'vitest';
import { server } from '../src/index.ts';

const start = (settingValues = {}) =>
  createTestServer(server, { extensionId: 'acme.hello', settingValues });

it('the greeting follows the settings, also after a change', async () => {
  const running = await start();
  expect(await running.commands.run('acme.hello.greet')).toEqual({
    kind: 'notify',
    text: 'Hello, world!',
  });

  await running.settings.set('acme.hello.name', 'Ada');
  await running.settings.set('acme.hello.times', 3);
  await running.settings.set('acme.hello.style', 'loud');
  expect(await running.commands.run('acme.hello.greet')).toEqual({
    kind: 'notify',
    text: 'HELLO, ADA!!!',
  });
  await running.dispose();
});

it('a user value of a setting replaces the default', async () => {
  const running = await start({ 'acme.hello.name': 'Grace' });
  expect(await running.commands.run('acme.hello.greet')).toMatchObject({
    text: 'Hello, Grace!',
  });
  await running.dispose();
});

it('the test settings reject a value the app would reject', async () => {
  const running = await start();
  await expect(running.settings.set('acme.hello.times', 9)).rejects.toThrow(
    'acme.hello.times',
  );
  await expect(
    running.settings.set('acme.hello.style', 'quiet'),
  ).rejects.toThrow('acme.hello.style');
  await running.dispose();
});

it('a change is logged', async () => {
  const logged: object[] = [];
  const logger = {
    debug: () => undefined,
    info: (fields: object) => void logged.push(fields),
    warn: () => undefined,
    error: () => undefined,
  };
  const running = await createTestServer(server, {
    extensionId: 'acme.hello',
    logger,
  });
  await running.settings.set('acme.hello.name', 'Ada');
  expect(logged).toEqual([{ id: 'acme.hello.name', value: 'Ada' }]);
  await running.dispose();
});
```

`createTestServer` starts `server` with the settings in memory:
`running.settings.get` returns the default until a value is set, and
`running.settings.set(id, value)` checks the value against the definition the
way the app does and calls the `onDidChange` subscribers, so the test changes a
value as the user does in the dialog. `settingValues` starts the extension with
user values in place of the defaults; every id must be registered by `server`.
The `logger` option receives what `server.logger` is called with.

## Try and ship

Run `pnpm dev`, start the app with `DOLPHY_DEV_EXTENSIONS`, open Settings →
Extensions, press "Settings" on the extension, change a value and run "Greet"
from the palette.
