import { onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import type {
  ExtensionDataUsageDto,
  ExtensionInfoDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';

/** Данные расширения: ключи и байты хранилища кода и значений настроек вместе. */
export interface DataTotals {
  keys: number;
  bytes: number;
}

export const dataTotals = (usage: ExtensionDataUsageDto): DataTotals => ({
  keys: usage.storage.keys + usage.settings.keys,
  bytes: usage.storage.bytes + usage.settings.bytes,
});

/** Данные есть, если занят хотя бы один ключ: строка «Данные» без них не показывается. */
export const hasData = (usage: ExtensionDataUsageDto | undefined): boolean =>
  usage !== undefined && dataTotals(usage).keys > 0;

/** Данные есть у действующих расширений (загруженных и отключённых); у перекрытых и некорректных строка их не показывает. */
const carriesData = (extension: ExtensionInfoDto) =>
  extension.state === 'loaded' || extension.state === 'disabled';

const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

/**
 * Занятое данными место установленных расширений (`extensions.dataUsage`) и
 * их очистка. Использование перечитывается при смене списка и при изменении
 * значений настроек; сбой чтения одного расширения не прячет остальные.
 * Запись в хранилище самим расширением события не даёт: цифры обновляются при
 * следующем чтении списка.
 */
export const useExtensionData = (
  engine: LearningEngine,
  items: Readonly<Ref<readonly ExtensionInfoDto[]>>,
) => {
  const usage = shallowRef<ReadonlyMap<string, ExtensionDataUsageDto>>(
    new Map(),
  );
  const clearing = ref<string | null>(null);
  const clearError = ref<string | null>(null);
  let lastRequest = 0;

  const refresh = async () => {
    lastRequest += 1;
    const request = lastRequest;
    const ids = [
      ...new Set(items.value.filter(carriesData).map(({ id }) => id)),
    ];
    const entries = await Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await engine.extensions.dataUsage(id)] as const;
        } catch {
          return null;
        }
      }),
    );
    if (request !== lastRequest) return;
    usage.value = new Map(
      entries.filter((entry): entry is NonNullable<typeof entry> => !!entry),
    );
  };

  /** `true` — данные стёрты. */
  const clear = async (id: string): Promise<boolean> => {
    if (clearing.value !== null) return false;
    clearing.value = id;
    clearError.value = null;
    try {
      await engine.extensions.clearData(id);
      await refresh();
      return true;
    } catch (caught) {
      clearError.value = errorText(caught);
      return false;
    } finally {
      clearing.value = null;
    }
  };

  watch(items, () => void refresh(), { immediate: true });

  const unsubscribe = engine.subscribe((event) => {
    if (
      event.type === 'settings-changed' &&
      event.scope === 'extensionValues'
    ) {
      // слушатель не вызывает команды синхронно (API §7)
      queueMicrotask(() => void refresh());
    }
  });
  onScopeDispose(unsubscribe);

  return { usage, clearing, clearError, refresh, clear };
};
