# @lms/extension-sdk

SDK автора расширений («видов заданий»). Всё публичное API `@lms/extension-api`
реэкспортируется отсюда, отдельно ставить его не нужно.

```ts
// main.ts — код расширения (utilityProcess)
import { defineExtension } from '@lms/extension-sdk';
export default defineExtension({
  exerciseTypes: {
    'acme.echo': {
      project: () => ({}),
      grade: ({ spec, answer }) =>
        answer === (spec as { expected: string }).expected
          ? { outcome: 'passed' }
          : { outcome: 'failed', reason: 'mismatch' },
    },
  },
});

// view.ts — элемент ввода ответа (окно приложения)
import { defineAnswerElement } from '@lms/extension-sdk';
defineAnswerElement('acme-echo-answer', (api, props) => {
  const input = document.createElement('input');
  input.oninput = () => api.setAnswer(input.value, input.value.length > 0);
  api.root.append(input);
  return { update: (next) => void (input.disabled = next.disabled) };
});

// main.test.ts — проверка без приложения
import { loadExerciseType } from '@lms/extension-sdk/testing';
const echo = await loadExerciseType(module, 'acme.echo');
await echo.grade({ spec: { expected: '42' }, answer: '42' }); // { outcome: 'passed' }
```

## Вклады без кода и правила оценки

```ts
// main.ts — правило оценки (вклад `gradePolicies`, нужен main)
import { defineExtension } from '@lms/extension-sdk';
export default defineExtension({
  gradePolicies: {
    // 1–5 или null («нужна самооценка»); сбой правила — оценка по passAtN
    'acme.policy.generous': ({ verdicts, gaveUp }) =>
      gaveUp
        ? 1
        : verdicts.some(({ outcome }) => outcome === 'passed')
          ? 5
          : null,
  },
});

// markdown.ts — рендерер содержимого (вклад `markdownRenderers`, main не нужен)
import { defineMarkdownRenderer } from '@lms/extension-sdk';
export default defineMarkdownRenderer((source, container, { language }) => {
  container.textContent = `${language}: ${source}`;
});

// main.test.ts — проверка правила без приложения
import { loadGradePolicy } from '@lms/extension-sdk/testing';
const policy = await loadGradePolicy(module, 'acme.policy.generous');
await policy.evaluate({ verdicts: [{ outcome: 'passed' }], gaveUp: false }); // 5
```

- `defineExtension({ exerciseTypes?, gradePolicies?, activate?, deactivate? })` —
  `gradePolicies` — словарь `id → GradePolicyHandler`; правила регистрируются
  и освобождаются вместе с видами заданий.
- `defineMarkdownRenderer(render)` — `export default` модуля рендерера
  содержимого (`render(source, container, { language, signal })`); при
  исключении приложение оставляет исходный текст блока.
- `loadGradePolicy(module, id)` (`@lms/extension-sdk/testing`) — `evaluate`
  проверяет, что результат — целое 1–5 или `null`.

Темам код не нужен: это данные в `extension.json`. Подробности по всем
точкам вклада — `docs/design/extensions.md`, «Точки вклада».
