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
import type { ExtensionViews } from '@dolphy-app/extension-sdk';

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

// the answer input: runs in the app window; the build defines the custom
// element with the tag from extension.json
export const views = {
  '${id}': defineAnswerView((api, initial) => {
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
  const type = await loadExerciseType(host, '${id}', { settings });
  disposables.push(type);
  return type;
};

const mount = async (label?: string) => {
  const view = await loadView(views, '${id}', label === undefined ? {} : { label });
  disposables.push(view);
  const input = view.query<HTMLInputElement>('input');
  if (input === null) throw new Error('no input');
  return { view, input };
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
    '  `defineExerciseType`) and `views` (`defineAnswerView`); the build splits',
    '  it into `main.mjs` and `view.mjs`;',
    ...idsBullet,
    '- `test/index.test.ts` — tests (`vitest`, `happy-dom`).',
  ],
  files: (id) => ({
    'extension.json': manifestJson(id),
    'src/index.ts': indexTs(id),
    'test/index.test.ts': indexTestTs(id),
  }),
};
