import { defineRpc } from '@dolphy-app/extension-sdk';
import { z } from 'zod';

export const sayHello = defineRpc({
  name: 'acme.rpc.hello',
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
});

export const server = (s) => {
  s.handle(sayHello, ({ name }) => ({ greeting: `Hello, ${name}` }));
};
