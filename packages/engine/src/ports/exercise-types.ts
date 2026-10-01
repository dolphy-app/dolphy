/**
 * Порт видов заданий: каталог видов из манифестов расширений и вызовы
 * `project`/`grade`/`referenceAnswer` в хосте расширений. Адаптеры живут в
 * `@dolphy-app/extension-host`; ядро знает только этот интерфейс.
 */
import type { ExtensionOriginDto } from '@dolphy-app/engine-contract';
import type { RawVerdict } from './index.ts';

export interface ExerciseTypeInfo {
  type: string;
  extensionId: string;
  extensionVersion: string;
  /** Откуда расширение (поставка, пользователь, режим разработчика). */
  extensionOrigin: ExtensionOriginDto;
  /** Отпечаток файлов расширения; у расширений из поставки — пустая строка. */
  extensionRevision: string;
  /** Тег custom element'а, рисующего ввод ответа. */
  element: string;
  /** `dolphy-ext://<extensionId>/<renderer>`. */
  rendererUrl: string;
}

export type ExerciseTypeErrorCause =
  | 'unknown-type'
  | 'host-down'
  | 'activation-failed'
  | 'handler-failed'
  | 'invalid-result'
  | 'timeout';

/** Сбой вызова вида задания; `grade` его не бросает (сбой — `error`-вердикт). */
export class ExerciseTypeError extends Error {
  override readonly cause: ExerciseTypeErrorCause;
  readonly type: string;

  constructor(cause: ExerciseTypeErrorCause, type: string, message: string) {
    super(message);
    this.name = 'ExerciseTypeError';
    this.cause = cause;
    this.type = type;
  }
}

export interface ExerciseTypes {
  describe(type: string): ExerciseTypeInfo | undefined;
  list(): readonly ExerciseTypeInfo[];
  /**
   * Сообщения о нарушениях схемы `spec` (не более 6); `[]` — годится.
   * Неизвестный вид → `['unknown exercise type']`.
   */
  validateSpec(type: string, spec: unknown): readonly string[];
  validateAnswer(type: string, answer: unknown): readonly string[];
  /** Бросает `ExerciseTypeError`. */
  project(request: {
    type: string;
    exerciseId: string;
    spec: unknown;
  }): Promise<unknown>;
  /** Никогда не бросает: сбои хоста — `error`-вердикт (`timeout`/`worker_crash`/`internal`). */
  grade(request: {
    type: string;
    exerciseId: string;
    spec: unknown;
    answer: unknown;
    timeoutMs: number;
    authorMode: boolean;
  }): Promise<RawVerdict>;
  /** `found: false` — у вида нет эталона. Бросает `ExerciseTypeError`. */
  referenceAnswer(request: {
    type: string;
    exerciseId: string;
    spec: unknown;
  }): Promise<{ found: true; answer: unknown } | { found: false }>;
  close(): Promise<void>;
}
