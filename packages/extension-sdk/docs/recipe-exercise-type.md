# Recipe: an exercise type

A new kind of task: the course author writes `spec` (what to ask), the learner
types an answer, your code grades it. This recipe is the `exercise` template
(`npx @dolphy-app/create-extension <dir> --id acme.hello --template exercise`,
also the default). The files below are exactly what the generator writes for the
id `acme.hello`. Read [quick-start.md](quick-start.md) first for the project
layout and commands.

The exercise type here compares the answer with an expected text. It has two
parts: the grading code in `server` and the answer input in `client`.

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
  "tags": ["learning"]
}
```

The manifest says who the extension is and nothing more. The exercise type, the
setting and the command are registered by the code below.

## The server part

File `src/index.ts` (exercise):

```ts
export { client } from './client.ts';
export { server } from './server.ts';
```

`src/index.ts` only re-exports the two entries, each from its own file: the
server part must not import `vue` or a component, the client part must not
import `node:*` modules.

File `src/server.ts` (exercise):

```ts
import {
  defineExerciseType,
  defineServer,
  notify,
} from '@dolphy-app/extension-sdk';

interface Spec {
  expected: string;
  ignoreCase?: boolean;
}

// runs in the extension host: every call registers a contribution
export const server = defineServer((s) => {
  s.registerSettings([
    {
      id: 'acme.hello.trim',
      type: 'boolean',
      label: { en: 'Ignore spaces around the answer', ru: 'Игнорировать пробелы вокруг ответа' },
      default: true,
    },
  ]);

  // read when the handler runs, so a change in the settings applies at once
  const trims = (): boolean => s.settings.get('acme.hello.trim') === true;

  const matches = (answer: string, spec: Spec): boolean => {
    const given = trims() ? answer.trim() : answer;
    if (spec.ignoreCase === true) {
      return given.toLowerCase() === spec.expected.toLowerCase();
    }
    return given === spec.expected;
  };

  // the app checks `spec` and the answer against the schemas before the
  // handlers run
  s.registerExerciseType(
    defineExerciseType<Spec, string, Record<string, never>>({
      id: 'acme.hello',
      title: 'Text match',
      specSchema: {
        type: 'object',
        required: ['expected'],
        additionalProperties: false,
        properties: {
          expected: { type: 'string', minLength: 1 },
          ignoreCase: { type: 'boolean' },
        },
      },
      answerSchema: { type: 'string' },
      project: () => ({}),
      grade: ({ spec, answer }) =>
        matches(answer, spec)
          ? { outcome: 'passed' }
          : { outcome: 'failed', reason: 'mismatch' },
      referenceAnswer: ({ spec }) => spec.expected,
    }),
  );

  s.registerCommand({
    id: 'acme.hello.status',
    title: { en: 'Show how answers are compared', ru: 'Показать способ сравнения' },
    run: () =>
      notify(
        trims()
          ? 'Answers are compared without the spaces around them.'
          : 'Answers are compared exactly as typed.',
      ),
  });
});
```

- `server.registerExerciseType(defineExerciseType<Spec, Answer, View>({ … }))`
  registers the type. Its `id` is the name a course uses in its exercises, and
  it is the extension id or starts with it and a dot. `defineExerciseType` only
  infers `Spec`, `Answer` and `View` from the handlers.
- `specSchema` and `answerSchema` are JSON Schema (2020-12) objects. The app
  checks the `spec` of an exercise and the learner's answer against them before
  a handler runs, so `grade` never sees a malformed value.
- `project(spec)` returns what the answer input may see of the `spec` (`View`);
  here nothing, so the expected text never reaches the window. `grade` returns
  `{ outcome: 'passed' }` or `{ outcome: 'failed', reason }`. `referenceAnswer`
  is optional: it gives the author a way to see the correct answer.
- `server.registerSettings([...])` adds a setting to Settings → Extensions;
  `server.settings.get(id)` returns the user's value or the default. Read it
  where you use it, as `trims()` does, and a change applies at once. The
  [settings recipe](recipe-settings.md) shows the rest of the types.
- `server.registerCommand({ id, title, run })` adds a palette command; `notify`
  shows a notification.
- Everything registered together is all or nothing: when `server` throws, or
  takes more than 10 seconds, the extension contributes nothing and shows
  `load-failed`.

## The client part

File `src/client.ts` (exercise):

```ts
import { defineClient } from '@dolphy-app/extension-sdk';
import { TextAnswer } from './text-answer.ts';

// runs in the app window: the answer view is a Vue component for the exercise
// type that `server` registers
export const client = defineClient((c) => {
  c.addAnswerView('acme.hello', TextAnswer);
});
```

File `src/text-answer.ts` (exercise):

```ts
import type { AnswerChange } from '@dolphy-app/extension-sdk';
import { defineComponent, h, ref, watch } from 'vue';
import type { PropType } from 'vue';

// the answer input: a Vue component the app draws in its own window tree. It
// takes the props of `AnswerViewProps` and reports the answer with `change`;
// `submit` asks the app to check it
export const TextAnswer = defineComponent({
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
```

- `client.addAnswerView(exerciseTypeId, component)` tells the window to draw
  `component` for the exercises of that type. The id is the one `server`
  registers.
- The component is a Vue component the app draws in its own window tree, so the
  theme and the language apply. It takes the props of `AnswerViewProps` (`view`,
  `value`, `disabled`, `verdict`, `label`) and emits `change` with an
  `AnswerChange` (`{ value, complete }`) and `submit` without data.
- `vue` (and `vuetify`) are imported as usual: the build leaves them out of the
  bundle and the app gives the component its own instances.

## The tests

File `test/index.test.ts` (exercise):

```ts
// @vitest-environment happy-dom
import {
  createSchemaValidator,
  createTestClient,
  createTestServer,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import { client, server } from '../src/index.ts';
import { TextAnswer } from '../src/text-answer.ts';

const spec = { expected: 'Hello' };

const disposables: { dispose(): unknown }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

const start = async (settingValues = {}) => {
  const running = await createTestServer(server, {
    extensionId: 'acme.hello',
    settingValues,
  });
  disposables.push(running);
  return running;
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
      h(TextAnswer, {
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
    const type = (await start()).exerciseType('acme.hello');
    expect(await type.project(spec)).toEqual({});
  });

  it('grade: a match passes, a mismatch does not', async () => {
    const type = (await start()).exerciseType('acme.hello');
    expect(await type.grade({ spec, answer: 'Hello' })).toEqual({
      outcome: 'passed',
    });
    expect(await type.grade({ spec, answer: 'hello' })).toEqual({
      outcome: 'failed',
      reason: 'mismatch',
    });
  });

  it('grade: ignoreCase turns case sensitivity off', async () => {
    const type = (await start()).exerciseType('acme.hello');
    const relaxed = { ...spec, ignoreCase: true };
    expect(await type.grade({ spec: relaxed, answer: 'hELLO' })).toEqual({
      outcome: 'passed',
    });
  });

  it('referenceAnswer passes the check itself', async () => {
    const type = (await start()).exerciseType('acme.hello');
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
    const running = await start();
    const type = running.exerciseType('acme.hello');
    expect(await type.grade({ spec, answer: ' Hello ' })).toEqual({
      outcome: 'passed',
    });
    await running.settings.set('acme.hello.trim', false);
    expect(await type.grade({ spec, answer: ' Hello ' })).toEqual({
      outcome: 'failed',
      reason: 'mismatch',
    });
  });

  it('the status command reports the current mode', async () => {
    const running = await start();
    expect(await running.commands.run('acme.hello.status')).toEqual({
      kind: 'notify',
      text: 'Answers are compared without the spaces around them.',
    });
    await running.settings.set('acme.hello.trim', false);
    expect(await running.commands.run('acme.hello.status')).toEqual({
      kind: 'notify',
      text: 'Answers are compared exactly as typed.',
    });
  });

  it('a user value of the setting replaces the default', async () => {
    const running = await start({ 'acme.hello.trim': false });
    expect(await running.commands.run('acme.hello.status')).toMatchObject({
      text: 'Answers are compared exactly as typed.',
    });
  });
});

describe('acme.hello: schemas', () => {
  const registered = async () => {
    const [type] = (await start()).registration.exerciseTypes;
    if (type === undefined) throw new Error('exercise type expected');
    return {
      validateSpec: createSchemaValidator(type.specSchema),
      validateAnswer: createSchemaValidator(type.answerSchema),
    };
  };

  it.each([[{ expected: 'a' }], [{ expected: 'a', ignoreCase: true }]])(
    'spec %j is valid',
    async (value) => {
      expect((await registered()).validateSpec(value)).toEqual([]);
    },
  );

  it.each([
    ['no expected', {}],
    ['empty expected', { expected: '' }],
    ['ignoreCase is not a boolean', { expected: 'a', ignoreCase: 'yes' }],
    ['an extra field', { expected: 'a', extra: 1 }],
  ])('spec: %s is rejected', async (_name, value) => {
    expect((await registered()).validateSpec(value)).not.toEqual([]);
  });

  it('answer: a string is valid, a number is not', async () => {
    const { validateAnswer } = await registered();
    expect(validateAnswer('text')).toEqual([]);
    expect(validateAnswer(42)).not.toEqual([]);
  });
});

describe('acme.hello: client', () => {
  it('adds the answer view for the exercise type', async () => {
    const running = await createTestClient(client, { extensionId: 'acme.hello' });
    disposables.push(running);
    expect(running.answerViews.get('acme.hello')).toBe(TextAnswer);
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

`createTestServer(server, { extensionId })` starts `server` on in-memory
settings, storage and library and gives `exerciseType(id)` with `project`,
`grade` and `referenceAnswer` the way the app calls them, with the checks of the
host on the shape of the results. `settingValues` plays the user's choice, and
`running.settings.set` changes a value the way the settings dialog does.
`createSchemaValidator` checks fixtures against the schemas that were
registered, so a change to a schema fails the test. `createTestClient(client)`
records what `client` adds; the view itself is tested as a Vue component:
`mount` in the file draws it with `createApp` in the test DOM (the
`@vitest-environment happy-dom` comment), passes the props of `AnswerViewProps`
and collects the `change` and `submit` events.

## Try and ship

```sh
pnpm install
pnpm test
pnpm dev
```

A course names the exercise type by its id (`acme.hello`) and supplies a `spec`
that matches `specSchema`. To make it yours, rename the id, change the schemas
and the grading, and keep the structure.
