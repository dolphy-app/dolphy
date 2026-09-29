import { onScopeDispose, ref } from 'vue';
import type { DueItemDto, LearningEngine } from '@lms/engine-contract';

/** Состояние UI строится из событий движка, а не из опроса. */
export const useDue = (engine: LearningEngine) => {
  const items = ref<DueItemDto[]>([]);
  const refresh = async () => {
    items.value = (await engine.practice.getDue()).items;
  };
  const unsubscribe = engine.subscribe((event) => {
    // слушатель не вызывает команды синхронно (API §7)
    if (event.type === 'progress') queueMicrotask(() => void refresh());
  });
  onScopeDispose(unsubscribe);
  void refresh();
  return { items, refresh };
};
