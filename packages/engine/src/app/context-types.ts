import type { EventBus } from './event-bus.ts';
import type { Logger } from '../ports/index.ts';

/** Изменяемые флаги жизненного цикла движка. */
export interface EngineState {
  /** Проекции могли разойтись с журналом; перестроить перед следующей командой. */
  dirty: boolean;
  /** После `close()` новые вызовы получают `ENGINE_CLOSED`. */
  closed: boolean;
}

/** То, что фасаду нужно от контекста; полный `EngineContext` собирает `createEngine`. */
export interface FacadeContext {
  readonly logger: Logger;
  readonly bus: Pick<EventBus, 'flush' | 'discard' | 'subscribe'>;
  readonly state: EngineState;
  readonly verifiers: ReadonlyMap<string, { close(): Promise<void> }>;
  readonly eventStore: { close(): Promise<void> };
  /** Перестраивает проекции из журнала и сбрасывает `state.dirty`. */
  rebuild(): Promise<void>;
  markDirty(): void;
}
