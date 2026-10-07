// Контракт, общий для серверной и клиентской частей.
import { defineRpc } from '@dolphy-app/extension-sdk';
import { z } from 'zod';

export const greetRpc = defineRpc({
  name: 'react.greet',
  input: z.object({ name: z.string().min(1) }),
  output: z.object({ text: z.string() }),
});
