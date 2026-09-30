import type { ExtensionModule } from '@lms/extension-api';
import { grade, project } from './grade.ts';
import type { ChoiceSpec } from './grade.ts';

// схемы манифеста уже проверили `spec` и `answer` до вызова обработчиков
const module: ExtensionModule = {
  activate(context) {
    context.registerExerciseType('lms.choice', {
      project: ({ spec }) => project(spec as ChoiceSpec),
      grade: ({ spec, answer, authorMode }) =>
        grade(spec as ChoiceSpec, answer as number[], authorMode),
      referenceAnswer: ({ spec }) => (spec as ChoiceSpec).correct,
    });
  },
};

export default module;
