import {
  defineAnswerView,
  defineExerciseType,
  defineExtension,
} from '@dolphy-app/extension-sdk';
import type { ExtensionViews } from '@dolphy-app/extension-sdk';
import { createChildRunner } from './child-runner.ts';
import type { ChildRunner } from './child-runner.ts';
import { grade, project } from './grade.ts';
import type { JsSpec, JsView } from './grade.ts';
import { mountJsEditor } from './js-view.ts';

// обработчики регистрируются до `activate`, раннер создаётся в нём
const holder: { runner?: ChildRunner } = {};

const requireRunner = (): ChildRunner => {
  if (holder.runner === undefined) {
    throw new Error('dolphy.js extension is not activated');
  }
  return holder.runner;
};

// схема манифеста уже проверила форму `spec` и ответа; `grade` перепроверяет
// то, что схема выразить не может, и отдаёт ошибки автора как `error`
export const host = defineExtension({
  exerciseTypes: {
    'dolphy.js': defineExerciseType<JsSpec, unknown, JsView>({
      project: ({ spec }) => project(spec),
      grade: ({ spec, answer, timeoutMs, authorMode }) =>
        grade(requireRunner(), { spec, answer, timeoutMs, authorMode }),
      referenceAnswer: ({ spec }) =>
        typeof spec.reference === 'string' && spec.reference !== ''
          ? spec.reference
          : undefined,
    }),
  },
  activate() {
    holder.runner = createChildRunner();
  },
  async deactivate() {
    const { runner } = holder;
    delete holder.runner;
    await runner?.close();
  },
});

export const views = {
  'dolphy.js': defineAnswerView(mountJsEditor),
} satisfies ExtensionViews;
