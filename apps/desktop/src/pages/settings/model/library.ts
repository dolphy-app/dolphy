import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import type {
  EngineEvent,
  LearningEngine,
  LibraryInfo,
} from '@spirula-app/engine-contract';

const REFRESH_ON: Partial<Record<EngineEvent['type'], true>> = {
  'library-reloaded': true,
  'library-compiled': true,
};

/**
 * Путь в библиотеке, который движок пропускает при разборе: относительный,
 * разделитель `/`. Пустой ввод — `null`.
 */
export const normalizeIgnoredPath = (input: string): string | null => {
  const path = input
    .trim()
    .replaceAll('\\', '/')
    .replace(/^(?:\.?\/)+/u, '')
    .replace(/\/+$/u, '');
  return path === '' ? null : path;
};

const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

/** Состояние библиотеки и пропускаемые пути; пути хранятся в БД движка. */
export const useLibrarySettings = (engine: LearningEngine) => {
  const info = shallowRef<LibraryInfo | null>(null);
  const savedPaths = ref<string[]>([]);
  const draftPaths = ref<string[]>([]);
  const busy = ref(false);
  const error = ref<string | null>(null);

  const isDirty = computed(
    () =>
      draftPaths.value.length !== savedPaths.value.length ||
      draftPaths.value.some((path, index) => path !== savedPaths.value[index]),
  );

  const guarded = async (action: () => Promise<void>) => {
    if (busy.value) return;
    busy.value = true;
    error.value = null;
    try {
      await action();
    } catch (caught) {
      error.value = errorText(caught);
    } finally {
      busy.value = false;
    }
  };

  const load = () =>
    guarded(async () => {
      const [loaded, preferences] = await Promise.all([
        engine.library.getInfo(),
        engine.settings.getPreferences(),
      ]);
      info.value = loaded;
      savedPaths.value = [...preferences.ignoredPaths];
      draftPaths.value = [...preferences.ignoredPaths];
    });

  const reload = () =>
    guarded(async () => {
      info.value = await engine.library.reload();
    });

  /** Возвращает `false`, если путь пустой или уже есть в списке. */
  const addPath = (input: string) => {
    const path = normalizeIgnoredPath(input);
    if (path === null || draftPaths.value.includes(path)) return false;
    draftPaths.value = [...draftPaths.value, path];
    return true;
  };

  const removePath = (path: string) => {
    draftPaths.value = draftPaths.value.filter((item) => item !== path);
  };

  const revert = () => {
    draftPaths.value = [...savedPaths.value];
    error.value = null;
  };

  /** Сохраняет пути и перечитывает библиотеку: без этого они не действуют. */
  const apply = () =>
    guarded(async () => {
      // остальные предпочтения (размер пачки) сохраняем как есть
      const current = await engine.settings.getPreferences();
      await engine.settings.setPreferences({
        ...current,
        ignoredPaths: [...draftPaths.value],
      });
      savedPaths.value = [...draftPaths.value];
      info.value = await engine.library.reload();
    });

  const unsubscribe = engine.subscribe((event) => {
    // слушатель не вызывает команды синхронно (API §7)
    if (REFRESH_ON[event.type] && !busy.value) {
      queueMicrotask(() => {
        void engine.library.getInfo().then((loaded) => {
          info.value = loaded;
        });
      });
    }
  });
  onScopeDispose(unsubscribe);
  void load();

  return {
    info,
    draftPaths,
    busy,
    error,
    isDirty,
    reload,
    addPath,
    removePath,
    revert,
    apply,
  };
};
