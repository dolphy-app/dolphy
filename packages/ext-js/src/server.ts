import { defineExerciseType, defineServer } from '@dolphy-app/extension-sdk';
import { createChildRunner } from './child-runner.ts';
import { grade, project } from './grade.ts';
import type { JsSpec, JsView } from './grade.ts';
import { answerSchema, specSchema } from './schema.ts';

// схема уже проверила форму `spec` и ответа; `grade` перепроверяет то, что
// схема выразить не может, и отдаёт ошибки автора как `error`
export const server = defineServer((s) => {
  const runner = createChildRunner();

  s.registerExerciseType(
    defineExerciseType<JsSpec, unknown, JsView>({
      id: 'dolphy.js',
      title: { en: 'JavaScript code', ru: 'Код на JavaScript' },
      specSchema,
      answerSchema,
      project: ({ spec }) => project(spec),
      grade: ({ spec, answer, timeoutMs, authorMode }) =>
        grade(runner, { spec, answer, timeoutMs, authorMode }),
      referenceAnswer: ({ spec }) =>
        typeof spec.reference === 'string' && spec.reference !== ''
          ? spec.reference
          : undefined,
    }),
  );

  return () => runner.close();
});
