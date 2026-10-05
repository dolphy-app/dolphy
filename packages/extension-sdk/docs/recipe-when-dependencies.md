# Recipe: visibility conditions and dependencies

Show a command, a panel or a widget only where it makes sense (`when`), and
require another extension (`dependencies`). Both are manifest data, so this
recipe is a small project whose test reads the manifest. This recipe has no
template of its own: start from `blank` and replace the three files below,
which are checked as a whole project. See [quick-start.md](quick-start.md) for
the commands.

## The manifest

File `extension.json` (when-dependencies):

```json
{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "acme.hello",
  "version": "0.1.0",
  "apiVersion": 1,
  "name": "Hello report",
  "description": "A report command that appears only on the Courses screen.",
  "author": "your-github-login",
  "tags": ["productivity"],
  "dependencies": [
    { "id": "acme.cards", "range": ">=1.0.0 <2.0.0" },
    { "id": "dolphy.choice" }
  ],
  "contributes": {
    "commands": [
      {
        "id": "acme.hello.report",
        "title": "Course report",
        "when": "route == 'courses' && course.active"
      }
    ],
    "panels": [
      {
        "id": "acme.hello.board",
        "title": "Course board",
        "when": "course.active && !session.active"
      }
    ]
  }
}
```

- `when` is a boolean expression over five keys of the app window: `route`
  (the name of the current screen), `course.active` (one course is in focus),
  `session.active` (a study session is open), `locale` (`ru` or `en`) and
  `theme.dark`. Operators: `==`, `!=`, `in ('a', 'b')`, `&&`, `||`, `!` and
  parentheses; strings are in single quotes. At most 200 characters. An unknown
  key or value, a wrong type or a syntax error is a manifest error with the
  position, so `pnpm validate` catches a typo before the app does.
- While the condition is false a command is not in the palette and its keys do
  nothing, a panel's menu item is hidden, and a widget is not drawn. The value
  follows the route, the course, the session, the language and the theme
  without a reload. Your own code still reaches the command (`ctx.call`) and
  the panel (`openPanel`): `when` hides, it does not forbid.
- `dependencies` lists up to 16 extensions that must be present, enabled,
  loaded and in the version `range` (comparators separated by a space, such as
  `>=1.0.0 <2.0.0`; no `^` or `~`). Otherwise the extension is shown as
  "dependencies not met" in Settings → Extensions, with the missing, disabled
  or mismatched one named, and contributes nothing. Disabling or enabling a
  dependency updates the dependents at once.
- Nothing installs a dependency for the user, and extensions cannot call each
  other: a dependency only says "this must be there". A repeat and a dependency
  on yourself are manifest errors; extensions that depend on each other in a
  circle are not loaded.

## The code

File `src/index.ts` (when-dependencies):

```ts
import { defineExtension, defineExtensionPanel } from '@dolphy-app/extension-sdk';
import type { ExtensionPanels } from '@dolphy-app/extension-sdk';

export const host = defineExtension({
  commands: { 'acme.hello.report': () => ({ courses: 1 }) },
});

export const panels = {
  'acme.hello.board': defineExtensionPanel({
    mount(container) {
      container.textContent = 'Board';
    },
  }),
} satisfies ExtensionPanels;
```

The conditions are in the manifest, so the code is ordinary: it does not check
where it is shown. The command and the panel are only reachable where the
condition is true.

## The test

File `test/when.test.ts` (when-dependencies):

```ts
import { evaluateWhen, parseWhen } from '@dolphy-app/extension-sdk';
import type { WhenContext } from '@dolphy-app/extension-sdk';
import { describe, expect, it } from 'vitest';
import manifest from '../extension.json';

const context = (overrides: Partial<WhenContext> = {}): WhenContext => ({
  route: 'courses',
  'course.active': true,
  'session.active': false,
  locale: 'en',
  'theme.dark': false,
  ...overrides,
});

const [command] = manifest.contributes.commands;
const [panel] = manifest.contributes.panels;

describe('acme.hello: when', () => {
  it('shows the report on the Courses screen with a course in focus', () => {
    const when = parseWhen(command.when);
    expect(evaluateWhen(when, context())).toBe(true);
    expect(evaluateWhen(when, context({ route: 'daily-plan' }))).toBe(
      false,
    );
    expect(
      evaluateWhen(when, context({ 'course.active': false })),
    ).toBe(false);
  });

  it('hides the board during a study session', () => {
    const when = parseWhen(panel.when);
    expect(evaluateWhen(when, context())).toBe(true);
    expect(
      evaluateWhen(when, context({ 'session.active': true })),
    ).toBe(false);
  });

  it('reports a typo in a key with its position', () => {
    expect(() => parseWhen("rout == 'courses'")).toThrow();
  });
});

describe('acme.hello: dependencies', () => {
  it('names each required extension once, and not itself', () => {
    const ids = manifest.dependencies.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(manifest.id);
  });
});
```

`parseWhen` and `evaluateWhen` are the functions the app and `dolphy-ext
validate` use. `evaluateWhen` is pure: pass an object with the five keys.

## Try and ship

Run `pnpm validate`: it fails on a bad `when` or a bad `dependencies` entry.
In the app the extension's row in Settings → Extensions shows "dependencies not
met" until `acme.cards` is installed and enabled.
