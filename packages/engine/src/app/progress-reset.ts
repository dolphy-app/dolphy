import type { UnitId } from '@dolphy-app/engine-contract';
import type { CommitResult, EngineContext } from './context.ts';

/** Один сброс прогресса: `id` — `requestId` записи, по умолчанию uuidv7. */
export interface ProgressResetRequest {
  unitId: UnitId;
  id?: string;
}

/**
 * Пишет `progress_reset` по каждому юниту одной транзакцией журнала и объявляет
 * событие `progress` по новым записям: оценки меняются у самого юнита, вложенных
 * и охватывающих. Юнит, которого нет в графе, не проверяется: сброс привязан к
 * `unitId` и покроет юнит, когда тот появится в библиотеке. Событие уходит с
 * шиной команды (`bus.flush`), вызывающий отвечает за её завершение.
 */
export const commitProgressResets = async (
  ctx: EngineContext,
  requests: readonly ProgressResetRequest[],
): Promise<CommitResult> => {
  const status = ctx.library.current();
  const revision = status?.revision ?? '';
  const result = await ctx.commit(
    requests.map(({ unitId, id }) => ({
      fields: {
        kind: 'progress_reset',
        unitId,
        ...(revision !== '' && { libraryRevision: revision }),
      },
      ...(id !== undefined && { id }),
    })),
  );
  const graph = status?.library?.graph;
  for (const entry of result.appended) {
    if (entry.kind !== 'progress_reset') continue;
    const { unitId } = entry;
    const unitIds =
      graph === undefined
        ? [unitId]
        : [
            unitId,
            ...graph.getContainers(unitId),
            ...graph.getExercisesUnder(unitId).filter((id) => id !== unitId),
          ];
    ctx.emit({
      type: 'progress',
      unitIds: [...new Set(unitIds)],
      at: entry.at,
    });
  }
  return result;
};
