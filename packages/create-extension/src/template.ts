import { defaultElementName } from '@dolphy-app/extension-api';

/** Версия расширения в шаблоне и его умолчание для `apiVersion`. */
const INITIAL_VERSION = '0.1.0';

export interface TemplateInput {
  id: string;
  /** Спецификаторы зависимостей на SDK и инструменты (см. `dependencySpecs`). */
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
    '  "include": ["src", "test"]',
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
    ]
  }
}
`;

export const mainTs = (
  id: string,
): string => `import { defineExerciseType, defineExtension } from '@dolphy-app/extension-sdk';

interface Spec {
  expected: string;
  ignoreCase?: boolean;
}

const matches = (answer: string, spec: Spec): boolean => {
  if (spec.ignoreCase === true) {
    return answer.toLowerCase() === spec.expected.toLowerCase();
  }
  return answer === spec.expected;
};

// схемы из extension.json уже проверили spec и ответ до вызова обработчиков
export default defineExtension({
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
});
`;

export const viewTs = (
  id: string,
): string => `import { defineAnswerElement } from '@dolphy-app/extension-sdk';

defineAnswerElement('${defaultElementName(id)}', (api, initial) => {
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
      // value применяется, только когда приложение его действительно сменило
      if (props.value !== appliedValue) {
        appliedValue = props.value;
        applyValue(appliedValue);
      }
    },
  };
});
`;

export const mainTestTs = (id: string): string => `import {
  createSchemaValidator,
  loadExerciseType,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import manifest from '../extension.json';
import module from '../src/main.ts';

const [contribution] = manifest.contributes.exerciseTypes;
const validateSpec = createSchemaValidator(contribution.specSchema);
const validateAnswer = createSchemaValidator(contribution.answerSchema);

const spec = { expected: 'Hello' };

const disposables: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

const load = async () => {
  const type = await loadExerciseType(module, '${id}');
  disposables.push(type);
  return type;
};

describe('${id}: обработчик', () => {
  it('project не раскрывает эталон', async () => {
    const type = await load();
    expect(await type.project(spec)).toEqual({});
  });

  it('grade: совпадение засчитывается, расхождение нет', async () => {
    const type = await load();
    expect(await type.grade({ spec, answer: 'Hello' })).toEqual({
      outcome: 'passed',
    });
    expect(await type.grade({ spec, answer: 'hello' })).toEqual({
      outcome: 'failed',
      reason: 'mismatch',
    });
  });

  it('grade: ignoreCase отключает различие регистров', async () => {
    const type = await load();
    const relaxed = { ...spec, ignoreCase: true };
    expect(await type.grade({ spec: relaxed, answer: 'hELLO' })).toEqual({
      outcome: 'passed',
    });
  });

  it('referenceAnswer сам проходит проверку', async () => {
    const type = await load();
    const reference = await type.referenceAnswer(spec);
    expect(reference).toEqual({ found: true, answer: 'Hello' });
    if (!reference.found) throw new Error('reference expected');
    expect(await type.grade({ spec, answer: reference.answer })).toEqual({
      outcome: 'passed',
    });
  });
});

describe('${id}: схемы', () => {
  it.each([[{ expected: 'a' }], [{ expected: 'a', ignoreCase: true }]])(
    'spec %j допустим',
    (value) => {
      expect(validateSpec(value)).toEqual([]);
    },
  );

  it.each([
    ['нет expected', {}],
    ['пустой expected', { expected: '' }],
    ['ignoreCase не boolean', { expected: 'a', ignoreCase: 'yes' }],
    ['лишнее поле', { expected: 'a', extra: 1 }],
  ])('spec: %s отклоняется', (_name, value) => {
    expect(validateSpec(value)).not.toEqual([]);
  });

  it('answer: строка допустима, число нет', () => {
    expect(validateAnswer('text')).toEqual([]);
    expect(validateAnswer(42)).not.toEqual([]);
  });
});
`;

export const viewTestTs = (id: string): string => {
  const tag = defaultElementName(id);
  return `// @vitest-environment happy-dom
import { ANSWER_EVENT } from '@dolphy-app/extension-sdk';
import type { AnswerChangeDetail } from '@dolphy-app/extension-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import '../src/view.ts';

interface AnswerElement extends HTMLElement {
  view: unknown;
  value: unknown;
  disabled: boolean;
}

const flush = () => Promise.resolve();

const mountElement = async (label: string | null = null) => {
  const element = document.createElement('${tag}') as AnswerElement;
  if (label !== null) element.setAttribute('aria-label', label);
  document.body.append(element);
  await flush();
  const changes: AnswerChangeDetail[] = [];
  element.addEventListener(ANSWER_EVENT.change, (event) => {
    changes.push((event as CustomEvent<AnswerChangeDetail>).detail);
  });
  const input = element.shadowRoot?.querySelector('input');
  if (input === null || input === undefined) throw new Error('no input');
  return { element, input, changes };
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('${tag}', () => {
  it('ввод текста сообщает ответ; пустой ввод неполный', async () => {
    const { input, changes } = await mountElement();
    input.value = 'Hello';
    input.dispatchEvent(new Event('input'));
    input.value = '  ';
    input.dispatchEvent(new Event('input'));
    expect(changes).toEqual([
      { value: 'Hello', complete: true },
      { value: '  ', complete: false },
    ]);
  });

  it('Enter отправляет ответ', async () => {
    const { element, input } = await mountElement();
    let submits = 0;
    element.addEventListener(ANSWER_EVENT.submit, () => void (submits += 1));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(submits).toBe(1);
  });

  it('disabled блокирует поле', async () => {
    const { element, input } = await mountElement();
    element.disabled = true;
    await flush();
    expect(input.disabled).toBe(true);
  });

  it('value восстанавливает ответ без событий', async () => {
    const { element, input, changes } = await mountElement();
    element.value = 'Hello';
    await flush();
    expect(input.value).toBe('Hello');
    expect(changes).toEqual([]);
  });

  it('aria-label хоста попадает на поле', async () => {
    const { input } = await mountElement('Ваш ответ');
    expect(input.getAttribute('aria-label')).toBe('Ваш ответ');
  });
});
`;
};

export const readme = (id: string): string =>
  lines([
    `# ${id}`,
    '',
    'Расширение Dolphy: вид задания «text match» (ученик вводит строку, она',
    'сравнивается с `spec.expected`). Сгенерировано `create-dolphy-extension`.',
    '',
    '## Раскладка',
    '',
    '- `extension.json` — манифест (схемы `spec` и ответа записаны прямо в нём);',
    '- `src/main.ts` — код расширения: `defineExtension` + `defineExerciseType`;',
    '- `src/view.ts` — элемент ввода ответа: `defineAnswerElement`;',
    '- `test/` — тесты обработчика и элемента (`vitest`, `happy-dom`).',
    '',
    '## Цикл разработки',
    '',
    '```sh',
    'pnpm install',
    `pnpm dev # dolphy-ext build --watch: пересборка в dist-ext/${id}`,
    '```',
    '',
    'Запустите приложение с корнем режима разработчика — каталогом `dist-ext`',
    'этого проекта (абсолютный путь):',
    '',
    '```sh',
    'DOLPHY_DEV_EXTENSIONS=<путь к проекту>/dist-ext pnpm dev # из репозитория Dolphy',
    '```',
    '',
    'Правка файла в `dist-ext` применяется на лету: окно не перезагружается,',
    'смонтированные элементы ввода пересоздаются.',
    'Ошибки загрузки видны в «Настройки → Расширения».',
    '',
    '## Сборка, проверка, тесты',
    '',
    '```sh',
    `pnpm build     # dist-ext/${id}`,
    'pnpm validate  # тот же разбор манифеста, что делает приложение',
    'pnpm test',
    '```',
    '',
    '## Установка вручную',
    '',
    `Скопируйте каталог \`dist-ext/${id}\` в \`<userData>/extensions/\``,
    'и перезапустите приложение. Установки из приложения пока нет.',
  ]);

export const gitignore = (): string => lines(['node_modules', 'dist-ext']);
