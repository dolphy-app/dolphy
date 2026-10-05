import type { UnitId } from '@dolphy-app/engine-contract';
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
  /** Решения `retract` по `targetId`: LWW по ключу записи. */
  const retractions = new Map<string, { key: EntryKey; set: boolean }>();
  /** Число целей в состоянии «отменено»: 0 — чтение идёт без проверки каждой записи. */
  let retractedTargets = 0;

  const isTargetRetracted = (targetId: string) =>
    retractions.get(targetId)?.set === true;

  /** Попытка отменена по своему `id` или по общей части `id` пачки `<id>#<i>`. */
  const isRetractedId = (id: string): boolean => {
    if (retractedTargets === 0) return false;
    if (isTargetRetracted(id)) return true;
    const mark = id.indexOf('#');
    return mark > 0 && isTargetRetracted(id.slice(0, mark));
  };

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

  const applyRetraction: AttemptIndex['applyRetraction'] = (entry) => {
    const known = retractions.get(entry.targetId);
    if (known !== undefined && compareEntryKeys(known.key, entry) >= 0) {
      return false;
    }
    const set = entry.op === 'set';
    retractions.set(entry.targetId, { key: toKey(entry), set });
    retractedTargets += Number(set) - Number(known?.set === true);
    return true;
  };

  const exercisesOf: AttemptIndex['exercisesOf'] = (targetId) => {
    const batch = `${targetId}#`;
    const found: UnitId[] = [];
    for (const [exerciseId, list] of byExercise) {
      if (list.some(({ id }) => id === targetId || id.startsWith(batch))) {
        found.push(exerciseId);
      }
    }
    return found;
  };

  /** Неотменённые (ни сбросом, ни `retract`) попытки упражнения по возрастанию ключа. */
  const liveOf = (list: readonly AttemptRecord[], exerciseId: UnitId) => {
    const tail = list.slice(startOf(list, exerciseId));
    return retractedTargets === 0
      ? tail
      : tail.filter((record) => !isRetractedId(record.id));
  };

  const getRecords: AttemptIndex['getRecords'] = (exerciseId) => {
    const list = byExercise.get(exerciseId);
    if (list === undefined) return [];
    return liveOf(list, exerciseId).reverse();
  };

  const getTrials: AttemptIndex['getTrials'] = (exerciseId, limit) => {
    const list = byExercise.get(exerciseId);
    if (list === undefined || limit <= 0) return [];
    const start = startOf(list, exerciseId);
    const trials: ExerciseTrial[] = [];
    for (let i = list.length - 1; i >= start && trials.length < limit; i--) {
      const record = list[i] as AttemptRecord;
      if (isRetractedId(record.id)) continue;
      trials.push({ score: record.grade, timestamp: record.at });
    }
    return trials;
  };

  const count: AttemptIndex['count'] = (exerciseId) => {
    const list = byExercise.get(exerciseId);
    if (list === undefined) return 0;
    if (retractedTargets === 0) return list.length - startOf(list, exerciseId);
    return liveOf(list, exerciseId).length;
  };

  const attemptedExerciseIds = function* (): Generator<UnitId> {
    for (const [exerciseId, list] of byExercise) {
      if (retractedTargets === 0) {
        if (startOf(list, exerciseId) < list.length) yield exerciseId;
      } else if (liveOf(list, exerciseId).length > 0) {
        yield exerciseId;
      }
    }
  };

  const allInOrder: AttemptIndex['allInOrder'] = () => {
    const all: AttemptRecord[] = [];
    for (const [exerciseId, list] of byExercise) {
      all.push(...liveOf(list, exerciseId));
    }
    return all.sort(compareEntryKeys);
  };

  const clear = () => {
    byExercise.clear();
    resets.clear();
    retractions.clear();
    retractedTargets = 0;
    seen.clear();
  };

  return {
    applyAttempt,
    applyRetraction,
    exercisesOf,
    isTargetRetracted,
    isRetractedId,
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
