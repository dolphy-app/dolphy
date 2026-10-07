import type {
  ExerciseTypes,
  ExtensionCommands,
  ExtensionPolicy,
  ExtensionTransfers,
  GradePolicies,
} from '@dolphy-app/engine/ports';
import type { ExtensionLogger, LibraryReader } from '@dolphy-app/extension-api';
import { createCatalog } from './catalog.ts';
import { createHostChannel } from './channel.ts';
import {
  createRemoteExerciseTypes,
  createRemoteExtensionCommands,
  createRemoteExtensionTransfers,
  createRemoteGradePolicies,
} from './client.ts';
import type { ExtensionCandidate } from './discover.ts';
import { formatDiagnostic } from './diagnostics.ts';
import { createDiscoveryHolder, discoveryOf } from './holder.ts';
import { createEndpointPair } from './loopback.ts';
import { createAllEnabledPolicy } from './policy.ts';
import { createExtensionRuntime } from './runtime.ts';
import type { ExtensionRuntimeOptions } from './runtime.ts';

export interface LocalExtensionHostOptions {
  /** Найденные расширения (`discoverExtensions`); их `server` запускается при создании. */
  extensions: readonly ExtensionCandidate[];
  library: LibraryReader;
  logger: ExtensionLogger;
  /** Кто отключён; по умолчанию все включены. */
  policy?: ExtensionPolicy;
  modules?: ExtensionRuntimeOptions['modules'];
}

export type LocalExerciseTypesOptions = LocalExtensionHostOptions;

export interface LocalExtensionHost {
  exerciseTypes: ExerciseTypes;
  gradePolicies: GradePolicies;
  extensionCommands: ExtensionCommands;
  extensionTransfers: ExtensionTransfers;
  /** Закрывает канал и деактивирует расширения. */
  close(): Promise<void>;
}

/**
 * Каталог + рантайм + клиенты в одном процессе: тот же путь кода, что и
 * боевой. Завершается, когда `server` каждого расширения зарегистрировался
 * (или отвергнут: такое расширение без вкладов, причина в журнале).
 */
export const createLocalExtensionHost = async (
  options: LocalExtensionHostOptions,
): Promise<LocalExtensionHost> => {
  const runtime = createExtensionRuntime({
    library: options.library,
    logger: options.logger,
    ...(options.modules !== undefined && { modules: options.modules }),
  });
  const policy = options.policy ?? createAllEnabledPolicy();
  const discovery = createDiscoveryHolder(discoveryOf(options.extensions));
  discovery.applyRegistrations(await runtime.replace(options.extensions));
  for (const { extensionId, diagnostic } of discovery.get().diagnostics) {
    options.logger.warn(
      { extensionId },
      `extension skipped: ${formatDiagnostic(diagnostic)}`,
    );
  }
  const catalog = createCatalog(discovery, policy);
  const channel = createHostChannel({
    logger: options.logger,
    restart: () => {},
    currentExtensions: () => [...options.extensions],
    onRegistrations: (result) => discovery.applyRegistrations(result),
  });
  const [engineSide, hostSide] = createEndpointPair();
  runtime.attach(hostSide);
  channel.attach(engineSide);
  return {
    exerciseTypes: createRemoteExerciseTypes({
      channel,
      catalog,
      logger: options.logger,
    }),
    gradePolicies: createRemoteGradePolicies({
      channel,
      catalog,
      logger: options.logger,
    }),
    extensionCommands: createRemoteExtensionCommands({
      channel,
      logger: options.logger,
    }),
    extensionTransfers: createRemoteExtensionTransfers({
      channel,
      logger: options.logger,
    }),
    async close() {
      await channel.close();
      await runtime.dispose();
    },
  };
};

export const createLocalExerciseTypes = async (
  options: LocalExerciseTypesOptions,
): Promise<ExerciseTypes> => {
  const host = await createLocalExtensionHost(options);
  return {
    ...host.exerciseTypes,
    async close() {
      await host.close();
    },
  };
};
