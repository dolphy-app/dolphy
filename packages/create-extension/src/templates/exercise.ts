import { INITIAL_VERSION, idsBullet } from './common.ts';
import type { TemplateModule } from './common.ts';

export const manifestJson = (id: string): string => `{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "${id}",
  "version": "${INITIAL_VERSION}",
  "apiVersion": 1,
  "name": "Text match",
  "description": "Exercise type: the learner types a string that is compared with the expected text.",
  "author": "your-github-login",
  "tags": ["learning"],
  "contributes": {
    "exerciseTypes": [
      {
        "id": "${id}",
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
        "id": "${id}.trim",
        "type": "boolean",
        "label": "Ignore spaces around the answer",
        "default": true
      }
    ],
    "commands": [
      { "id": "${id}.status", "title": "Show how answers are compared" }
    ]
  }
}
`;

export const indexTs = (id: string): string => `import {
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

// filled from the setting in \`activate\`, read by the handlers below
const options = { trim: true };

const matches = (answer: string, spec: Spec): boolean => {
  const given = options.trim ? answer.trim() : answer;
  if (spec.ignoreCase === true) {
    return given.toLowerCase() === spec.expected.toLowerCase();
  }
  return given === spec.expected;
};

// extension code: runs in the extension process of the app
// the schemas from extension.json have already checked \`spec\` and the answer
// before the handlers run
// the ids come from extension.json: \`dolphy-ext types\` (and every build)
// writes them to .dolphy/ids.d.ts, so a misspelt id, a declared id without a
// handler or an undeclared setting fails \`pnpm typecheck\`
export const host = defineExtension({
  exerciseTypes: {
    '${id}': defineExerciseType<Spec, string, Record<string, never>>({
      project: () => ({}),
      grade: ({ spec, answer }) =>
        matches(answer, spec)
          ? { outcome: 'passed' }
          : { outcome: 'failed', reason: 'mismatch' },
      referenceAnswer: ({ spec }) => spec.expected,
    }),
  },
  // this command is registered in \`activate\`: the marker names the id there
  commands: { '${id}.status': inActivate },
  activate(ctx) {
    options.trim = ctx.settings.get('${id}.trim');
    ctx.settings.onDidChange((change) => {
      if (change.id === '${id}.trim') options.trim = change.value;
    });
    ctx.commands.register('${id}.status', () =>
      notify(
        options.trim
          ? 'Answers are compared without the spaces around them.'
          : 'Answers are compared exactly as typed.',
      ),
    );
  },
});

// the answer input: a Vue component the app draws in its own window tree. It
// takes the props of \`AnswerViewProps\` and reports the answer with \`change\`;
// \`submit\` asks the app to check it
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

// the keys are the exercise type ids of extension.json; the build writes this
// table into view.mjs, \`vue\` itself is the app's own
export const views = {
  '${id}': defineAnswerView(TextAnswer),
} satisfies ExtensionViews;
`;

export const indexTestTs = (
  id: string,
): string => `// @vitest-environment happy-dom
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
  const type = await loadExerciseType(host, '${id}', { settings });
  disposables.push(type);
  return type;
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
      h(views['${id}'], {
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

describe('${id}: settings and commands', () => {
  it('the trim setting decides whether the spaces around an answer count', async () => {
    const settings = newSettings();
    const type = await load(settings);
    expect(await type.grade({ spec, answer: ' Hello ' })).toEqual({
      outcome: 'passed',
    });
    await settings.set('${id}.trim', false);
    expect(await type.grade({ spec, answer: ' Hello ' })).toEqual({
      outcome: 'failed',
      reason: 'mismatch',
    });
  });

  it('the status command reports the current mode', async () => {
    const settings = newSettings();
    const commands = await loadCommands(host, {
      declaredCommands: ['${id}.status'],
      settings,
    });
    disposables.push(commands);
    expect(await commands.run('${id}.status')).toEqual({
      kind: 'notify',
      text: 'Answers are compared without the spaces around them.',
    });
    await settings.set('${id}.trim', false);
    expect(await commands.run('${id}.status')).toEqual({
      kind: 'notify',
      text: 'Answers are compared exactly as typed.',
    });
  });
});

describe('${id}: schemas', () => {
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
    '- `extension.json` — the manifest (the `spec` and answer schemas are written',
    '  in it);',
    '- `src/index.ts` — all the extension code: `host` (`defineExtension` +',
    '  `defineExerciseType`) and `views` (`defineAnswerView`: a Vue component',
    '  that is the answer input); the build splits it into `main.mjs` and',
    '  `view.mjs`;',
    ...idsBullet,
    '- `test/index.test.ts` — tests (`vitest`, `happy-dom`).',
  ],
  files: (id) => ({
    'extension.json': manifestJson(id),
    'src/index.ts': indexTs(id),
    'test/index.test.ts': indexTestTs(id),
  }),
};
