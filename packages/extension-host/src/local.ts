import type {
  ExerciseTypes,
  ExtensionPolicy,
  GradePolicies,
} from '@dolphy-app/engine/ports';
import type {
  ExtensionLogger,
  ExtensionModule,
  LibraryReader,
} from '@dolphy-app/extension-api';
import { createCatalog } from './catalog.ts';
import { createHostChannel } from './channel.ts';
import {
  createRemoteExerciseTypes,
  createRemoteGradePolicies,
} from './client.ts';
import type { ResolvedExtension } from './discover.ts';
import { createEndpointPair } from './loopback.ts';
import { createAllTrustedPolicy } from './policy.ts';
import { createExtensionRuntime } from './runtime.ts';

export interface LocalExtensionHostOptions {
  extensions: readonly ResolvedExtension[];
  library: LibraryReader;
  logger: ExtensionLogger;
  /** Кто изолирован и кто отключён; по умолчанию все доверенные и включённые. */
  policy?: ExtensionPolicy;
  modules?: Record<string, ExtensionModule>;
}

export type LocalExerciseTypesOptions = LocalExtensionHostOptions;

export interface LocalExtensionHost {
  exerciseTypes: ExerciseTypes;
  gradePolicies: GradePolicies;
  /** Закрывает канал и деактивирует расширения. */
  close(): Promise<void>;
}

/** Каталог + рантайм + клиенты в одном процессе: тот же путь кода, что и боевой. */
export const createLocalExtensionHost = (
  options: LocalExtensionHostOptions,
): LocalExtensionHost => {
  const runtime = createExtensionRuntime({
    extensions: options.extensions,
    library: options.library,
    logger: options.logger,
    ...(options.modules !== undefined && { modules: options.modules }),
  });
  const policy = options.policy ?? createAllTrustedPolicy();
  const catalog = createCatalog(options.extensions, policy);
  const channel = createHostChannel({
    logger: options.logger,
    restart: () => {},
  });
  const [engineSide, hostSide] = createEndpointPair();
  runtime.attach(hostSide);
  channel.attach(engineSide);
  return {
    exerciseTypes: createRemoteExerciseTypes({
      channel,
      catalog,
      policy,
      logger: options.logger,
    }),
    gradePolicies: createRemoteGradePolicies({
      channel,
      catalog,
      policy,
      logger: options.logger,
    }),
    async close() {
      await channel.close();
      await runtime.dispose();
    },
  };
};

export const createLocalExerciseTypes = (
  options: LocalExerciseTypesOptions,
): ExerciseTypes => {
  const host = createLocalExtensionHost(options);
  return {
    ...host.exerciseTypes,
    async close() {
      await host.close();
    },
  };
};
