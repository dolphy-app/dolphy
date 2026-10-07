import { createExtensionHealth } from '@dolphy-app/engine/app';
import { createMemoryExtensionDataStore } from '@dolphy-app/engine/node';
import type {
  JsonValue,
  LearningEvent,
  ExtensionSettingChangeDto,
} from '@dolphy-app/engine-contract';
import type {
  ExtensionCommands,
  ExtensionHealth,
  ExtensionPolicy,
  ExtensionTransfers,
} from '@dolphy-app/engine/ports';
import type { SettingDefinition } from '@dolphy-app/extension-api';
import { connectEngine } from '../src/engine-bridge.ts';
import type { HostableEngine } from '../src/engine-bridge.ts';
import { createHostChannel } from '../src/channel.ts';
import type { HostChannel } from '../src/channel.ts';
import {
  createRemoteExtensionCommands,
  createRemoteExtensionTransfers,
} from '../src/client.ts';
import type { ExtensionCandidate } from '../src/discover.ts';
import type { ReplaceExtensionsResult } from '../src/protocol.ts';
import { createDiscoveryHolder, discoveryOf } from '../src/holder.ts';
import type { DiscoveryHolder } from '../src/holder.ts';
import { createEndpointPair } from '../src/loopback.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import { createExtensionRuntime } from '../src/runtime.ts';
import type { ExtensionRuntime, ServerModule } from '../src/runtime.ts';
import { createLogger, deferred } from './helpers.ts';
import type { TestLogger } from './helpers.ts';

/** Настройки расширения с состоянием: строка, целое число и список; регистрирует `server.registerSettings`. */
export const statefulSettings = (id: string): SettingDefinition[] => [
  {
    id: `${id}.greeting`,
    type: 'string',
    label: 'Greeting',
    default: 'hello',
    maxLength: 20,
  },
  {
    id: `${id}.limit`,
    type: 'number',
    label: 'Limit',
    default: 3,
    min: 1,
    max: 10,
    integer: true,
  },
  {
    id: `${id}.tags`,
    type: 'list',
    label: 'Tags',
    default: ['a'],
    maxItems: 5,
    itemMaxLength: 10,
  },
];

export const attemptClosed = (exerciseId: string): LearningEvent => ({
  name: 'attempt.closed',
  payload: {
    exerciseId,
    courseId: 'c',
    lessonId: 'l',
    grade: 4,
    outcome: 'passed',
    source: 'self',
    at: 1,
  },
});

export const sessionStarted = (sessionId: string): LearningEvent => ({
  name: 'session.started',
  payload: { sessionId, at: 1 },
});

/** Движок-заглушка: настоящее хранилище с потолками (память), значения настроек и подписчики. */
export interface StubEngine extends HostableEngine {
  readonly disabled: Set<string>;
  /** Системное хранилище ключей заглушки: `false` — секреты недоступны, как на Linux с `basic_text`. */
  keyStore: { available: boolean };
  /** Здоровье, в которое хост пишет сообщения `health.report`. */
  readonly health: ExtensionHealth;
  emit(event: LearningEvent): void;
  changeSetting(change: ExtensionSettingChangeDto): void;
  /** Значение хранилища расширения напрямую, минуя канал. */
  read(extensionId: string, key: string): Promise<JsonValue | undefined>;
  /** Шифртекст секрета напрямую, минуя канал. */
  readSecret(extensionId: string, key: string): Promise<JsonValue | undefined>;
  /** Сколько запросов хоста принято (все методы). */
  readonly requests: string[];
  /** Уведомления, как их получила служба движка: расширение, название, текст. */
  readonly notified: { extensionId: string; title: string; body: string }[];
  /** Ответ `notifications.show` заглушки: `false` — переключатель выключен или ОС не поддерживает. */
  notifier: { shown: boolean };
  /** Запросы статистики, как их получила служба движка: расширение, метод, аргументы. */
  readonly statsCalls: {
    extensionId: string;
    method: string;
    args: unknown[];
  }[];
}

const unavailable = () =>
  Object.assign(new Error('System secret store is unavailable'), {
    code: 'SECRETS_UNAVAILABLE',
  });

export const createStubEngine = (): StubEngine => {
  const data = createMemoryExtensionDataStore();
  const disabled = new Set<string>();
  const overrides = new Map<string, Record<string, JsonValue>>();
  const learning = new Set<(event: LearningEvent) => void>();
  const changes = new Set<(change: ExtensionSettingChangeDto) => void>();
  const requests: string[] = [];
  const statsCalls: StubEngine['statsCalls'] = [];
  const notified: StubEngine['notified'] = [];
  const notifier = { shown: true };
  const keyStore = { available: true };
  const health = createExtensionHealth({ now: () => Date.now() });
  const active = (method: string, extensionId: string): string => {
    requests.push(`${method}:${extensionId}`);
    if (disabled.has(extensionId)) {
      throw Object.assign(new Error(`Extension '${extensionId}' is disabled`), {
        code: 'INVALID_ARGUMENT',
        details: { reason: 'disabled', extensionId },
      });
    }
    return extensionId;
  };
  return {
    disabled,
    health,
    requests,
    statsCalls,
    notified,
    notifier,
    keyStore,
    extensionHost: {
      // шифр заглушки — base64; настоящую службу с потолками проверяют тесты движка
      secrets: {
        get: async (id, key) => {
          const stored = await data.secrets.get(active('secrets.get', id), key);
          if (stored !== undefined && !keyStore.available) throw unavailable();
          return stored === undefined
            ? undefined
            : Buffer.from(stored as string, 'base64').toString();
        },
        set: async (id, key, value) => {
          active('secrets.set', id);
          if (!keyStore.available) throw unavailable();
          await data.secrets.set(
            id,
            key,
            Buffer.from(value).toString('base64'),
          );
        },
        delete: async (id, key) =>
          data.secrets.delete(active('secrets.delete', id), key),
      },
      storage: {
        get: async (id, key) => data.storage.get(active('get', id), key),
        set: async (id, key, value) =>
          data.storage.set(active('set', id), key, value),
        delete: async (id, key) =>
          data.storage.delete(active('delete', id), key),
        keys: async (id) => data.storage.keys(active('keys', id)),
      },
      settings: {
        all: async (id) => ({ ...overrides.get(active('settings', id)) }),
      },
      notifications: {
        show: async (id, title, body) => {
          notified.push({
            extensionId: active('notifications.show', id),
            title,
            body,
          });
          return notifier.shown;
        },
      },
      stats: {
        streak: async (id, ...args) => {
          statsCalls.push({
            extensionId: active('stats.streak', id),
            method: 'streak',
            args: args.filter((arg) => arg !== undefined),
          });
          return { current: 3, longest: 7 };
        },
        daily: async (id, from, to, ...rest) => {
          statsCalls.push({
            extensionId: active('stats.daily', id),
            method: 'daily',
            args: [from, to, ...rest.filter((arg) => arg !== undefined)],
          });
          return [{ date: from, attempts: 2, correct: 1, accuracy: 0.5 }];
        },
      },
      health: {
        activated: (id, durationMs) => health.recordActivation(id, durationMs),
        failed: (id, reason, message) =>
          health.recordFailure(id, reason, message),
        suppressed: (id, until) => health.recordSuppression(id, until),
        reset: (id) => health.forget(id),
      },
      onSettingChanged(listener) {
        changes.add(listener);
        return () => void changes.delete(listener);
      },
    },
    onLearningEvent(listener) {
      learning.add(listener);
      return () => void learning.delete(listener);
    },
    emit(event) {
      for (const listener of [...learning]) listener(event);
    },
    changeSetting(change) {
      overrides.set(change.extensionId, {
        ...overrides.get(change.extensionId),
        [change.id]: change.value,
      });
      for (const listener of [...changes]) listener(change);
    },
    read: (extensionId, key) => data.storage.get(extensionId, key),
    readSecret: (extensionId, key) => data.secrets.get(extensionId, key),
  };
};

export interface HarnessOptions {
  /** Найденные расширения; регистрируется то, что делает `server` каждого. */
  candidates: readonly ExtensionCandidate[];
  /** Серверные части в процессе хоста: экспорт `server` вместо `main.mjs`. */
  modules?: Record<string, ServerModule>;
  queueLimit?: number;
  deliveryMs?: number;
  restart?: () => void;
  /** Часы и период планировщика расписаний. */
  schedule?: { now?: () => number; tickMs?: number };
}

export interface Harness {
  engine: StubEngine;
  runtime: ExtensionRuntime;
  channel: HostChannel;
  discovery: DiscoveryHolder;
  policy: ExtensionPolicy;
  /** Клиент команд движка поверх того же канала. */
  commands: ExtensionCommands;
  /** Клиент импорта и экспорта движка поверх того же канала. */
  transfers: ExtensionTransfers;
  logger: TestLogger;
  /** Меняет набор расширений так же, как применение изменений: снимок движка и регистрация в хосте. */
  replace(
    candidates: readonly ExtensionCandidate[],
  ): Promise<ReplaceExtensionsResult>;
  close(): Promise<void>;
}

/**
 * Движок ↔ канал ↔ хост расширений через loopback: тот же путь, что и боевой.
 * Завершается, когда хост ответил регистрациями на первое подключение.
 */
export const createHarness = async (
  options: HarnessOptions,
): Promise<Harness> => {
  const logger = createLogger();
  const engine = createStubEngine();
  const discovery = createDiscoveryHolder(discoveryOf(options.candidates));
  const policy = createExtensionPolicy(discovery);
  policy.update({
    disabled: [],
    checkUpdates: true,
    safeMode: false,
    notificationsOff: [],
    catalogUrl: null,
    schedulesOff: [],
  });
  const runtime = createExtensionRuntime({
    library: { readText: async () => '', stat: async () => null },
    logger,
    ...(options.modules !== undefined && { modules: options.modules }),
  });
  const first = deferred();
  const channel = createHostChannel({
    logger,
    currentExtensions: () => discovery.get().candidates,
    onRegistrations: (result) => {
      discovery.applyRegistrations(result);
      first.resolve();
    },
    ...(options.restart !== undefined && { restart: options.restart }),
  });
  const [engineSide, hostSide] = createEndpointPair();
  runtime.attach(hostSide);
  channel.attach(engineSide);
  await first.promise;
  const disconnect = connectEngine({
    channel,
    engine,
    discovery,
    policy,
    logger,
    health: engine.health,
    ...(options.queueLimit !== undefined && { queueLimit: options.queueLimit }),
    ...(options.deliveryMs !== undefined && { deliveryMs: options.deliveryMs }),
    ...(options.schedule !== undefined && { schedule: options.schedule }),
  });
  return {
    engine,
    runtime,
    channel,
    commands: createRemoteExtensionCommands({ channel, logger }),
    transfers: createRemoteExtensionTransfers({ channel, logger }),
    discovery,
    policy,
    logger,
    async replace(candidates) {
      discovery.replace(discoveryOf(candidates));
      const result = await channel.replaceExtensions(candidates);
      discovery.applyRegistrations(result);
      return result;
    },
    async close() {
      disconnect();
      await channel.close();
      await runtime.dispose();
    },
  };
};
