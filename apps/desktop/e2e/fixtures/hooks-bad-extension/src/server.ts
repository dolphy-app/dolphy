// Хук `practice.batch` отвечает несуществующим упражнением.
import { defineServer } from '@dolphy-app/extension-sdk';

export const server = defineServer((s) => {
  s.before('practice.batch', () => ({
    exerciseIds: ['missing_kb::basic::q1'],
    reasons: ['new'],
  }));
});
