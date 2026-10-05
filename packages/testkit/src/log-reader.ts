import type { ExtensionLogEntryDto } from '@dolphy-app/engine-contract';
import { LOG_LEVELS } from '@dolphy-app/engine-contract';
import type { LogReadQuery, LogReader } from '@dolphy-app/engine/ports';

export type FakeLogReader = LogReader & {
  /** Запросы, которые дошли до читателя (после проверки сервисом). */
  readonly queries: readonly LogReadQuery[];
};

/**
 * Читатель журнала над готовым списком записей (от старых к новым): применяет
 * фильтр по расширению и уровню и отдаёт последние `limit`, как файловый.
 */
export const createFakeLogReader = (
  entries: readonly ExtensionLogEntryDto[] = [],
): FakeLogReader => {
  const queries: LogReadQuery[] = [];
  return {
    queries,
    async read(query) {
      queries.push(query);
      const floor =
        query.minLevel === undefined ? 0 : LOG_LEVELS.indexOf(query.minLevel);
      return entries
        .filter(
          (entry) =>
            LOG_LEVELS.indexOf(entry.level) >= floor &&
            (query.extensionId === undefined ||
              entry.extensionId === query.extensionId),
        )
        .slice(-query.limit);
    },
  };
};
