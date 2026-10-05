import { PiniaColada, useQueryCache } from '@pinia/colada';
import { createPinia } from 'pinia';
import type { App } from 'vue';
import type { LearningEngine } from '@dolphy-app/engine-contract';
import {
  bindRepositoryPreviews,
  invalidateRepositoryPreviews,
} from '@/entities/repository';

export interface DolphyQuery {
  /** Подключает Pinia и Pinia Colada; кэш предпросмотров начинает слушать события движка. */
  install(app: App): void;
  /** События за время обрыва связи с движком могли потеряться: кэш предпросмотров сбрасывается. */
  reconnected(): void;
}

/**
 * Кэш данных окна: Pinia + Pinia Colada. Свежесть и сброс каждого запроса
 * описывает его модуль (сейчас — предпросмотр репозиториев,
 * `entities/repository/api`).
 */
export const createDolphyQuery = (engine: LearningEngine): DolphyQuery => {
  const pinia = createPinia();
  return {
    install: (app) => {
      app.use(pinia).use(PiniaColada, {
        plugins: [
          ({ queryCache }) => void bindRepositoryPreviews(engine, queryCache),
        ],
      });
    },
    reconnected: () => void invalidateRepositoryPreviews(useQueryCache(pinia)),
  };
};
