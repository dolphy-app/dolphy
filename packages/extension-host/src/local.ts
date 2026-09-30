import type { ExerciseTypes } from '@lms/engine/ports';
import type {
  ExtensionLogger,
  ExtensionModule,
  LibraryReader,
} from '@lms/extension-api';
import { createCatalog } from './catalog.ts';
import { createRemoteExerciseTypes } from './client.ts';
import type { ResolvedExtension } from './discover.ts';
import { createEndpointPair } from './loopback.ts';
import { createExtensionRuntime } from './runtime.ts';

export interface LocalExerciseTypesOptions {
  extensions: readonly ResolvedExtension[];
  library: LibraryReader;
  logger: ExtensionLogger;
  modules?: Record<string, ExtensionModule>;
}

/** Каталог + рантайм + клиент в одном процессе: тот же путь кода, что и боевой. */
export const createLocalExerciseTypes = (
  options: LocalExerciseTypesOptions,
): ExerciseTypes => {
  const runtime = createExtensionRuntime({
    extensions: options.extensions,
    library: options.library,
    logger: options.logger,
    ...(options.modules !== undefined && { modules: options.modules }),
  });
  const client = createRemoteExerciseTypes({
    catalog: createCatalog(options.extensions),
    logger: options.logger,
    restart: () => {},
  });
  const [engineSide, hostSide] = createEndpointPair();
  runtime.attach(hostSide);
  client.attach(engineSide);
  return {
    ...client,
    async close() {
      await client.close();
      await runtime.dispose();
    },
  };
};
