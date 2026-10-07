// Хук `practice.batch` переворачивает порядок упражнений и причин; исходный
// порядок и число вызовов остаются в хранилище для проверки.
import { defineServer } from '@dolphy-app/extension-sdk';

export const server = defineServer((s) => {
  s.before('practice.batch', async ({ exerciseIds, reasons }) => {
    const calls = (await s.storage.get<number>('calls')) ?? 0;
    await s.storage.set('calls', calls + 1);
    await s.storage.set('original', exerciseIds);
    return {
      exerciseIds: exerciseIds.toReversed(),
      reasons: reasons.toReversed(),
    };
  });
});
