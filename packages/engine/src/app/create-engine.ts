import type { EngineConfig, LearningEngine } from '@lms/engine-contract';
import { createCommandQueue } from './command-queue.ts';
import { createContext } from './create-context.ts';
import type { EngineContext, EngineDeps } from './context.ts';
import { collectDiagnostics } from './diagnostics.ts';
import { createFacade } from './facade.ts';
import type { EngineServices } from './facade.ts';
import { createCurationService } from './services/curation.ts';
import { createLibraryService } from './services/library.ts';
import { createPlacementService } from './services/placement.ts';
import { createPlanService } from './services/plan.ts';
import { createPracticeService } from './services/practice.ts';
import { createRemediationService } from './services/remediation.ts';
import {
  createRepositoriesService,
  recoverRepositories,
} from './services/repositories.ts';
import { createSettingsService } from './services/settings.ts';
import { createSyncService } from './services/sync.ts';

/** Сервисы и фасад над готовым контекстом (тесты собирают контекст сами). */
export const createEngineFromContext = (ctx: EngineContext): LearningEngine => {
  // одна очередь на фасад и на `repositories`: подмена снимка — обычная команда
  const queue = createCommandQueue();
  const closing = new AbortController();
  const library = createLibraryService(ctx);
  const services: EngineServices = {
    library,
    repositories: createRepositoriesService(ctx, {
      library,
      exclusive: queue.enqueue,
      closeSignal: closing.signal,
    }),
    practice: createPracticeService(ctx),
    curation: createCurationService(ctx),
    settings: createSettingsService(ctx),
    sync: createSyncService(ctx),
    plan: createPlanService(ctx),
    placement: createPlacementService(ctx),
    remediation: createRemediationService(ctx),
  };
  const facade = createFacade(
    ctx,
    services,
    async () => collectDiagnostics(ctx),
    queue,
  );
  return {
    ...facade,
    close: () => {
      const closed = facade.close();
      closing.abort(); // долгая загрузка не должна держать закрытие
      return closed;
    },
  };
};

/**
 * Корень композиции (engine-ts.md §4): восстановление снимков
 * репозиториев → контекст (библиотека → проекции → настройки → перестройка из
 * журнала) и фасад над сервисами. Порты и адаптеры приходят снаружи;
 * `close()` движка закрывает верификаторы и хранилище.
 * Если открытие не удалось, адаптеры остаются открытыми — их закрывает
 * вызывающий.
 */
export const createEngine = async (
  deps: EngineDeps,
  config: EngineConfig,
): Promise<LearningEngine> => {
  // до первой загрузки библиотеки: сканер не должен видеть остатки прерванной операции
  await recoverRepositories(deps);
  return createEngineFromContext(await createContext(deps, config));
};
