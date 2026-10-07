// Контракты, общие для серверной и клиентской частей.
import { defineRpc } from '@dolphy-app/extension-sdk';
import { z } from 'zod';

const grade = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const greetRpc = defineRpc({
  name: 'direct.greet',
  input: z.object({ name: z.string().min(1) }),
  output: z.object({ text: z.string() }),
});

export const failRpc = defineRpc({
  name: 'direct.fail',
  input: z.object({}),
  output: z.object({}),
});

export const countRpc = defineRpc({
  name: 'direct.count',
  input: z.object({}),
  output: z.object({ greeted: z.number() }),
});

export const coursesRpc = defineRpc({
  name: 'direct.courses',
  input: z.object({}),
  output: z.object({ names: z.array(z.string()) }),
});

export const recordRpc = defineRpc({
  name: 'direct.record',
  input: z.object({ exerciseId: z.string(), grade }),
  output: z.object({ eventId: z.string() }),
});
