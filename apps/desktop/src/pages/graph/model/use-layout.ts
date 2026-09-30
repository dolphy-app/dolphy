import { onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import { layoutInput } from '../lib/flow.ts';
import type { LayoutRequest, LayoutResponse } from '../lib/layout.worker.ts';
import type { CoursesLayout } from '../lib/layout.ts';
import type { GraphView } from '../lib/view.ts';

/**
 * Раскладка структуры графа в Web Worker: устаревший ответ (структура успела
 * смениться) отбрасывается. Прогресс структуру не меняет — раскладка от него
 * не пересчитывается.
 */
export interface LaidOut {
  /** Структура, для которой посчитана раскладка: не подставляем чужую. */
  structure: GraphView;
  layout: CoursesLayout;
}

export const useLayout = (structure: Readonly<Ref<GraphView | null>>) => {
  const laidOut = shallowRef<LaidOut | null>(null);
  let requested: GraphView | null = null;
  const computing = ref(false);
  const error = ref<string | null>(null);
  const worker = new Worker(
    new URL('../lib/layout.worker.ts', import.meta.url),
    { type: 'module' },
  );
  let latest = 0;

  worker.onmessage = ({ data }: MessageEvent<LayoutResponse>) => {
    if (data.id !== latest) return;
    computing.value = false;
    if ('error' in data) error.value = data.error;
    else {
      if (requested)
        laidOut.value = { structure: requested, layout: data.layout };
      error.value = null;
    }
  };
  worker.onerror = (event) => {
    computing.value = false;
    error.value = event.message;
  };

  watch(
    structure,
    (view) => {
      const id = ++latest;
      requested = view;
      if (view === null) {
        laidOut.value = null;
        computing.value = false;
        return;
      }
      computing.value = true;
      worker.postMessage({ id, ...layoutInput(view) } satisfies LayoutRequest);
    },
    { immediate: true },
  );
  onScopeDispose(() => worker.terminate());

  return { laidOut, computing, error };
};
