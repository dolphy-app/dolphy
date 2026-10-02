import {
  defineAnswerView,
  defineExerciseType,
  defineExtension,
} from '@dolphy-app/extension-sdk';
import type { ExtensionViews } from '@dolphy-app/extension-sdk';
import { mountChoice } from './choice-view.ts';
import { grade, project } from './grade.ts';
import type { ChoiceSpec } from './grade.ts';

// схемы манифеста уже проверили `spec` и `answer` до вызова обработчиков
export const host = defineExtension({
  exerciseTypes: {
    'dolphy.choice': defineExerciseType<ChoiceSpec, number[], unknown>({
      project: ({ spec }) => project(spec),
      grade: ({ spec, answer, authorMode }) => grade(spec, answer, authorMode),
      referenceAnswer: ({ spec }) => spec.correct,
    }),
  },
});

export const views = {
  'dolphy.choice': defineAnswerView(mountChoice),
} satisfies ExtensionViews;
