import { inject } from 'vue';
import type { InjectionKey, Ref } from 'vue';
import type { UnitId } from '@spirula-app/engine-contract';
import type { Direction } from '../lib/flow.ts';
import type { GraphView } from '../lib/view.ts';

/** Что холст отдаёт узлам: актуальный вид, выбор и клавиатурная навигация. */
export interface GraphContext {
  view: Readonly<Ref<GraphView | null>>;
  selectedId: Readonly<Ref<UnitId | null>>;
  /** Урок с `tabindex="0"` (roving tabindex): один вход в граф с Tab. */
  tabStopId: Readonly<Ref<UnitId | null>>;
  select(id: UnitId): void;
  move(from: UnitId, direction: Direction): void;
}

export const GRAPH_CONTEXT: InjectionKey<GraphContext> = Symbol('graph');

export const useGraphContext = (): GraphContext => {
  const context = inject(GRAPH_CONTEXT);
  if (!context) throw new Error('graph context is not provided');
  return context;
};
