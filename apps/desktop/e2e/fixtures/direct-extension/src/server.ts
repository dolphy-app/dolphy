// Серверная часть: обработчики `defineRpc`, которые читают и пишут через `s.engine`.
import { defineServer } from '@dolphy-app/extension-sdk';
import {
  coursesRpc,
  countRpc,
  failRpc,
  greetRpc,
  recordRpc,
} from './shared/rpc.ts';

export const server = defineServer((s) => {
  let greeted = 0;

  s.handle(greetRpc, ({ name }) => {
    greeted += 1;
    return { text: `Привет, ${name}!` };
  });

  s.handle(countRpc, () => ({ greeted }));

  s.handle(failRpc, () => {
    throw new Error('кубик сломан');
  });

  s.handle(coursesRpc, async () => {
    const page = await s.engine.library.listCourses();
    return { names: page.items.map(({ name }) => name) };
  });

  s.handle(recordRpc, async ({ exerciseId, grade }) => {
    const result = await s.engine.practice.recordAttempt({
      requestId: `acme.direct.server.${Date.now()}`,
      exerciseId,
      grade,
    });
    return { eventId: result.eventId };
  });
});
