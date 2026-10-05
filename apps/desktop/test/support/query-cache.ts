import { PiniaColada, useQueryCache } from '@pinia/colada';
import type { QueryCache } from '@pinia/colada';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

/** Кэш Pinia Colada вне окна: свежий `pinia` на каждый вызов, как у приложения (`app/providers/query.ts`). */
export const createTestQueryCache = (): QueryCache => {
  const pinia = createPinia();
  createApp({}).use(pinia).use(PiniaColada);
  return useQueryCache(pinia);
};
