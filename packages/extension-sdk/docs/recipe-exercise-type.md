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
- `renderer` is not written: the answer input is the module `./view.mjs`, which
  the build writes.

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
import type { AnswerChange, ExtensionViews } from '@dolphy-app/extension-sdk';
import { defineComponent, h, ref, watch } from 'vue';
import type { PropType } from 'vue';

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

// the answer input: a Vue component the app draws in its own window tree. It
// takes the props of `AnswerViewProps` and reports the answer with `change`;
// `submit` asks the app to check it
const TextAnswer = defineComponent({
  props: {
    view: { type: null },
    value: { type: null },
    disabled: Boolean,
    verdict: { type: null },
    label: { type: String as PropType<string | null>, default: null },
  },
  emits: ['change', 'submit'],
  setup(props, { emit }) {
    const asText = (value: unknown): string =>
      typeof value === 'string' ? value : '';
    // what is typed stays on screen even if the app never returns `value`
    const text = ref(asText(props.value));
    watch(
      () => props.value,
      (value) => {
        text.value = asText(value);
      },
    );
    return () =>
      h('input', {
        type: 'text',
        spellcheck: false,
        value: text.value,
        disabled: props.disabled,
        'aria-label': props.label ?? undefined,
        onInput: (event: Event) => {
          text.value = (event.target as HTMLInputElement).value;
          const change: AnswerChange<string> = {
            value: text.value,
            complete: text.value.trim().length > 0,
          };
          emit('change', change);
        },
        onKeydown: (event: KeyboardEvent) => {
          if (event.key === 'Enter') emit('submit');
        },
      });
  },
});

// the keys are the exercise type ids of extension.json; the build writes this
// table into view.mjs, `vue` itself is the app's own
export const views = {
  'acme.hello': defineAnswerView(TextAnswer),
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
- `views` runs in the app window. `defineAnswerView(component)` registers a Vue
  component as the answer input. It takes the props of `AnswerViewProps`
  (`view`, `value`, `disabled`, `verdict`, `label`) and emits `change` with
  `{ value, complete }` (`complete`: the answer can be submitted) and `submit`
  (the learner asks to check it). `vue` is the app's own instance and stays out
  of the bundle; so does `vuetify`, whose components you may use. The keys of
  `views` must be exactly the declared exercise types; `satisfies ExtensionViews`
  makes the compiler check it.
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
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
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

// mounts the answer view the way the app does: the props of `AnswerViewProps`
// in, the `change` and `submit` events out
const mount = async (label?: string) => {
  const props = reactive<Record<string, unknown>>({
    view: {},
    value: undefined,
    disabled: false,
    verdict: null,
    label: label ?? null,
  });
  const changes: unknown[] = [];
  let submissions = 0;
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({
    render: () =>
      h(views['acme.hello'], {
        ...props,
        onChange: (change: unknown) => changes.push(change),
        onSubmit: () => (submissions += 1),
      }),
  });
  app.mount(host);
  disposables.push({
    dispose: () => {
      app.unmount();
      host.remove();
    },
  });
  await nextTick();
  const input = host.querySelector('input');
  if (input === null) throw new Error('no input');
  return {
    input,
    changes,
    submissions: () => submissions,
    update: async (next: Record<string, unknown>) => {
      Object.assign(props, next);
      await nextTick();
    },
  };
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
    const { changes, input } = await mount();
    input.value = 'Hello';
    input.dispatchEvent(new Event('input'));
    input.value = '  ';
    input.dispatchEvent(new Event('input'));
    expect(changes).toEqual([
      { value: 'Hello', complete: true },
      { value: '  ', complete: false },
    ]);
  });

  it('Enter submits the answer', async () => {
    const { input, submissions } = await mount();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(submissions()).toBe(1);
  });

  it('disabled blocks the input', async () => {
    const { input, update } = await mount();
    await update({ disabled: true });
    expect(input.disabled).toBe(true);
  });

  it('value restores the answer without events', async () => {
    const { changes, input, update } = await mount();
    await update({ value: 'Hello' });
    expect(input.value).toBe('Hello');
    expect(changes).toEqual([]);
  });

  it('the label of the app becomes the aria-label of the input', async () => {
    const { input } = await mount('Your answer');
    expect(input.getAttribute('aria-label')).toBe('Your answer');
  });
});
```

`loadExerciseType` activates `host` and gives `project` and `grade` the way the
app calls them, and checks the shape of the results. The view is tested as a Vue
component: `mount` in the file draws it with `createApp` in the test DOM (the
`@vitest-environment happy-dom` comment), passes the props of `AnswerViewProps`
and collects the `change` and `submit` events. `createSchemaValidator` checks fixtures against the
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
