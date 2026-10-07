// Серверная часть: два вида заданий, которым окно рисует компоненты.
import { defineExerciseType, defineServer } from '@dolphy-app/extension-sdk';

const exerciseType = (id: string) =>
  defineExerciseType({
    id,
    specSchema: { type: 'object' },
    answerSchema: { type: 'string' },
    project: () => ({}),
    grade: () => ({ outcome: 'passed' as const }),
  });

export const server = defineServer((s) => {
  s.registerExerciseType(exerciseType('acme.runtimeui.ok'));
  s.registerExerciseType(exerciseType('acme.runtimeui.boom'));
});
