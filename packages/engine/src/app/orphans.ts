import type { Diagnostic, UnitId } from '@spirula/engine-contract';
import { diag } from '../authoring/diagnostics.ts';
import type { Library } from '../domain/library.ts';

const compare = (a: string, b: string) => Number(a > b) - Number(a < b);

/**
 * `W_ORPHAN_EVENTS` (engine-ts.md §9): по одной диагностике на юнит, который
 * встречается в журнале, но которого нет в библиотеке (курс переименовали).
 * `path` не задан; порядок — по коду символов id.
 */
export const findOrphanDiagnostics = (
  seenUnitIds: Iterable<UnitId>,
  library: Library,
): Diagnostic[] => {
  const orphans = new Set<UnitId>();
  for (const id of seenUnitIds) {
    if (library.graph.getUnitType(id) === undefined) orphans.add(id);
  }
  return [...orphans]
    .sort(compare)
    .map((unitId) =>
      diag(
        'W_ORPHAN_EVENTS',
        `journal has events for unit '${unitId}', which is not in the library`,
        { unitId },
      ),
    );
};
