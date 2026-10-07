// Серверная часть: обработчик RPC и команда, которая открывает панель с новыми свойствами.
import { defineServer, openPanel } from '@dolphy-app/extension-sdk';
import { greetRpc } from './shared/rpc.ts';

export const server = defineServer((s) => {
  let round = 0;
  s.handle(greetRpc, ({ name }) => ({ text: `Привет, ${name}!` }));
  s.registerCommand({
    id: 'acme.react.reopen',
    title: 'Открыть React-панель с новым раундом',
    run: () => {
      round += 1;
      return openPanel('acme.react.main', { round });
    },
  });
});
