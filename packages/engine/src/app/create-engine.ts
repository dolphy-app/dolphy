import type { EngineConfig, LearningEngine } from '@dolphy-app/engine-contract';
import { createCommandQueue } from './command-queue.ts';
import { createContext } from './create-context.ts';
import type { EngineContext, EngineDeps } from './context.ts';
import { collectDiagnostics } from './diagnostics.ts';
import { createFacade } from './facade.ts';
import type { EngineServices } from './facade.ts';
import type { LearningEventListener } from './event-bus.ts';
import { createExtensionHostServices } from './services/extension-host-services.ts';
import type { ExtensionHostServices } from './services/extension-host-services.ts';
import { createCurationService } from './services/curation.ts';
import {
  createExtensionsService,
  runStartupUpdateCheck,
} from './services/extensions.ts';
import { createLibraryService } from './services/library.ts';
import { createPlacementService } from './services/placement.ts';
import { createPlanService } from './services/plan.ts';
import { createPracticeService } from './services/practice.ts';
import { createRemediationService } from './services/remediation.ts';
import {
  createRepositoriesService,
  recoverRepositories,
  runStartupRepositoryCheck,
} from './services/repositories.ts';
import { createSettingsService } from './services/settings.ts';
import { createSyncService } from './services/sync.ts';

/**
 * Движок для процесса-хоста: контракт `LearningEngine` плюс то, чего в нём
 * нет, потому что окно этого не вызывает.
 */
export interface HostedEngine extends LearningEngine {
  /**
   * Применяет изменения расширений на диске без команды окна (режим
   * разработчика): перечитывает набор, публикует `contributions-changed`.
   * Не бросает; после `close()` ничего не делает.
   */
  reloadExtensions(): Promise<void>;
  /**
   * Данные расширений для хоста расширений (хранилище, значения настроек,
   * подписка на их изменение). Не часть контракта окна и не RPC.
   */
  readonly extensionHost: ExtensionHostServices;
  /**
   * Внутренний приёмник событий обучения (`session.started`, `session.finished`,
   * `attempt.closed`): доставка после завершения команды, не раньше; отменённая
   * или упавшая команда событий не даёт. Слушатель не ждётся, его сбой
   * логируется и на команду не влияет. Возвращает отписку.
   */
  onLearningEvent(listener: LearningEventListener): () => void;
}

/** Сервисы и фасад над готовым контекстом (тесты собирают контекст сами). */
export const createEngineFromContext = (ctx: EngineContext): HostedEngine => {
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
    extensions: createExtensionsService(ctx),
  };
  // фоновая проверка обновлений: запуск не ждёт её и не зависит от её исхода
  void runStartupUpdateCheck(ctx);
  void runStartupRepositoryCheck(ctx, services.repositories);
  const facade = createFacade(
    ctx,
    services,
    async () => collectDiagnostics(ctx),
    queue,
  );
  return {
    ...facade,
    reloadExtensions: () => ctx.extensionApply.reload(),
    extensionHost: createExtensionHostServices(ctx),
    onLearningEvent: ctx.bus.subscribeLearning,
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
): Promise<HostedEngine> => {
  // до первой загрузки библиотеки: сканер не должен видеть остатки прерванной операции
  await recoverRepositories(deps);
  return createEngineFromContext(await createContext(deps, config));
};
