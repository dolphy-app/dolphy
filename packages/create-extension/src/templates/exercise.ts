import { INITIAL_VERSION } from './common.ts';
import type { TemplateModule } from './common.ts';

export const manifestJson = (id: string): string => `{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "${id}",
  "version": "${INITIAL_VERSION}",
  "apiVersion": 1,
  "name": "Text match",
  "description": "Exercise type: the learner types a string that is compared with the expected text.",
  "author": "your-github-login",
  "tags": ["learning"]
}
`;

export const indexTs = (): string => `export { client } from './client.ts';
export { server } from './server.ts';
`;

export const serverTs = (id: string): string => `import {
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
      id: '${id}.trim',
      type: 'boolean',
      label: { en: 'Ignore spaces around the answer', ru: 'Игнорировать пробелы вокруг ответа' },
      default: true,
    },
  ]);

  // read when the handler runs, so a change in the settings applies at once
  const trims = (): boolean => s.settings.get('${id}.trim') === true;

  const matches = (answer: string, spec: Spec): boolean => {
    const given = trims() ? answer.trim() : answer;
    if (spec.ignoreCase === true) {
      return given.toLowerCase() === spec.expected.toLowerCase();
    }
    return given === spec.expected;
  };

  // the app checks \`spec\` and the answer against the schemas before the
  // handlers run
  s.registerExerciseType(
    defineExerciseType<Spec, string, Record<string, never>>({
      id: '${id}',
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
    id: '${id}.status',
    title: { en: 'Show how answers are compared', ru: 'Показать способ сравнения' },
    run: () =>
      notify(
        trims()
          ? 'Answers are compared without the spaces around them.'
          : 'Answers are compared exactly as typed.',
      ),
  });
});
`;

export const clientTs = (
  id: string,
): string => `import { defineClient } from '@dolphy-app/extension-sdk';
import { TextAnswer } from './text-answer.ts';

// runs in the app window: the answer view is a Vue component for the exercise
// type that \`server\` registers
export const client = defineClient((c) => {
  c.addAnswerView('${id}', TextAnswer);
});
`;

export const textAnswerTs =
  (): string => `import type { AnswerChange } from '@dolphy-app/extension-sdk';
import { defineComponent, h, ref, watch } from 'vue';
import type { PropType } from 'vue';

// the answer input: a Vue component the app draws in its own window tree. It
// takes the props of \`AnswerViewProps\` and reports the answer with \`change\`;
// \`submit\` asks the app to check it
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
    // what is typed stays on screen even if the app never returns \`value\`
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
`;

export const indexTestTs = (
  id: string,
): string => `// @vitest-environment happy-dom
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
    extensionId: '${id}',
    settingValues,
  });
  disposables.push(running);
  return running;
};

// mounts the answer view the way the app does: the props of \`AnswerViewProps\`
// in, the \`change\` and \`submit\` events out
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

describe('${id}: handler', () => {
  it('project does not reveal the reference', async () => {
    const type = (await start()).exerciseType('${id}');
    expect(await type.project(spec)).toEqual({});
  });

  it('grade: a match passes, a mismatch does not', async () => {
    const type = (await start()).exerciseType('${id}');
    expect(await type.grade({ spec, answer: 'Hello' })).toEqual({
      outcome: 'passed',
    });
    expect(await type.grade({ spec, answer: 'hello' })).toEqual({
      outcome: 'failed',
      reason: 'mismatch',
    });
  });

  it('grade: ignoreCase turns case sensitivity off', async () => {
    const type = (await start()).exerciseType('${id}');
    const relaxed = { ...spec, ignoreCase: true };
    expect(await type.grade({ spec: relaxed, answer: 'hELLO' })).toEqual({
      outcome: 'passed',
    });
  });

  it('referenceAnswer passes the check itself', async () => {
    const type = (await start()).exerciseType('${id}');
    const reference = await type.referenceAnswer(spec);
    expect(reference).toEqual({ found: true, answer: 'Hello' });
    if (!reference.found) throw new Error('reference expected');
    expect(await type.grade({ spec, answer: reference.answer })).toEqual({
      outcome: 'passed',
    });
  });
});

describe('${id}: settings and commands', () => {
  it('the trim setting decides whether the spaces around an answer count', async () => {
    const running = await start();
    const type = running.exerciseType('${id}');
    expect(await type.grade({ spec, answer: ' Hello ' })).toEqual({
      outcome: 'passed',
    });
    await running.settings.set('${id}.trim', false);
    expect(await type.grade({ spec, answer: ' Hello ' })).toEqual({
      outcome: 'failed',
      reason: 'mismatch',
    });
  });

  it('the status command reports the current mode', async () => {
    const running = await start();
    expect(await running.commands.run('${id}.status')).toEqual({
      kind: 'notify',
      text: 'Answers are compared without the spaces around them.',
    });
    await running.settings.set('${id}.trim', false);
    expect(await running.commands.run('${id}.status')).toEqual({
      kind: 'notify',
      text: 'Answers are compared exactly as typed.',
    });
  });

  it('a user value of the setting replaces the default', async () => {
    const running = await start({ '${id}.trim': false });
    expect(await running.commands.run('${id}.status')).toMatchObject({
      text: 'Answers are compared exactly as typed.',
    });
  });
});

describe('${id}: schemas', () => {
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

describe('${id}: client', () => {
  it('adds the answer view for the exercise type', async () => {
    const running = await createTestClient(client, { extensionId: '${id}' });
    disposables.push(running);
    expect(running.answerViews.get('${id}')).toBe(TextAnswer);
  });
});

describe('${id}: view', () => {
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
`;

export const exercise: TemplateModule = {
  summary: [
    'A Dolphy extension: the "text match" exercise type (the learner types a',
    'string, it is compared with `spec.expected`), a setting and a command.',
  ],
  layout: [
    '- `extension.json` — the manifest: identity only, the build adds `main` and',
    '  `client`;',
    '- `src/server.ts` — `server` (`defineServer`): the exercise type with the',
    '  `spec` and answer schemas, the setting and the command; the build writes',
    '  it to `main.mjs`;',
    '- `src/client.ts` — `client` (`defineClient`): adds the answer view with',
    '  `addAnswerView`; `src/text-answer.ts` is the Vue component that is the',
    '  answer input; the build writes them to `client.mjs`;',
    '- `src/index.ts` — re-exports `server` and `client`;',
    '- `test/index.test.ts` — tests (`vitest`, `happy-dom`).',
  ],
  files: (id) => ({
    'extension.json': manifestJson(id),
    'src/index.ts': indexTs(),
    'src/server.ts': serverTs(id),
    'src/client.ts': clientTs(id),
    'src/text-answer.ts': textAnswerTs(),
    'test/index.test.ts': indexTestTs(id),
  }),
};
