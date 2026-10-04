# Recipe: settings

Let the user configure the extension in Settings → Extensions. The app draws the
form from the definitions in the manifest, validates the values and stores them;
your code reads them. This recipe has no template of its own: start from
`blank` and replace the three files below, which are checked as a whole project.
See [quick-start.md](quick-start.md) for the commands.

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
  "tags": ["productivity"],
  "contributes": {
    "commands": [{ "id": "acme.hello.greet", "title": "Greet" }],
    "settings": [
      {
        "id": "acme.hello.name",
        "type": "string",
        "label": "Name to greet",
        "default": "world",
        "maxLength": 40
      },
      {
        "id": "acme.hello.times",
        "type": "number",
        "label": "Exclamation marks",
        "default": 1,
        "min": 1,
        "max": 5,
        "integer": true
      },
      {
        "id": "acme.hello.style",
        "type": "enum",
        "label": "Style",
        "default": "plain",
        "options": [
          { "value": "plain", "label": "Plain" },
          { "value": "loud", "label": "Loud" }
        ]
      }
    ]
  }
}
```

- Types: `boolean`, `string` (`maxLength`), `number` (`min`, `max`, `integer`)
  and `enum` (`options: [{ value, label }]`).
- A setting `id` is the extension id or starts with `<id>.`. `default` must
  satisfy the constraints, otherwise the manifest is rejected.
- `label` (1–60 characters) and `description` (up to 500) are shown as written;
  they are data of the extension and are not translated.

## The code

File `src/index.ts` (settings):

```ts
import {
  defineExtension,
  inActivate,
  notify,
} from '@dolphy-app/extension-sdk';

export const host = defineExtension({
  commands: { 'acme.hello.greet': inActivate },
  activate(ctx) {
    ctx.commands.register('acme.hello.greet', () => {
      // `get` is synchronous and returns the user's value or the default
      const name = ctx.settings.get('acme.hello.name');
      const marks = '!'.repeat(ctx.settings.get('acme.hello.times'));
      const style = ctx.settings.get('acme.hello.style');
      const text = `Hello, ${name}${marks}`;
      return notify(style === 'loud' ? text.toUpperCase() : text);
    });

    // a change in Settings → Extensions reaches the running extension
    ctx.settings.onDidChange((change) => {
      ctx.logger.info({ id: change.id, value: change.value }, 'setting changed');
    });
  },
});
```

- The ids are typed from the manifest: `ctx.settings.get('acme.hello.times')` is
  a `number`, `style` is `'plain' | 'loud'`, an undeclared id does not compile.
- Read a value where you use it. Cache it only if you also subscribe with
  `onDidChange`, as the `exercise` template does.
- The engine validates every value (type, range, integer, length, `options`)
  before it reaches you, so the code needs no checks of its own.

## The test

File `test/index.test.ts` (settings):

```ts
import type { SettingContribution } from '@dolphy-app/extension-sdk';
import {
  createMemorySettings,
  loadCommands,
} from '@dolphy-app/extension-sdk/testing';
import { expect, it } from 'vitest';
import manifest from '../extension.json';
import { host } from '../src/index.ts';

const definitions = manifest.contributes.settings as SettingContribution[];

it('the greeting follows the settings, also after a change', async () => {
  const settings = createMemorySettings(definitions);
  const commands = await loadCommands(host, {
    settings,
    declaredCommands: ['acme.hello.greet'],
  });

  expect(await commands.run('acme.hello.greet')).toEqual({
    kind: 'notify',
    text: 'Hello, world!',
  });

  await settings.set('acme.hello.name', 'Ada');
  await settings.set('acme.hello.times', 3);
  await settings.set('acme.hello.style', 'loud');
  expect(await commands.run('acme.hello.greet')).toEqual({
    kind: 'notify',
    text: 'HELLO, ADA!!!',
  });
  await commands.dispose();
});

it('the memory settings reject a value the engine would reject', async () => {
  const settings = createMemorySettings(definitions);
  await expect(settings.set('acme.hello.times', 9)).rejects.toThrow(
    'acme.hello.times',
  );
  await expect(settings.set('acme.hello.style', 'quiet')).rejects.toThrow(
    'acme.hello.style',
  );
});
```

`createMemorySettings(definitions, values?)` is the settings the host gives
`ctx`: `get` returns the default until a value is set, `set(id, value)` checks
the value against the definition and calls the `onDidChange` subscribers. Pass
it to `loadCommands` (or `loadEvents`, `loadExerciseType`) through `settings`.
`loadEvents` takes the definitions and `settingValues` directly.

## Try and ship

Run `pnpm dev`, start the app with `DOLPHY_DEV_EXTENSIONS`, open Settings →
Extensions, press "Settings" on the extension, change a value and run "Greet"
from the palette.
