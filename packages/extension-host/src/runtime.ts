import { pathToFileURL } from 'node:url';
import type { MessageEndpoint } from '@dolphy-app/engine-contract';
import type {
  Disposable,
  ExerciseTypeHandler,
  ExtensionContext,
  ExtensionLogger,
  ExtensionModule,
  GradePolicyHandler,
  LibraryReader,
} from '@dolphy-app/extension-api';
import { createCatalog } from './catalog.ts';
import type { ResolvedExtension } from './discover.ts';
import { createAllTrustedPolicy } from './policy.ts';
import {
  extRequestSchema,
  gradeResultSchema,
  gradeValueSchema,
} from './protocol.ts';
import type { ExtRequest, ExtResponse } from './protocol.ts';
import type { RestrictedRunner, RunnerFactory } from './restricted-runner.ts';

export interface ExtensionRuntimeOptions {
  extensions: readonly ResolvedExtension[];
  library: LibraryReader;
  logger: ExtensionLogger;
  /** Шов для тестов: модуль расширения с этим id берётся отсюда вместо `import()`. */
  modules?: Readonly<Record<string, ExtensionModule>>;
  /**
   * Фабрика ограниченных раннеров. Без неё запросы с `isolated: true` для
   * расширений не из поставки отклоняются: неверная настройка не должна молча
   * исполнять код без ограничений.
   */
  runners?: RunnerFactory;
  /** false — не маршрутизировать по `isolated`: сам процесс и есть ограничение (дочерний процесс раннера). */
  enforceIsolation?: boolean;
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
  policies: Map<string, GradePolicyHandler>;
  disposables: Disposable[];
}

export const createExtensionRuntime = (
  options: ExtensionRuntimeOptions,
): ExtensionRuntime => {
  const { logger } = options;
  const catalog = createCatalog(options.extensions, createAllTrustedPolicy());
  // Активация запоминается вместе с отказом до конца жизни процесса.
  const activations = new Map<string, Promise<Activation>>();
  const activated = new Map<string, Activation>();
  const runners = new Map<string, RestrictedRunner>();
  const enforceIsolation = options.enforceIsolation ?? true;
  let current: MessageEndpoint | null = null;

  const loadModule = async (
    extension: ResolvedExtension,
  ): Promise<ExtensionModule> => {
    const injected = options.modules?.[extension.id];
    if (injected === undefined && extension.mainPath === null) {
      throw new Error(`extension '${extension.id}' has no main`);
    }
    const module =
      injected ??
      (
        (await import(pathToFileURL(extension.mainPath ?? '').href)) as {
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
    const declaredPolicies = new Set(
      extension.gradePolicies.map((policy) => policy.id),
    );
    const activation: Activation = {
      module,
      handlers: new Map(),
      policies: new Map(),
      disposables: [],
    };
    activated.set(extension.id, activation);
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
      registerGradePolicy(id, handler) {
        if (!declaredPolicies.has(id)) {
          throw new Error(
            `grade policy '${id}' is not declared in the manifest of '${extension.id}'`,
          );
        }
        if (activation.policies.has(id)) {
          throw new Error(`grade policy '${id}' is already registered`);
        }
        activation.policies.set(id, handler);
        const disposable: Disposable = {
          dispose: () => void activation.policies.delete(id),
        };
        activation.disposables.push(disposable);
        return disposable;
      },
    };
    await module.activate(context);
    return activation;
  };

  const activationOf = async (
    extension: ResolvedExtension,
  ): Promise<Activation> => {
    let pending = activations.get(extension.id);
    if (pending === undefined) {
      pending = activate(extension);
      activations.set(extension.id, pending);
    }
    try {
      return await pending;
    } catch (error) {
      throw new RuntimeFailure('activation-failed', messageOf(error));
    }
  };

  const handlerFor = async (type: string): Promise<ExerciseTypeHandler> => {
    const extension = catalog.ownerOf(type);
    if (extension === undefined) {
      throw new RuntimeFailure(
        'unknown-type',
        `unknown exercise type '${type}'`,
      );
    }
    const handler = (await activationOf(extension)).handlers.get(type);
    if (handler === undefined) {
      throw new RuntimeFailure(
        'activation-failed',
        `extension '${extension.id}' did not register '${type}'`,
      );
    }
    return handler;
  };

  const policyFor = async (id: string): Promise<GradePolicyHandler> => {
    const extension = catalog.ownerOfPolicy(id);
    if (extension === undefined) {
      throw new RuntimeFailure(
        'unknown-policy',
        `unknown grade policy '${id}'`,
      );
    }
    const handler = (await activationOf(extension)).policies.get(id);
    if (handler === undefined) {
      throw new RuntimeFailure(
        'activation-failed',
        `extension '${extension.id}' did not register '${id}'`,
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

  const evaluatePolicy = async (
    params: Extract<ExtRequest, { method: 'gradePolicy' }>['params'],
  ): Promise<unknown> => {
    const policy = await policyFor(params.policyId);
    const result = await invoke(() =>
      policy({ verdicts: params.verdicts, gaveUp: params.gaveUp }),
    );
    const parsed = gradeValueSchema.safeParse(result);
    if (!parsed.success) {
      throw new RuntimeFailure(
        'invalid-result',
        `grade policy returned ${JSON.stringify(result) ?? 'undefined'}, expected an integer 1..5 or null`,
      );
    }
    return parsed.data;
  };

  const run = async (request: ExtRequest): Promise<unknown> => {
    if (request.method === 'gradePolicy') return evaluatePolicy(request.params);
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

  const disposeActivation = async (extensionId: string): Promise<void> => {
    const activation = activated.get(extensionId);
    activations.delete(extensionId);
    activated.delete(extensionId);
    if (activation === undefined) return;
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
  };

  const disposeRunner = async (extensionId: string): Promise<void> => {
    const runner = runners.get(extensionId);
    runners.delete(extensionId);
    try {
      await runner?.dispose();
    } catch (error) {
      logger.error({ error: messageOf(error) }, 'runner dispose failed');
    }
  };

  const ownerOfRequest = (
    request: ExtRequest,
  ): ResolvedExtension | undefined =>
    request.method === 'gradePolicy'
      ? catalog.ownerOfPolicy(request.params.policyId)
      : catalog.ownerOf(request.params.type);

  const refused = (request: ExtRequest, message: string): ExtResponse => ({
    id: request.id,
    ok: false,
    error: { cause: 'activation-failed', message },
  });

  // Расширение не из поставки с isolated === true исполняется в ограниченном
  // процессе; смена режима освобождает активацию другого режима.
  const runIsolated = async (
    request: ExtRequest,
    extension: ResolvedExtension,
  ): Promise<ExtResponse> => {
    if (options.runners === undefined) {
      return refused(request, 'isolated execution is not configured');
    }
    await disposeActivation(extension.id);
    let runner = runners.get(extension.id);
    if (runner === undefined) {
      runner = options.runners.create(extension);
      runners.set(extension.id, runner);
    }
    const response = await runner.handle(request);
    if (!response.ok) {
      logger.warn(
        { extensionId: extension.id, ...response.error },
        'restricted extension call failed',
      );
    }
    return response;
  };

  const handle = async (request: ExtRequest): Promise<ExtResponse> => {
    const extension = ownerOfRequest(request);
    if (extension !== undefined) {
      const isolated =
        enforceIsolation &&
        request.params.isolated &&
        extension.origin !== 'bundled';
      if (isolated) return runIsolated(request, extension);
      await disposeRunner(extension.id);
    }
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
      for (const id of [...activated.keys()]) await disposeActivation(id);
      for (const id of [...runners.keys()]) await disposeRunner(id);
    },
  };
};
