import { pathToFileURL } from 'node:url';
import type { MessageEndpoint } from '@lms/engine-contract';
import type {
  Disposable,
  ExerciseTypeHandler,
  ExtensionContext,
  ExtensionLogger,
  ExtensionModule,
  LibraryReader,
} from '@lms/extension-api';
import { createCatalog } from './catalog.ts';
import type { ResolvedExtension } from './discover.ts';
import { extRequestSchema, gradeResultSchema } from './protocol.ts';
import type { ExtRequest, ExtResponse } from './protocol.ts';

export interface ExtensionRuntimeOptions {
  extensions: readonly ResolvedExtension[];
  library: LibraryReader;
  logger: ExtensionLogger;
  /** Шов для тестов: модуль расширения с этим id берётся отсюда вместо `import()`. */
  modules?: Readonly<Record<string, ExtensionModule>>;
}

export interface ExtensionRuntime {
  handle(request: ExtRequest): Promise<ExtResponse>;
  attach(endpoint: MessageEndpoint): void;
  dispose(): Promise<void>;
}

type FailureCause = Extract<ExtResponse, { ok: false }>['error']['cause'];

class RuntimeFailure extends Error {
  readonly failure: FailureCause;
  constructor(failure: FailureCause, message: string) {
    super(message);
    this.failure = failure;
  }
}

const MAX_MESSAGE = 500;
const messageOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_MESSAGE,
  );

interface Activation {
  module: ExtensionModule;
  handlers: Map<string, ExerciseTypeHandler>;
  disposables: Disposable[];
}

export const createExtensionRuntime = (
  options: ExtensionRuntimeOptions,
): ExtensionRuntime => {
  const { logger } = options;
  const catalog = createCatalog(options.extensions);
  // Активация запоминается вместе с отказом до конца жизни процесса.
  const activations = new Map<string, Promise<Activation>>();
  const activated: Activation[] = [];
  let current: MessageEndpoint | null = null;

  const loadModule = async (
    extension: ResolvedExtension,
  ): Promise<ExtensionModule> => {
    const injected = options.modules?.[extension.id];
    const module =
      injected ??
      (
        (await import(pathToFileURL(extension.mainPath).href)) as {
          default?: ExtensionModule;
        }
      ).default;
    if (
      module === undefined ||
      module === null ||
      typeof module.activate !== 'function'
    ) {
      throw new Error(`extension '${extension.id}' has no activate()`);
    }
    return module;
  };

  const activate = async (
    extension: ResolvedExtension,
  ): Promise<Activation> => {
    const module = await loadModule(extension);
    const declared = new Set(extension.exerciseTypes.map((type) => type.id));
    const activation: Activation = {
      module,
      handlers: new Map(),
      disposables: [],
    };
    activated.push(activation);
    const context: ExtensionContext = {
      extensionId: extension.id,
      logger: options.logger,
      library: options.library,
      registerExerciseType(type, handler) {
        if (!declared.has(type)) {
          throw new Error(
            `exercise type '${type}' is not declared in the manifest of '${extension.id}'`,
          );
        }
        if (activation.handlers.has(type)) {
          throw new Error(`exercise type '${type}' is already registered`);
        }
        activation.handlers.set(type, handler);
        const disposable: Disposable = {
          dispose: () => void activation.handlers.delete(type),
        };
        activation.disposables.push(disposable);
        return disposable;
      },
    };
    await module.activate(context);
    return activation;
  };

  const handlerFor = async (type: string): Promise<ExerciseTypeHandler> => {
    const extension = catalog.ownerOf(type);
    if (extension === undefined) {
      throw new RuntimeFailure(
        'unknown-type',
        `unknown exercise type '${type}'`,
      );
    }
    let pending = activations.get(extension.id);
    if (pending === undefined) {
      pending = activate(extension);
      activations.set(extension.id, pending);
    }
    let activation: Activation;
    try {
      activation = await pending;
    } catch (error) {
      throw new RuntimeFailure('activation-failed', messageOf(error));
    }
    const handler = activation.handlers.get(type);
    if (handler === undefined) {
      throw new RuntimeFailure(
        'activation-failed',
        `extension '${extension.id}' did not register '${type}'`,
      );
    }
    return handler;
  };

  const invoke = async <T>(call: () => T | Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      throw new RuntimeFailure('handler-failed', messageOf(error));
    }
  };

  const run = async (request: ExtRequest): Promise<unknown> => {
    const { params } = request;
    const handler = await handlerFor(params.type);
    switch (request.method) {
      case 'project':
        return invoke(() =>
          handler.project({ exerciseId: params.exerciseId, spec: params.spec }),
        );
      case 'referenceAnswer': {
        const answer = await invoke(() =>
          handler.referenceAnswer?.({
            exerciseId: params.exerciseId,
            spec: params.spec,
          }),
        );
        return answer === undefined
          ? { found: false }
          : { found: true, answer };
      }
      case 'grade': {
        const grade = request.params;
        const result = await invoke(() =>
          handler.grade({
            exerciseId: grade.exerciseId,
            spec: grade.spec,
            answer: grade.answer,
            timeoutMs: grade.timeoutMs,
            authorMode: grade.authorMode,
          }),
        );
        const parsed = gradeResultSchema.safeParse(result);
        if (!parsed.success) {
          throw new RuntimeFailure(
            'invalid-result',
            `grade() returned an invalid result: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
          );
        }
        return parsed.data;
      }
      default: {
        // request разобран extRequestSchema, сюда попасть нельзя
        const unknown: never = request;
        throw new RuntimeFailure(
          'handler-failed',
          `unknown method ${JSON.stringify(unknown)}`,
        );
      }
    }
  };

  const handle = async (request: ExtRequest): Promise<ExtResponse> => {
    try {
      return { id: request.id, ok: true, result: await run(request) };
    } catch (error) {
      if (error instanceof RuntimeFailure) {
        return {
          id: request.id,
          ok: false,
          error: { cause: error.failure, message: error.message },
        };
      }
      logger.error({ error: messageOf(error) }, 'extension runtime failure');
      return {
        id: request.id,
        ok: false,
        error: { cause: 'handler-failed', message: messageOf(error) },
      };
    }
  };

  return {
    handle,
    attach(endpoint) {
      current?.close();
      current = endpoint;
      endpoint.onMessage((message) => {
        const parsed = extRequestSchema.safeParse(message);
        if (!parsed.success) {
          logger.warn({}, 'invalid extension host request ignored');
          return;
        }
        void handle(parsed.data as ExtRequest).then((response) => {
          endpoint.post(response);
        });
      });
    },
    async dispose() {
      current?.close();
      current = null;
      for (const activation of activated) {
        try {
          await activation.module.deactivate?.();
        } catch (error) {
          logger.error({ error: messageOf(error) }, 'deactivate failed');
        }
        for (const disposable of activation.disposables) {
          try {
            await disposable.dispose();
          } catch (error) {
            logger.error({ error: messageOf(error) }, 'dispose failed');
          }
        }
      }
      activated.length = 0;
    },
  };
};
