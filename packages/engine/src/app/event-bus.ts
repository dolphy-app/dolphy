import type { EngineEvent, LearningEvent } from '@dolphy-app/engine-contract';
import type { Logger } from '../ports/index.ts';

export type EngineEventListener = (event: EngineEvent) => void;

/**
 * Получатель событий обучения (хост расширений). Не ждётся и не может
 * повлиять на команду: исключение и отклонённый промис только логируются.
 */
export type LearningEventListener = (
  event: LearningEvent,
) => void | Promise<void>;

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
  /**
   * События обучения — отдельный внутренний приёмник, не `EngineEvent`: окно их
   * не видит. Буфер общий по циклу с `emit`: `flush` доставляет сначала
   * события движка, затем события обучения; `discard` сбрасывает оба.
   */
  emitLearning(event: LearningEvent): void;
  subscribeLearning(listener: LearningEventListener): () => void;
}

export const createEventBus = (logger: Logger): EventBus => {
  const listeners = new Set<EngineEventListener>();
  const learningListeners = new Set<LearningEventListener>();
  let buffer: EngineEvent[] = [];
  let learningBuffer: LearningEvent[] = [];

  const deliver = (event: EngineEvent): void => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        logger.error({ error, type: event.type }, 'event listener failed');
      }
    }
  };

  const deliverLearning = (event: LearningEvent): void => {
    const failed = (error: unknown): void => {
      logger.error({ error, name: event.name }, 'learning listener failed');
    };
    for (const listener of [...learningListeners]) {
      try {
        void Promise.resolve(listener(event)).catch(failed);
      } catch (error) {
        failed(error);
      }
    }
  };

  const emit = (event: EngineEvent): void => {
    buffer.push(event);
  };

  const emitLearning = (event: LearningEvent): void => {
    learningBuffer.push(event);
  };

  const discard = (): void => {
    buffer = [];
    learningBuffer = [];
  };

  const flush = (): void => {
    const batch = buffer;
    const learning = learningBuffer;
    buffer = [];
    learningBuffer = [];
    for (const event of batch) deliver(event);
    for (const event of learning) deliverLearning(event);
  };

  const subscribe = (listener: EngineEventListener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const subscribeLearning = (listener: LearningEventListener): (() => void) => {
    learningListeners.add(listener);
    return () => {
      learningListeners.delete(listener);
    };
  };

  return {
    emit,
    publish: deliver,
    discard,
    flush,
    subscribe,
    emitLearning,
    subscribeLearning,
  };
};
