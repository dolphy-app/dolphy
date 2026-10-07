import type { LearningEvent } from '@dolphy-app/engine-contract';
import type { ExtensionHostServices } from '@dolphy-app/engine/app';
import type {
  ExtensionHealth,
  ExtensionPolicy,
} from '@dolphy-app/engine/ports';
import type { ExtensionLogger } from '@dolphy-app/extension-api';
import type { HostChannel } from './channel.ts';
import { createEventDispatcher } from './event-dispatcher.ts';
import type { DiscoverySource } from './holder.ts';
import { createScheduler } from './scheduler.ts';

/** То, что движок отдаёт хосту расширений (`HostedEngine`). */
export interface HostableEngine {
  readonly extensionHost: ExtensionHostServices;
  onLearningEvent(listener: (event: LearningEvent) => void): () => void;
}

export interface EngineBridgeOptions {
  channel: HostChannel;
  engine: HostableEngine;
  discovery: DiscoverySource;
  policy: ExtensionPolicy;
  logger: ExtensionLogger;
  /** Сюда идут сбои обработчиков событий и расписаний. */
  health?: Pick<ExtensionHealth, 'recordFailure'>;
  /** Часы и период планировщика расписаний (e2e ускоряет их); по умолчанию `Date.now` и 30 с. */
  schedule?: { now?: () => number; tickMs?: number };
}

/**
 * Связывает движок с хостом расширений через канал: хост получает доступ к
 * данным расширений (`server.storage`, `server.settings`), изменения настроек и
 * события обучения уходят к работающим расширениям, а расписания срабатывают
 * по часам планировщика. Возвращает отключение.
 */
export const connectEngine = (options: EngineBridgeOptions): (() => void) => {
  const { channel, engine } = options;
  channel.serve(engine.extensionHost);
  const dispatcher = createEventDispatcher(options);
  const unsubscribeEvents = engine.onLearningEvent(dispatcher.dispatch);
  const scheduler = createScheduler({
    channel,
    discovery: options.discovery,
    policy: options.policy,
    logger: options.logger,
    ...(options.health !== undefined && { health: options.health }),
    ...options.schedule,
  });
  const unsubscribeSettings = engine.extensionHost.onSettingChanged(
    ({ extensionId, id, value }) => {
      // значения настроек — boolean, string, number или список строк; движок проверил их по определению
      if (
        typeof value === 'boolean' ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        (Array.isArray(value) &&
          value.every((item) => typeof item === 'string'))
      ) {
        channel.notify({
          method: 'settingChanged',
          params: { extensionId, id, value },
        });
      }
    },
  );
  return () => {
    scheduler.dispose();
    unsubscribeEvents();
    unsubscribeSettings();
    channel.serve(null);
  };
};
