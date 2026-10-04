import type {
  ExtensionHealthDto,
  ExtensionHostStatusDto,
} from '@dolphy-app/engine-contract';

/**
 * Здоровье расширений с запуска приложения: накапливается в памяти движка и не
 * переживает перезапуск. Сбои пишут клиенты хоста расширений и сервис
 * `extensions`; активацию, приостановку и сброс сообщает сам хост расширений.
 */
export interface ExtensionHealth {
  /**
   * Сбой команды, события или вида задания: счётчик растёт, причина
   * запоминается. Пока расширение приостановлено (`recordSuppression`), отказы
   * его вызовам не считаются: приостановка — состояние, а не сбой.
   */
  recordFailure(extensionId: string, reason: string, message: string): void;
  /** Успешная активация: длительность в мс. */
  recordActivation(extensionId: string, durationMs: number): void;
  /** Ограниченный процесс приостановлен за цикл падений до `until` (epoch ms). */
  recordSuppression(extensionId: string, until: number): void;
  /** Файлы расширения сменились или расширение убрано: сводка начинается заново. */
  forget(extensionId: string): void;
  /** Запись расширения; у не сбоивших — нули. Приостановка в прошлом отдаётся как `null`. */
  get(extensionId: string): ExtensionHealthDto;
  hostStatus(): ExtensionHostStatusDto;
  setHostStatus(status: ExtensionHostStatusDto): void;
  /** Что-то изменилось (сводка или состояние хоста); возвращает отписку. */
  subscribe(listener: () => void): () => void;
}

/** Управление процессом хоста расширений, которым владеет оболочка приложения. */
export interface ExtensionHostControl {
  /** Запускает хост заново и сбрасывает счётчик его падений. */
  restart(): void;
}
