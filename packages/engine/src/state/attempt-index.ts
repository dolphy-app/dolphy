import type { UnitId } from '@spirula-app/engine-contract';
import type { AttemptIndex, AttemptRecord, EntryKey } from '../app/context.ts';
import type { ScoringGraph } from '../scoring/graph.ts';
import type { ExerciseTrial } from '../scoring/types.ts';
import { compareKeys, compareStrings } from '../sync/entry.ts';

/** Полный порядок записей: `(at, deviceId, seq)`, затем `id`. */
export const compareEntryKeys = (a: EntryKey, b: EntryKey): number =>
  compareKeys(a, b) || compareStrings(a.id, b.id);

/** Индекс первой записи списка со строго большим ключом (список отсортирован). */
const firstAfter = (list: readonly EntryKey[], key: EntryKey): number => {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareEntryKeys(list[middle] as EntryKey, key) > 0) high = middle;
    else low = middle + 1;
  }
  return low;
};

const toKey = ({ at, deviceId, seq, id }: EntryKey): EntryKey => ({
  at,
  deviceId,
  seq,
  id,
});

/** Контейнеры упражнения нужны только для границ `progress_reset`. */
export type ContainerGraph = Pick<
  ScoringGraph,
  'getExerciseLesson' | 'getLessonCourse'
>;

/**
 * Попытки по упражнениям (engine-ts.md §5.2). Записи лежат отсортированными
 * по `(at, deviceId, seq, id)`, вставка идемпотентна и не зависит от порядка
 * прихода. Отменённые записи (ключ не больше самого позднего сброса
 * упражнения, урока или курса) остаются в списке и отфильтровываются при
 * чтении, поэтому поздно пришедший сброс не требует пересчёта. Границы сброса
 * считаются по графу текущей библиотеки: обновление курса, переместившее
 * упражнение в другой урок, меняет проекцию (engine-ts.md §5.1).
 */
export const createAttemptIndex = (
  graph: () => ContainerGraph | null,
): AttemptIndex => {
  const byExercise = new Map<UnitId, AttemptRecord[]>();
  const resets = new Map<UnitId, EntryKey>();
  const seen = new Set<UnitId>();

  const newer = (candidate: EntryKey | undefined, other: EntryKey | null) => {
    if (candidate === undefined) return other;
    if (other === null) return candidate;
    return compareEntryKeys(candidate, other) > 0 ? candidate : other;
  };

  const cutOf = (exerciseId: UnitId): EntryKey | null => {
    if (resets.size === 0) return null;
    let cut = newer(resets.get(exerciseId), null);
    const current = graph();
    if (current === null) return cut;
    const lessonId = current.getExerciseLesson(exerciseId);
    if (lessonId === null) return cut;
    cut = newer(resets.get(lessonId), cut);
    const courseId = current.getLessonCourse(lessonId);
    return courseId === null ? cut : newer(resets.get(courseId), cut);
  };

  /** Индекс, с которого записи упражнения не отменены. */
  const startOf = (list: readonly AttemptRecord[], exerciseId: UnitId) => {
    const cut = cutOf(exerciseId);
    return cut === null ? 0 : firstAfter(list, cut);
  };

  const applyAttempt: AttemptIndex['applyAttempt'] = (entry) => {
    seen.add(entry.exerciseId);
    const record: AttemptRecord = {
      ...toKey(entry),
      exerciseId: entry.exerciseId,
      grade: entry.grade,
      source: entry.source,
    };
    let list = byExercise.get(entry.exerciseId);
    if (list === undefined) {
      list = [];
      byExercise.set(entry.exerciseId, list);
    }
    const position = firstAfter(list, record);
    const previous = list[position - 1];
    if (previous !== undefined && compareEntryKeys(previous, record) === 0) {
      return false;
    }
    list.splice(position, 0, record);
    return true;
  };

  const applyReset: AttemptIndex['applyReset'] = (unitId, key) => {
    seen.add(unitId);
    const known = resets.get(unitId);
    if (known !== undefined && compareEntryKeys(known, key) >= 0) return false;
    resets.set(unitId, toKey(key));
    return true;
  };

  const getRecords: AttemptIndex['getRecords'] = (exerciseId) => {
    const list = byExercise.get(exerciseId);
    if (list === undefined) return [];
    return list.slice(startOf(list, exerciseId)).reverse();
  };

  const getTrials: AttemptIndex['getTrials'] = (exerciseId, limit) => {
    const list = byExercise.get(exerciseId);
    if (list === undefined || limit <= 0) return [];
    const start = startOf(list, exerciseId);
    const trials: ExerciseTrial[] = [];
    for (let i = list.length - 1; i >= start && trials.length < limit; i--) {
      const { grade, at } = list[i] as AttemptRecord;
      trials.push({ score: grade, timestamp: at });
    }
    return trials;
  };

  const count: AttemptIndex['count'] = (exerciseId) => {
    const list = byExercise.get(exerciseId);
    return list === undefined ? 0 : list.length - startOf(list, exerciseId);
  };

  const attemptedExerciseIds = function* (): Generator<UnitId> {
    for (const [exerciseId, list] of byExercise) {
      if (startOf(list, exerciseId) < list.length) yield exerciseId;
    }
  };

  const allInOrder: AttemptIndex['allInOrder'] = () => {
    const all: AttemptRecord[] = [];
    for (const [exerciseId, list] of byExercise) {
      for (let i = startOf(list, exerciseId); i < list.length; i++) {
        all.push(list[i] as AttemptRecord);
      }
    }
    return all.sort(compareEntryKeys);
  };

  const clear = () => {
    byExercise.clear();
    resets.clear();
    seen.clear();
  };

  return {
    applyAttempt,
    applyReset,
    getTrials,
    getRecords,
    count,
    cutOf,
    attemptedExerciseIds,
    allInOrder,
    noteUnit: (unitId) => void seen.add(unitId),
    seenUnitIds: () => seen,
    clear,
  };
};
