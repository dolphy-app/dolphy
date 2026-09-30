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
