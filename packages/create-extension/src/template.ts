/** Extension version in the template and its default for `apiVersion`. */
const INITIAL_VERSION = '0.1.0';

export interface TemplateInput {
  id: string;
  /** Dependency specifiers for the SDK and tools (see `dependencySpecs`). */
  dependencies: { sdk: string; tools: string };
}

const lines = (parts: readonly string[]): string => `${parts.join('\n')}\n`;

export const packageJson = ({ id, dependencies }: TemplateInput): string =>
  `${JSON.stringify(
    {
      name: id,
      version: INITIAL_VERSION,
      private: true,
      type: 'module',
      scripts: {
        build: 'dolphy-ext build',
        dev: 'dolphy-ext build --watch',
        types: 'dolphy-ext types',
        typecheck: 'dolphy-ext types && tsc',
        validate: `dolphy-ext validate dist-ext/${id}`,
        test: 'vitest run',
      },
      devDependencies: {
        '@dolphy-app/extension-sdk': dependencies.sdk,
        '@dolphy-app/extension-tools': dependencies.tools,
        '@types/node': '^22.20.4',
        'happy-dom': '^20.14.5',
        typescript: '^6.0.3',
        vitest: '^5.0.2',
      },
    },
    null,
    2,
  )}\n`;

export const tsconfigJson = (): string =>
  lines([
    '{',
    '  "compilerOptions": {',
    '    "target": "ES2023",',
    '    "lib": ["ES2023", "DOM"],',
    '    "module": "ESNext",',
    '    "moduleResolution": "bundler",',
    '    "types": ["node"],',
    '    "strict": true,',
    '    "resolveJsonModule": true,',
    '    "allowImportingTsExtensions": true,',
    '    "verbatimModuleSyntax": true,',
    '    "isolatedModules": true,',
    '    "skipLibCheck": true,',
    '    "noEmit": true',
    '  },',
    '  "include": ["src", "test", ".dolphy/ids.d.ts"]',
    '}',
  ]);

export const manifestJson = (id: string): string => `{
  "id": "${id}",
  "version": "${INITIAL_VERSION}",
  "apiVersion": 1,
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

export const readme = (id: string): string =>
  lines([
    `# ${id}`,
    '',
    'A Dolphy extension: the "text match" exercise type (the learner types a',
    'string, it is compared with `spec.expected`), a setting and a command.',
    'Generated by `create-dolphy-extension`.',
    '',
    '## Layout',
    '',
    '- `extension.json` — the manifest (the `spec` and answer schemas are written',
    '  in it);',
    '- `src/index.ts` — all the extension code: `host` (`defineExtension` +',
    '  `defineExerciseType`) and `views` (`defineAnswerView`); the build splits',
    '  it into `main.mjs` and `view.mjs`;',
    '- `.dolphy/ids.d.ts` — generated from `extension.json` by',
    '  `dolphy-ext types` (and by every build): the ids the manifest declares,',
    '  as TypeScript types. Not committed. A misspelt id, a declared id without',
    '  a handler or a view, or `ctx.settings.get` of an undeclared setting fails',
    '  `pnpm typecheck`;',
    '- `test/index.test.ts` — tests (`vitest`, `happy-dom`).',
    '',
    '## Development loop',
    '',
    '```sh',
    'pnpm install',
    `pnpm dev # dolphy-ext build --watch: rebuilds into dist-ext/${id}`,
    '```',
    '',
    'Start the app with the developer root pointing at the `dist-ext` directory',
    'of this project (an absolute path):',
    '',
    '```sh',
    'DOLPHY_DEV_EXTENSIONS=<path to the project>/dist-ext pnpm dev # from the Dolphy repository',
    '```',
    '',
    'A change to a file in `dist-ext` is applied live: the window does not',
    'reload, mounted answer inputs are recreated. Load errors are shown in',
    '"Settings → Extensions".',
    '',
    '## Build, check, test',
    '',
    '```sh',
    `pnpm build      # dist-ext/${id}`,
    'pnpm validate   # the same manifest parsing the app does',
    'pnpm typecheck  # writes .dolphy/ids.d.ts, then tsc',
    'pnpm test',
    '```',
    '',
    '## Manual installation',
    '',
    `Copy the \`dist-ext/${id}\` directory to \`<userData>/extensions/\``,
    'and restart the app. There is no installation from the app yet.',
  ]);

export const gitignore = (): string =>
  lines(['node_modules', 'dist-ext', '.dolphy']);
