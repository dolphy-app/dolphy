import type { ExtensionReloader } from '../ports/extension-reloader.ts';
import type { Logger } from '../ports/index.ts';
import type { EngineState } from './context-types.ts';
import type { EventBus } from './event-bus.ts';

/**
 * Живое применение расширений: перезагрузка набора, поколение вкладов и
 * событие `contributions-changed`.
 */
export interface ExtensionApply {
  /** Поколение набора вкладов: 0 до первого применения, затем растёт на 1 при каждом. */
  generation(): number;
  /**
   * Перечитывает расширения (`ExtensionReloader`), и когда движок и хост
   * расширений закончили, публикует `contributions-changed`. Вызовы идут
   * последовательно: пока идёт перезагрузка, новые запросы сливаются в одну
   * следующую, которая стартует уже после них, так что каждый вызывающий
   * получает набор, собранный не раньше его вызова. Не бросает: сбой сборки
   * набора логируется, прежний набор остаётся, поколение не растёт.
   */
  reload(): Promise<void>;
  /**
   * Набор вкладов изменился без перезагрузки с диска (хост расширений
   * перезапущен и заново зарегистрировал вклады): повышает поколение и
   * публикует `contributions-changed`. После закрытия движка ничего не делает.
   */
  notifyChanged(): void;
}

export const createExtensionApply = (deps: {
  reloader: ExtensionReloader;
  bus: Pick<EventBus, 'publish'>;
  logger: Logger;
  state: Pick<EngineState, 'closed'>;
}): ExtensionApply => {
  const { reloader, bus, logger, state } = deps;
  let generation = 0;
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;

  const notifyChanged = (): void => {
    if (state.closed) return;
    generation += 1;
    bus.publish({ type: 'contributions-changed', generation });
  };

  const apply = async (): Promise<void> => {
    if (state.closed) return;
    try {
      await reloader.reload();
    } catch (error) {
      logger.error({ error }, 'extensions reload failed');
      return;
    }
    notifyChanged();
  };

  const start = (): Promise<void> => {
    const current = apply().finally(() => {
      if (running === current) running = null;
    });
    running = current;
    return current;
  };

  return {
    generation: () => generation,
    notifyChanged,
    reload() {
      if (running === null) return start();
      queued ??= running.then(() => {
        queued = null;
        return start();
      });
      return queued;
    },
  };
};
