import { ref, shallowRef } from 'vue';
import { MAX_LOG_ENTRIES } from '@dolphy-app/engine-contract';
import type {
  ExtensionLogEntryDto,
  LearningEngine,
  LogLevelDto,
  ReadLogsOptions,
} from '@dolphy-app/engine-contract';

export type ExtensionLogState = 'loading' | 'loaded' | 'failed';

/** Минимальный уровень по умолчанию: `debug` — все записи. */
export const DEFAULT_LOG_LEVEL: LogLevelDto = 'debug';

const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

/** Параметры запроса: пустой (или из пробелов) id — все записи; фильтры применяет движок. */
export const logQuery = (
  extensionId: string,
  minLevel: LogLevelDto,
): ReadLogsOptions => {
  const id = extensionId.trim();
  return {
    ...(id === '' ? {} : { extensionId: id }),
    minLevel,
    limit: MAX_LOG_ENTRIES,
  };
};

/**
 * Журнал для диалога: последние записи (до `MAX_LOG_ENTRIES`), самые новые
 * последними — порядок движка не меняется. Фильтры (расширение, минимальный
 * уровень) применяет движок, поэтому смена фильтра — новый запрос; ответ
 * более раннего запроса не затирает более поздний. Обычное «Обновить» не
 * прячет показанные записи, смена фильтра — прячет (они относились к другому
 * запросу). Диалог создаётся с предустановленным id расширения.
 */
export const useExtensionLog = (
  engine: LearningEngine,
  initialExtensionId = '',
) => {
  const entries = shallowRef<ExtensionLogEntryDto[]>([]);
  const state = ref<ExtensionLogState>('loading');
  const error = ref<string | null>(null);
  const busy = ref(false);
  const extensionId = ref(initialExtensionId);
  const minLevel = ref<LogLevelDto>(DEFAULT_LOG_LEVEL);
  let lastRequest = 0;

  const load = async () => {
    lastRequest += 1;
    const request = lastRequest;
    busy.value = true;
    if (state.value === 'failed') state.value = 'loading';
    try {
      const result = await engine.extensions.readLogs(
        logQuery(extensionId.value, minLevel.value),
      );
      if (request !== lastRequest) return;
      entries.value = result;
      error.value = null;
      state.value = 'loaded';
    } catch (caught) {
      if (request !== lastRequest) return;
      entries.value = [];
      error.value = errorText(caught);
      state.value = 'failed';
    } finally {
      if (request === lastRequest) busy.value = false;
    }
  };

  /** Другой запрос: записи прежнего не показываем, пока не пришли новые. */
  const reset = () => {
    entries.value = [];
    state.value = 'loading';
    return load();
  };

  const setExtensionId = (value: string) => {
    if (value === extensionId.value) return Promise.resolve();
    extensionId.value = value;
    return reset();
  };

  const setMinLevel = (value: LogLevelDto) => {
    if (value === minLevel.value) return Promise.resolve();
    minLevel.value = value;
    return reset();
  };

  void load();
  return {
    entries,
    state,
    error,
    busy,
    extensionId,
    minLevel,
    load,
    setExtensionId,
    setMinLevel,
  };
};
