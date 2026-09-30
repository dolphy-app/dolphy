import { ref, shallowRef } from 'vue';
import type { ExtensionInfoDto, LearningEngine } from '@lms/engine-contract';

export type ExtensionsState = 'loading' | 'loaded' | 'failed';

/**
 * Расширения, которые видит движок (`extensions.list`), в порядке движка.
 * Повторная загрузка не сбрасывает уже показанный список: `busy` — признак
 * идущего запроса, `state` меняется на `loading` только пока данных нет.
 */
export const useExtensions = (engine: LearningEngine) => {
  const items = shallowRef<ExtensionInfoDto[]>([]);
  const state = ref<ExtensionsState>('loading');
  const error = ref<string | null>(null);
  const busy = ref(false);
  let lastRequest = 0;

  const load = async () => {
    lastRequest += 1;
    const request = lastRequest;
    busy.value = true;
    if (state.value === 'failed') state.value = 'loading';
    try {
      const list = await engine.extensions.list();
      if (request !== lastRequest) return;
      items.value = list;
      error.value = null;
      state.value = 'loaded';
    } catch (caught) {
      if (request !== lastRequest) return;
      error.value = caught instanceof Error ? caught.message : String(caught);
      if (state.value === 'loading') state.value = 'failed';
    } finally {
      if (request === lastRequest) busy.value = false;
    }
  };

  void load();
  return { items, state, error, busy, load };
};
