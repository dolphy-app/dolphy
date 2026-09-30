import type { ExtensionModule } from '@spirula-app/extension-api';

const extension: ExtensionModule = {
  activate: (context) => {
    context.registerExerciseType('acme.hello', {
      project: () => ({}),
      grade: ({ spec, answer }) =>
        answer === (spec as { expected: string }).expected
          ? { outcome: 'passed' }
          : { outcome: 'failed', reason: 'mismatch' },
    });
  },
};

export default extension;
