import type { Grade, PlacementSummaryDto, UnitId } from '@lms/engine-contract';

/** «Не знаю / пропустить» — самооценка 1 (ниже порога «знаю» — 3). */
export const SKIP_GRADE: Grade = 1;

/** Доля заданных проб от бюджета, 0..100. */
export const askedPercent = (asked: number, budget: number) =>
  budget > 0 ? Math.min(100, (asked / budget) * 100) : 0;

export interface LessonRef {
  id: UnitId;
  /** Название урока; если его нет в библиотеке — сам идентификатор. */
  name: string;
}

export interface PlacementResultView {
  known: LessonRef[];
  uncertain: LessonRef[];
  unknown: LessonRef[];
  /** Число уроков, готовых к изучению. */
  frontier: number;
  attemptsWritten: number;
  /** Результат уже записан прежним вызовом `finish`. */
  duplicate: boolean;
}

const refsOf = (ids: UnitId[], names: ReadonlyMap<UnitId, string>) =>
  ids.map((id) => ({ id, name: names.get(id) ?? id }));

/** Итог движка с названиями уроков вместо идентификаторов. */
export const describeSummary = (
  summary: PlacementSummaryDto,
  names: ReadonlyMap<UnitId, string>,
): PlacementResultView => ({
  known: refsOf(summary.known, names),
  uncertain: refsOf(summary.uncertain, names),
  unknown: refsOf(summary.unknown, names),
  frontier: summary.frontier.length,
  attemptsWritten: summary.attemptsWritten,
  duplicate: summary.duplicate,
});

/** Идентификатор активной сессии из ошибки `PLACEMENT_SESSION_ACTIVE`. */
export const activeSessionOf = (caught: unknown): string | null => {
  if (!(caught instanceof Error)) return null;
  const { code, details } = caught as Error & {
    code?: unknown;
    details?: Record<string, unknown>;
  };
  if (code !== 'PLACEMENT_SESSION_ACTIVE') return null;
  const id = details?.sessionId;
  return typeof id === 'string' ? id : null;
};
