import { createMemoryExtensionDataStore } from '@dolphy-app/engine/node';
import type {
  JsonValue,
  LearningEvent,
  ExtensionSettingChangeDto,
} from '@dolphy-app/engine-contract';
import type { ExtensionPolicy } from '@dolphy-app/engine/ports';
import type { ExtensionModule } from '@dolphy-app/extension-api';
import { connectEngine } from '../src/engine-bridge.ts';
import type { HostableEngine } from '../src/engine-bridge.ts';
import { createHostChannel } from '../src/channel.ts';
import type { HostChannel } from '../src/channel.ts';
import type { ResolvedExtension } from '../src/discover.ts';
import { createDiscoveryHolder, discoveryOf } from '../src/holder.ts';
import type { DiscoveryHolder } from '../src/holder.ts';
import { createEndpointPair } from '../src/loopback.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import { createExtensionRuntime } from '../src/runtime.ts';
import type { ExtensionRuntime } from '../src/runtime.ts';
import type { RunnerFactory } from '../src/restricted-runner.ts';
import { createLogger } from './helpers.ts';
import type { TestLogger } from './helpers.ts';

/** Расширение с состоянием: разрешение, подписки на события и настройки разных видов. */
export const stateful = (
  id: string,
  overrides: Partial<ResolvedExtension> = {},
): ResolvedExtension => ({
  id,
  version: '1.0.0',
  origin: 'user',
  revision: '',
  dir: `/x/${id}`,
  mainPath: `/x/${id}/main.mjs`,
  permissions: ['learning.events'],
  name: null,
  description: null,
  author: null,
  platforms: [],
  minAppVersion: null,
  install: null,
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
  settings: [
    {
      id: `${id}.greeting`,
      type: 'string',
      label: 'Greeting',
      description: null,
      default: 'hello',
      maxLength: 20,
    },
    {
      id: `${id}.limit`,
      type: 'number',
      label: 'Limit',
      description: null,
      default: 3,
      min: 1,
      max: 10,
      integer: true,
    },
  ],
  events: [{ event: 'attempt.closed' }, { event: 'session.started' }],
  ...overrides,
});

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
  emit(event: LearningEvent): void;
  changeSetting(change: ExtensionSettingChangeDto): void;
  /** Значение хранилища расширения напрямую, минуя канал. */
  read(extensionId: string, key: string): Promise<JsonValue | undefined>;
  /** Сколько запросов хоста принято (все методы). */
  readonly requests: string[];
}

export const createStubEngine = (): StubEngine => {
  const data = createMemoryExtensionDataStore();
  const disabled = new Set<string>();
  const overrides = new Map<string, Record<string, JsonValue>>();
  const learning = new Set<(event: LearningEvent) => void>();
  const changes = new Set<(change: ExtensionSettingChangeDto) => void>();
  const requests: string[] = [];
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
    requests,
    extensionHost: {
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
  };
};

export interface HarnessOptions {
  extensions: readonly ResolvedExtension[];
  /** Модули в процессе хоста (для расширений, исполняемых без изоляции). */
  modules?: Record<string, ExtensionModule>;
  /** Расширения, которым доверяют (исполняются в процессе хоста); остальные изолированы. */
  trusted?: readonly string[];
  runners?: RunnerFactory;
  queueLimit?: number;
  deliveryMs?: number;
  restart?: () => void;
}

export interface Harness {
  engine: StubEngine;
  runtime: ExtensionRuntime;
  channel: HostChannel;
  discovery: DiscoveryHolder;
  policy: ExtensionPolicy;
  logger: TestLogger;
  /** Меняет набор расширений так же, как применение изменений: снимок движка и хост. */
  replace(extensions: readonly ResolvedExtension[]): Promise<void>;
  close(): Promise<void>;
}

/** Движок ↔ канал ↔ хост расширений через loopback: тот же путь, что и боевой. */
export const createHarness = (options: HarnessOptions): Harness => {
  const logger = createLogger();
  const engine = createStubEngine();
  const discovery = createDiscoveryHolder(discoveryOf(options.extensions));
  const policy = createExtensionPolicy(discovery);
  const trusted = [...(options.trusted ?? [])];
  policy.update({ disabled: [], trusted, checkUpdates: true });
  const runtime = createExtensionRuntime({
    extensions: options.extensions,
    library: { readText: async () => '', stat: async () => null },
    logger,
    ...(options.modules !== undefined && { modules: options.modules }),
    ...(options.runners !== undefined && { runners: options.runners }),
  });
  const channel = createHostChannel({
    logger,
    ...(options.restart !== undefined && { restart: options.restart }),
  });
  const [engineSide, hostSide] = createEndpointPair();
  runtime.attach(hostSide);
  channel.attach(engineSide);
  const disconnect = connectEngine({
    channel,
    engine,
    discovery,
    policy,
    logger,
    ...(options.queueLimit !== undefined && { queueLimit: options.queueLimit }),
    ...(options.deliveryMs !== undefined && { deliveryMs: options.deliveryMs }),
  });
  return {
    engine,
    runtime,
    channel,
    discovery,
    policy,
    logger,
    async replace(extensions) {
      discovery.replace(discoveryOf(extensions));
      await runtime.replace(extensions);
    },
    async close() {
      disconnect();
      await channel.close();
      await runtime.dispose();
    },
  };
};
