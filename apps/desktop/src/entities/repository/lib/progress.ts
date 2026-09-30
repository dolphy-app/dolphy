import type { EngineEvent, RepositoryPhase } from '@spirula/engine-contract';

export const REPOSITORY_PHASES: readonly RepositoryPhase[] = [
  'resolve',
  'fetch',
  'export',
  'validate',
  'reload',
];

export interface RepositoryProgress {
  id: string;
  phase: RepositoryPhase;
  loaded?: number;
  total?: number;
}

type ProgressEvent = Extract<EngineEvent, { type: 'repository-progress' }>;

export const isProgressEvent = (event: EngineEvent): event is ProgressEvent =>
  event.type === 'repository-progress';

/** Событие → состояние: счётчики прошлого этапа на новый не переносятся. */
export const toProgress = (event: ProgressEvent): RepositoryProgress => ({
  id: event.id,
  phase: event.phase,
  ...(event.loaded !== undefined && { loaded: event.loaded }),
  ...(event.total !== undefined && { total: event.total }),
});

/** Процент этапа для определённого индикатора; `null` — `total` неизвестен. */
export const progressPercent = (
  progress: RepositoryProgress,
): number | null => {
  const { loaded, total } = progress;
  if (loaded === undefined || total === undefined || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
};

/** Состояние по `id` репозитория; новое событие заменяет прежнее. */
export const reduceProgress = (
  state: Readonly<Record<string, RepositoryProgress>>,
  event: ProgressEvent,
): Record<string, RepositoryProgress> => ({
  ...state,
  [event.id]: toProgress(event),
});

export const clearProgress = (
  state: Readonly<Record<string, RepositoryProgress>>,
  id: string,
): Record<string, RepositoryProgress> => {
  const rest = { ...state };
  delete rest[id];
  return rest;
};

const SHORT_COMMIT = 7;
export const shortCommit = (commit: string): string =>
  commit.slice(0, SHORT_COMMIT);
