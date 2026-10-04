import type {
  ExtensionLogEntryDto,
  LogLevelDto,
} from '@dolphy-app/engine-contract';

export interface LogReadQuery {
  /** Только записи этого расширения. */
  extensionId?: string;
  /** Записи не ниже этого уровня. */
  minLevel?: LogLevelDto;
  /** Сколько последних записей вернуть (уже проверено сервисом: 1…`MAX_LOG_ENTRIES`). */
  limit: number;
}

/**
 * Чтение файлового журнала приложения (его пишет оболочка приложения, не
 * движок). Записи — последние `limit` подходящих, самые новые последними.
 */
export interface LogReader {
  read(query: LogReadQuery): Promise<ExtensionLogEntryDto[]>;
}
