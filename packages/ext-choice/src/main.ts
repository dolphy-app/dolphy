import {
  defineExerciseType,
  defineExtension,
} from '@spirula-app/extension-sdk';
import { grade, project } from './grade.ts';
import type { ChoiceSpec } from './grade.ts';

// схемы манифеста уже проверили `spec` и `answer` до вызова обработчиков
export default defineExtension({
  exerciseTypes: {
    'spirula.choice': defineExerciseType<ChoiceSpec, number[], unknown>({
      project: ({ spec }) => project(spec),
      grade: ({ spec, answer, authorMode }) => grade(spec, answer, authorMode),
      referenceAnswer: ({ spec }) => spec.correct,
    }),
  },
});
