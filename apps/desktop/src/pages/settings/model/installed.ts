import { onScopeDispose, shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import type {
  ExtensionInfoDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';

/**
 * Установленные расширения (`extensions.list`) для отметок «установлено / нет»
 * у зависимостей в каталоге. `null` — список ещё не получен или не
 * читается: отметки не показываются. Перечитывается при `extensions-changed`
 * и `contributions-changed` (установка, удаление, включение).
 */
export const useInstalledExtensions = (
  engine: LearningEngine,
): ShallowRef<readonly ExtensionInfoDto[] | null> => {
  const installed = shallowRef<readonly ExtensionInfoDto[] | null>(null);
  let lastRequest = 0;
  const load = async () => {
    lastRequest += 1;
    const request = lastRequest;
    try {
      const list = await engine.extensions.list();
      if (request === lastRequest) installed.value = list;
    } catch {
      // отметки необязательны: каталог работает и без них
    }
  };
  const unsubscribe = engine.subscribe((event) => {
    if (
      event.type !== 'extensions-changed' &&
      event.type !== 'contributions-changed'
    ) {
      return;
    }
    // слушатель не вызывает команды синхронно (API §7)
    queueMicrotask(() => void load());
  });
  onScopeDispose(unsubscribe);
  void load();
  return installed;
};
