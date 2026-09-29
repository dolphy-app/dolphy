/**
 * Отказ скорера на входе, который Trane возвращает как `Err`. Агрегаты
 * (`UnitScorer`) отбрасывают только такие ошибки; остальные исключения —
 * баги и доходят до вызывающего.
 */
export class ScoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class TrialsNotSortedError extends ScoringError {
  constructor() {
    super('Exercise trials not sorted in descending order by timestamp');
  }
}

export class NonFiniteScoreError extends ScoringError {
  constructor(score: number) {
    super(`non-finite trial score ${score}`);
  }
}

export class UnknownUnitError extends ScoringError {
  constructor(unitId: string) {
    super(`missing unit type for unit with ID ${unitId}`);
  }
}
