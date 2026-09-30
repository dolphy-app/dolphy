import type { EngineEvent } from '@spirula/engine-contract';
import type { Logger } from '../ports/index.ts';

export type EngineEventListener = (event: EngineEvent) => void;

export interface EventBus {
  /** Кладёт событие в буфер; слушатели узнают о нём при `flush`. */
  emit(event: EngineEvent): void;
  /**
   * Доставляет событие слушателям сразу, мимо буфера (прогресс долгой
   * операции вне очереди команд: `repository-progress`). Буферизованные
   * события не затрагиваются.
   */
  publish(event: EngineEvent): void;
  /** Команда провалилась: буферизованные события не доставляются. */
  discard(): void;
  /** Команда завершена: доставить буфер по порядку. */
  flush(): void;
  subscribe(listener: EngineEventListener): () => void;
}

export const createEventBus = (logger: Logger): EventBus => {
  const listeners = new Set<EngineEventListener>();
  let buffer: EngineEvent[] = [];

  const deliver = (event: EngineEvent): void => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        logger.error({ error, type: event.type }, 'event listener failed');
      }
    }
  };

  const emit = (event: EngineEvent): void => {
    buffer.push(event);
  };

  const discard = (): void => {
    buffer = [];
  };

  const flush = (): void => {
    const batch = buffer;
    buffer = [];
    for (const event of batch) deliver(event);
  };

  const subscribe = (listener: EngineEventListener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { emit, publish: deliver, discard, flush, subscribe };
};
