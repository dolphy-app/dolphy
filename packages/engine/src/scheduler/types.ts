import type { UnitId } from '@spirula/engine-contract';

/**
 * Кандидат в батч (`Candidate`, scheduler.rs:121). Поля стабильны по форме:
 * knocker и поиск создают копии, а не меняют поля на месте.
 */
export interface Candidate {
  readonly exerciseId: UnitId;
  readonly lessonId: UnitId;
  readonly courseId: UnitId;
  /** Число хопов от старта поиска (f32 в Rust). */
  readonly depth: number;
  readonly exerciseScore: number;
  readonly frequency: number;
  readonly urgency: number;
  readonly velocity: number | null;
  /** Урок остановил поиск: его зависимые не добавлены. */
  readonly deadEnd: boolean;
  readonly encompassesWeight: number;
  readonly encompassedWeight: number;
}

/** `Default::default()` Rust: пустые id, нули, `velocity: null`. */
export const createCandidate = (
  fields: Partial<Candidate> & Pick<Candidate, 'exerciseId'>,
): Candidate => ({
  exerciseId: fields.exerciseId,
  lessonId: fields.lessonId ?? '',
  courseId: fields.courseId ?? '',
  depth: fields.depth ?? 0,
  exerciseScore: fields.exerciseScore ?? 0,
  frequency: fields.frequency ?? 0,
  urgency: fields.urgency ?? 0,
  velocity: fields.velocity ?? null,
  deadEnd: fields.deadEnd ?? false,
  encompassesWeight: fields.encompassesWeight ?? 0,
  encompassedWeight: fields.encompassedWeight ?? 0,
});

/** Элемент стека DFS. */
export interface StackItem {
  readonly unitId: UnitId;
  readonly depth: number;
}

export type SchedulerErrorCode =
  | 'UNKNOWN_UNIT'
  | 'MISSING_MANIFEST'
  | 'MISSING_LESSON'
  | 'MISSING_COURSE'
  | 'MISSING_SAVED_FILTER'
  | 'FILTER_ON_EXERCISE'
  | 'SCORER_FAILED';

/**
 * Ошибка сборки батча (`ExerciseSchedulerError::GetExerciseBatch` Trane):
 * данные библиотеки или настроек не согласованы с запросом. Программные
 * баги остаются обычными исключениями.
 */
export class SchedulerError extends Error {
  readonly code: SchedulerErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: SchedulerErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'SchedulerError';
    this.code = code;
    this.details = options.details ?? {};
  }
}
