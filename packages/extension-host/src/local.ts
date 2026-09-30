import type { ExerciseTypes, GradePolicies } from '@lms/engine/ports';
import type {
  ExtensionLogger,
  ExtensionModule,
  LibraryReader,
} from '@lms/extension-api';
import { createCatalog } from './catalog.ts';
import { createHostChannel } from './channel.ts';
import {
  createRemoteExerciseTypes,
  createRemoteGradePolicies,
} from './client.ts';
import type { ResolvedExtension } from './discover.ts';
import { createEndpointPair } from './loopback.ts';
import { createExtensionRuntime } from './runtime.ts';

export interface LocalExtensionHostOptions {
  extensions: readonly ResolvedExtension[];
  library: LibraryReader;
  logger: ExtensionLogger;
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
  const catalog = createCatalog(options.extensions);
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
      logger: options.logger,
    }),
    gradePolicies: createRemoteGradePolicies({
      channel,
      catalog,
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
