# Recipe: an exercise type

A new kind of task: the course author writes `spec` (what to ask), the learner
types an answer, your code grades it. This recipe is the `exercise` template
(`npx @dolphy-app/create-extension <dir> --id acme.hello --template exercise`,
also the default). The files below are exactly what the generator writes for the
id `acme.hello`. Read [quick-start.md](quick-start.md) first for the project
layout and commands.

The exercise type here compares the answer with an expected text. It has three
parts: a declaration, the grading code (`host`) and the answer input (`views`).

## The manifest

File `extension.json` (exercise):

```json
{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "acme.hello",
  "version": "0.1.0",
  "apiVersion": 1,
  "name": "Text match",
  "description": "Exercise type: the learner types a string that is compared with the expected text.",
  "author": "your-github-login",
  "tags": ["learning"],
  "contributes": {
    "exerciseTypes": [
      {
        "id": "acme.hello",
        "specSchema": {
          "type": "object",
          "required": ["expected"],
          "additionalProperties": false,
          "properties": {
            "expected": { "type": "string", "minLength": 1 },
            "ignoreCase": { "type": "boolean" }
          }
        },
        "answerSchema": { "type": "string" }
      }
    ],
    "settings": [
      {
        "id": "acme.hello.trim",
        "type": "boolean",
        "label": "Ignore spaces around the answer",
        "default": true
      }
    ],
    "commands": [
      { "id": "acme.hello.status", "title": "Show how answers are compared" }
    ]
  }
}
```

- `exerciseTypes[].id` is the name a course uses in its exercises. `specSchema`
  and `answerSchema` are JSON Schemas: the app checks `spec` and the answer
  against them before your code runs, so `grade` can trust their shape.
- `settings` declares a user setting; the code below reads it.
- The command `acme.hello.status` shows in the palette how answers are compared.
- No `element` key: the tag of the answer element defaults to one derived from
  the id (`acme.hello` → `acme-hello-answer`), and the build defines the custom
  element for you.

## The code

File `src/index.ts` (exercise):

```ts
import {
  defineAnswerView,
  defineExerciseType,
  defineExtension,
  inActivate,
  notify,
} from '@dolphy-app/extension-sdk';
import type { ExtensionViews } from '@dolphy-app/extension-sdk';

interface Spec {
  expected: string;
  ignoreCase?: boolean;
}

// filled from the setting in `activate`, read by the handlers below
const options = { trim: true };

const matches = (answer: string, spec: Spec): boolean => {
  const given = options.trim ? answer.trim() : answer;
  if (spec.ignoreCase === true) {
    return given.toLowerCase() === spec.expected.toLowerCase();
  }
  return given === spec.expected;
};

// extension code: runs in the extension process of the app
// the schemas from extension.json have already checked `spec` and the answer
// before the handlers run
// the ids come from extension.json: `dolphy-ext types` (and every build)
// writes them to .dolphy/ids.d.ts, so a misspelt id, a declared id without a
// handler or an undeclared setting fails `pnpm typecheck`
export const host = defineExtension({
  exerciseTypes: {
    'acme.hello': defineExerciseType<Spec, string, Record<string, never>>({
      project: () => ({}),
      grade: ({ spec, answer }) =>
        matches(answer, spec)
          ? { outcome: 'passed' }
          : { outcome: 'failed', reason: 'mismatch' },
      referenceAnswer: ({ spec }) => spec.expected,
    }),
  },
  // this command is registered in `activate`: the marker names the id there
  commands: { 'acme.hello.status': inActivate },
  activate(ctx) {
    options.trim = ctx.settings.get('acme.hello.trim');
    ctx.settings.onDidChange((change) => {
      if (change.id === 'acme.hello.trim') options.trim = change.value;
    });
    ctx.commands.register('acme.hello.status', () =>
      notify(
        options.trim
          ? 'Answers are compared without the spaces around them.'
          : 'Answers are compared exactly as typed.',
      ),
    );
  },
});

// the answer input: runs in the app window; the build defines the custom
// element with the tag from extension.json
export const views = {
  'acme.hello': defineAnswerView((api, initial) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.spellcheck = false;
    if (api.label !== null) input.setAttribute('aria-label', api.label);

    const applyValue = (value: unknown) => {
      input.value = typeof value === 'string' ? value : '';
    };
    let appliedValue = initial.value;
    applyValue(appliedValue);
    input.disabled = initial.disabled;

    input.addEventListener('input', () => {
      api.setAnswer(input.value, input.value.trim().length > 0);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') api.submit();
    });
    api.root.append(input);

    return {
      update: (props) => {
        input.disabled = props.disabled;
        // apply the value only when the app really changed it
        if (props.value !== appliedValue) {
          appliedValue = props.value;
          applyValue(appliedValue);
        }
      },
    };
  }),
} satisfies ExtensionViews;
```

- `host` runs in the extension process. `defineExerciseType<Spec, Answer, Public>`
  takes `project` (the part of `spec` the window may see; never put the expected
  answer there), `grade` (the verdict) and, optionally, `referenceAnswer` (what
  "show the answer" displays).
- A verdict is `{ outcome: 'passed' }` or `{ outcome: 'failed', reason }`.
- `inActivate` marks an id that is registered in `activate`, where `ctx` exists.
  `ctx.settings.get(id)` is synchronous and typed by the manifest (`boolean`
  here); `onDidChange` delivers a change from Settings → Extensions to the
  running extension without a restart.
- `views` runs in the app window. `defineAnswerView(mount)` gets `api.root` (a
  shadow root), `api.setAnswer(value, complete)` and `api.submit()`, and returns
  `update(props)` for new `value` and `disabled`. The keys of `views` must be
  exactly the declared exercise types; `satisfies ExtensionViews` makes the
  compiler check it.
- `src/index.ts` has no side effects on import, so tests import it in plain
  Node. The build splits it: `host` goes to `main.mjs`, `views` to `view.mjs`.

## The tests

File `test/index.test.ts` (exercise):

```ts
// @vitest-environment happy-dom
import type { SettingContribution } from '@dolphy-app/extension-sdk';
import {
  createMemorySettings,
  createSchemaValidator,
  loadCommands,
  loadExerciseType,
  loadView,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import manifest from '../extension.json';
import { host, views } from '../src/index.ts';

const [contribution] = manifest.contributes.exerciseTypes;
const validateSpec = createSchemaValidator(contribution.specSchema);
const validateAnswer = createSchemaValidator(contribution.answerSchema);

const spec = { expected: 'Hello' };

const disposables: { dispose(): unknown }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

const newSettings = () =>
  createMemorySettings(manifest.contributes.settings as SettingContribution[]);

const load = async (settings = newSettings()) => {
  const type = await loadExerciseType(host, 'acme.hello', { settings });
  disposables.push(type);
  return type;
};

const mount = async (label?: string) => {
  const view = await loadView(views, 'acme.hello', label === undefined ? {} : { label });
  disposables.push(view);
  const input = view.query<HTMLInputElement>('input');
  if (input === null) throw new Error('no input');
  return { view, input };
};

describe('acme.hello: handler', () => {
  it('project does not reveal the reference', async () => {
    const type = await load();
    expect(await type.project(spec)).toEqual({});
  });

  it('grade: a match passes, a mismatch does not', async () => {
    const type = await load();
    expect(await type.grade({ spec, answer: 'Hello' })).toEqual({
      outcome: 'passed',
    });
    expect(await type.grade({ spec, answer: 'hello' })).toEqual({
      outcome: 'failed',
      reason: 'mismatch',
    });
  });

  it('grade: ignoreCase turns case sensitivity off', async () => {
    const type = await load();
    const relaxed = { ...spec, ignoreCase: true };
    expect(await type.grade({ spec: relaxed, answer: 'hELLO' })).toEqual({
      outcome: 'passed',
    });
  });

  it('referenceAnswer passes the check itself', async () => {
    const type = await load();
    const reference = await type.referenceAnswer(spec);
    expect(reference).toEqual({ found: true, answer: 'Hello' });
    if (!reference.found) throw new Error('reference expected');
    expect(await type.grade({ spec, answer: reference.answer })).toEqual({
      outcome: 'passed',
    });
  });
});

describe('acme.hello: settings and commands', () => {
  it('the trim setting decides whether the spaces around an answer count', async () => {
    const settings = newSettings();
    const type = await load(settings);
    expect(await type.grade({ spec, answer: ' Hello ' })).toEqual({
      outcome: 'passed',
    });
    await settings.set('acme.hello.trim', false);
    expect(await type.grade({ spec, answer: ' Hello ' })).toEqual({
      outcome: 'failed',
      reason: 'mismatch',
    });
  });

  it('the status command reports the current mode', async () => {
    const settings = newSettings();
    const commands = await loadCommands(host, {
      declaredCommands: ['acme.hello.status'],
      settings,
    });
    disposables.push(commands);
    expect(await commands.run('acme.hello.status')).toEqual({
      kind: 'notify',
      text: 'Answers are compared without the spaces around them.',
    });
    await settings.set('acme.hello.trim', false);
    expect(await commands.run('acme.hello.status')).toEqual({
      kind: 'notify',
      text: 'Answers are compared exactly as typed.',
    });
  });
});

describe('acme.hello: schemas', () => {
  it.each([[{ expected: 'a' }], [{ expected: 'a', ignoreCase: true }]])(
    'spec %j is valid',
    (value) => {
      expect(validateSpec(value)).toEqual([]);
    },
  );

  it.each([
    ['no expected', {}],
    ['empty expected', { expected: '' }],
    ['ignoreCase is not a boolean', { expected: 'a', ignoreCase: 'yes' }],
    ['an extra field', { expected: 'a', extra: 1 }],
  ])('spec: %s is rejected', (_name, value) => {
    expect(validateSpec(value)).not.toEqual([]);
  });

  it('answer: a string is valid, a number is not', () => {
    expect(validateAnswer('text')).toEqual([]);
    expect(validateAnswer(42)).not.toEqual([]);
  });
});

describe('acme.hello: view', () => {
  it('typing reports the answer; an empty input is incomplete', async () => {
    const { view, input } = await mount();
    input.value = 'Hello';
    input.dispatchEvent(new Event('input'));
    input.value = '  ';
    input.dispatchEvent(new Event('input'));
    expect(view.changes).toEqual([
      { value: 'Hello', complete: true },
      { value: '  ', complete: false },
    ]);
  });

  it('Enter submits the answer', async () => {
    const { view, input } = await mount();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(view.submissions).toBe(1);
  });

  it('disabled blocks the input', async () => {
    const { view, input } = await mount();
    await view.update({ disabled: true });
    expect(input.disabled).toBe(true);
  });

  it('value restores the answer without events', async () => {
    const { view, input } = await mount();
    await view.update({ value: 'Hello' });
    expect(input.value).toBe('Hello');
    expect(view.changes).toEqual([]);
  });

  it('the aria-label of the host goes to the input', async () => {
    const { input } = await mount('Your answer');
    expect(input.getAttribute('aria-label')).toBe('Your answer');
  });
});
```

`loadExerciseType` activates `host` and gives `project` and `grade` the way the
app calls them, and checks the shape of the results. `loadView` mounts the view
in the test DOM (the `@vitest-environment happy-dom` comment) and reports
`changes` and `submissions`. `createSchemaValidator` checks fixtures against the
schemas of the manifest, so a change to a schema fails the test.

## Try and ship

```sh
pnpm install
pnpm test
pnpm dev
```

A course names the exercise type by its id (`acme.hello`) and supplies a `spec`
that matches `specSchema`. To make it yours, rename the id, change the schemas
and the grading, and keep the structure.
