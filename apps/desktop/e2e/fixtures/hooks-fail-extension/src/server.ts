// Хук `session.start` отменяет старт любой сессии.
import { defineServer } from '@dolphy-app/extension-sdk';

export const server = defineServer((s) => {
  s.before('session.start', () => {
    throw new Error('сессии запрещены в фокус-время');
  });
});
