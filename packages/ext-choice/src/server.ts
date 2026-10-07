import { defineExerciseType, defineServer } from '@dolphy-app/extension-sdk';
import { grade, project } from './grade.ts';
import type { ChoiceSpec, ChoiceView } from './grade.ts';
import { answerSchema, specSchema } from './schema.ts';

// the schemas have already checked `spec` and the answer before the handlers run
export const server = defineServer((s) => {
  s.registerExerciseType(
    defineExerciseType<ChoiceSpec, number[], ChoiceView>({
      id: 'dolphy.choice',
      title: { en: 'Multiple choice', ru: 'Выбор из вариантов' },
      specSchema,
      answerSchema,
      project: ({ spec }) => project(spec),
      grade: ({ spec, answer, authorMode }) => grade(spec, answer, authorMode),
      referenceAnswer: ({ spec }) => spec.correct,
    }),
  );
});
