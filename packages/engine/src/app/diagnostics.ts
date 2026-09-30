import { CONTRACT_VERSION } from '@spirula/engine-contract';
import type { EngineDiagnosticsDto } from '@spirula/engine-contract';
import type { EngineContext } from './context.ts';

/** Версия реализации движка для `engine.hello` и `diagnostics()`. */
export const ENGINE_VERSION = '0.1.0';

/**
 * `diagnostics()`: сводка состояния и замеров. `exerciseHitRatio` — доля
 * упражнений библиотеки, оценки которых лежат в кэше `UnitScorer` (счётчиков
 * обращений у скорера нет).
 */
export const collectDiagnostics = (
  ctx: EngineContext,
): EngineDiagnosticsDto => {
  const { metrics, state, scorer, eventStore, clock } = ctx;
  const cached = scorer.cacheKeys().exercise.length;
  const total = ctx.library.current()?.library?.exercises.size ?? 0;
  return {
    contractVersion: CONTRACT_VERSION,
    engineVersion: ENGINE_VERSION,
    uptimeMs: clock.now() - metrics.startedAt,
    entryCount: eventStore.entryCount(),
    timings: {
      openLibraryMs: metrics.openLibraryMs,
      rebuildMs: metrics.rebuildMs,
      batch: metrics.percentiles('batch'),
      recordAttemptP95Ms: metrics.percentiles('recordAttempt').p95Ms,
    },
    cache: {
      exerciseHitRatio: total === 0 ? 0 : cached / total,
      entries: cached,
    },
    dirty: state.dirty,
  };
};
