import type {
  EngineDiagnosticsDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import { createCommandQueue } from './command-queue.ts';
import type { CommandQueue } from './command-queue.ts';
import type { FacadeContext } from './context-types.ts';
import { EngineError, createErrorMapper } from './errors.ts';

/** Сервисы движка без служебных методов корневого интерфейса. */
export type EngineServices = Omit<
  LearningEngine,
  'diagnostics' | 'subscribe' | 'close'
>;

type AnyMethod = (...args: never[]) => Promise<unknown>;
export type WrapMethod = (name: string, method: AnyMethod) => AnyMethod;

/**
 * Команды, которые не встают в очередь: вердикт ждёт раннер до
 * `timeoutMs`+запас; `repositories.add`/`update`/`remove`/`cancel` ходят в
 * сеть и ждут свою цепочку операций, а очередь берут сами (`exclusive`) только
 * на подмену снимка и `reload`: из очереди ждать цепочку нельзя — её
 * операция ждёт очередь (взаимная блокировка). `extensions.catalog` и
 * `extensions.install` тоже ходят в сеть (индекс, файлы версии) и очередь не
 * держат; событие `extensions-changed` они публикуют сами.
 * `extensions.invokeCommand` исполняет код расширения до 14 с: медленная
 * команда не должна замораживать остальные вызовы движка. По той же причине
 * `extensions.diagnostics` и `extensions.restartHost` (здоровье и перезапуск
 * хоста) не ждут очередь: окно должно видеть остановленный хост и мочь его
 * запустить, пока в очереди висит долгая команда.
 */
export const UNQUEUED: ReadonlySet<string> = new Set([
  'practice.submitAnswer',
  'repositories.add',
  'repositories.update',
  'repositories.remove',
  'repositories.cancel',
  'extensions.catalog',
  'extensions.install',
  'extensions.invokeCommand',
  'extensions.diagnostics',
  'extensions.restartHost',
]);

const isMethod = (value: unknown): value is AnyMethod =>
  typeof value === 'function';

/** Оборачивает каждый метод дерева сервисов; форма дерева сохраняется. */
export const wrapTree = <T extends object>(
  node: T,
  path: string,
  wrap: WrapMethod,
): T => {
  const wrapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    const name = path === '' ? key : `${path}.${key}`;
    if (isMethod(value)) wrapped[key] = wrap(name, value);
    else if (typeof value === 'object' && value !== null) {
      wrapped[key] = wrapTree(value, name, wrap);
    } else wrapped[key] = value;
  }
  return wrapped as T;
};

/**
 * Facade + Wrapper: очередь команд, `dirty`/`rebuild`, события после команды
 * батчем, маппинг ошибок, `close()`. Сервисы вызывают друг друга через `ctx`,
 * а не через этот фасад, иначе команда ждала бы саму себя в очереди.
 */
export const createFacade = (
  ctx: FacadeContext,
  services: EngineServices,
  diagnostics: () => Promise<EngineDiagnosticsDto>,
  queue: CommandQueue = createCommandQueue(),
): LearningEngine => {
  const { bus, logger, state } = ctx;
  const mapError = createErrorMapper(ctx);
  const inflightUnqueued = new Set<Promise<unknown>>();

  const wrap: WrapMethod = (name, method) => {
    const invoke = method as (...args: unknown[]) => Promise<unknown>;
    const queued = !UNQUEUED.has(name);

    const run = async (args: unknown[]): Promise<unknown> => {
      const startedAt = performance.now();
      try {
        // rebuild и события — только для очереди: вне очереди они гонялись бы с командами
        if (queued && state.dirty) await ctx.rebuild();
        const result = await invoke(...args);
        if (queued) bus.flush();
        return result;
      } catch (error) {
        if (queued) bus.discard();
        throw mapError(error, name);
      } finally {
        logger.debug({ name, ms: performance.now() - startedAt });
      }
    };

    return ((...args: unknown[]): Promise<unknown> => {
      if (state.closed) return Promise.reject(new EngineError('ENGINE_CLOSED'));
      if (queued) return queue.enqueue(() => run(args));
      const promise = run(args);
      inflightUnqueued.add(promise);
      const forget = (): void => {
        inflightUnqueued.delete(promise);
      };
      promise.then(forget, forget);
      return promise;
    }) as AnyMethod;
  };

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      state.closed = true; // новые вызовы → ENGINE_CLOSED
      await queue.idle();
      await Promise.allSettled([ctx.exerciseTypes.close()]);
      await Promise.allSettled([...inflightUnqueued]);
      await ctx.eventStore.close();
    })();
    return closing;
  };

  return {
    ...wrapTree(services, '', wrap),
    diagnostics: wrap(
      'diagnostics',
      diagnostics,
    ) as () => Promise<EngineDiagnosticsDto>,
    subscribe: bus.subscribe,
    close,
  };
};
