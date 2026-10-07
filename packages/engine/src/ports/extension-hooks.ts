/**
 * Порт хуков «до» (`server.before`): диспетчер вызывает обработчики
 * расширений по очереди, каждый получает результат предыдущего. Адаптер
 * живёт в `@dolphy-app/extension-host`; ядро знает только этот интерфейс и
 * само проверяет ответ библиотекой. Сбой — `ExtensionHookError`; операцию,
 * которая вызвала хук, сервис при этом не выполняет.
 */
import type {
  ExtensionHookFailureReason,
  ExtensionHookName,
  ItemReason,
} from '@dolphy-app/engine-contract';

/** Потолок упражнений в ответе `practice.batch`; совпадает с `EXTENSION_HOOK_LIMITS.maxExercises` пакета `extension-api` (ядро от него не зависит). */
export const EXTENSION_HOOK_MAX_EXERCISES = 500;

export interface ExtensionHookRequests {
  'session.start': { now: number };
  'practice.batch': {
    /** `null` — сессия ещё не открыта. */
    sessionId: string | null;
    /** `batch` — `practice.getBatch`, `plan` — `plan.getDay`. */
    source: 'batch' | 'plan';
    exerciseIds: string[];
    reasons: ItemReason[];
  };
}

export interface ExtensionHookResponses {
  'session.start': void;
  'practice.batch': { exerciseIds: string[]; reasons: ItemReason[] };
}

export class ExtensionHookError extends Error {
  readonly reason: ExtensionHookFailureReason;
  readonly hook: ExtensionHookName;
  readonly extensionId: string;

  constructor(
    reason: ExtensionHookFailureReason,
    hook: ExtensionHookName,
    extensionId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionHookError';
    this.reason = reason;
    this.hook = hook;
    this.extensionId = extensionId;
  }
}

export interface ExtensionHooks {
  /**
   * Вызывает обработчики включённых расширений с хуком `name` по возрастанию
   * id, каждому — запрос с изменяемыми полями из ответа предыдущего, и
   * возвращает ответ последнего; без таких расширений (и для хука без
   * ответа) — `undefined`. `verify` проверяет ответ каждого обработчика
   * (текст нарушения или `null`): нарушение — отказ этого расширения с
   * причиной `invalid-result`. Бросает `ExtensionHookError`.
   */
  before<N extends ExtensionHookName>(
    name: N,
    request: ExtensionHookRequests[N],
    verify?: (response: ExtensionHookResponses[N]) => string | null,
  ): Promise<ExtensionHookResponses[N] | undefined>;
}
