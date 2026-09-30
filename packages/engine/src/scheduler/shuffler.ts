import type { SchedulerOptionsDto } from '@spirula-app/engine-contract';
import type { Rng } from '../ports/index.ts';
import type { Precision } from '../scoring/types.ts';
import { roundOf } from './precision.ts';
import type { Candidate } from './types.ts';

/** Максимум низкооценённых кандидатов одного курса в группе. */
export const MAX_GROUP_SIZE = 3;
/** Средняя оценка группы не выше порога — группа «новая», ближе к концу. */
export const NEW_GROUP_THRESHOLD = 1.0;
export const NEW_GROUP_KEY_MIN = 0.2;
export const NEW_GROUP_KEY_MAX = 1.0;
export const OTHER_GROUP_KEY_MIN = 0.0;
export const OTHER_GROUP_KEY_MAX = 0.8;

const compareStrings = (a: string, b: string) => Number(a > b) - Number(a < b);

/**
 * Ключ сортировки группы: слабое смещение групп новых упражнений к концу
 * (слабое, чтобы малые батчи давали разный порядок). Одно обращение к `rng`.
 */
export const groupSortKey = (
  group: readonly Candidate[],
  rng: Rng,
  precision: Precision = 'f64',
) => {
  if (group.length === 0) return 0.0;
  const round = roundOf(precision);
  let sum = 0;
  for (const candidate of group) sum = round(sum + candidate.exerciseScore);
  const average = round(sum / group.length);
  const isNew = average <= NEW_GROUP_THRESHOLD;
  const low = isNew ? NEW_GROUP_KEY_MIN : OTHER_GROUP_KEY_MIN;
  const high = isNew ? NEW_GROUP_KEY_MAX : OTHER_GROUP_KEY_MAX;
  return round(low + rng.random() * (high - low));
};

/** Соседние кандидаты одного курса в отсортированном списке. */
const chunkByCourse = (sorted: readonly Candidate[]) => {
  const chunks: Candidate[][] = [];
  for (const candidate of sorted) {
    const last = chunks.at(-1);
    if (last !== undefined && last[0]?.courseId === candidate.courseId) {
      last.push(candidate);
    } else {
      chunks.push([candidate]);
    }
  }
  return chunks;
};

/**
 * Перемешивание итогового батча (`shuffler.rs`): низкооценённые (оценка не
 * выше верхней границы окна `target`) группируются по курсу блоками до
 * `MAX_GROUP_SIZE`, каждый сильный — своя группа; группы сортируются по
 * случайному ключу. Обращения к `rng`: перемешивание каждого курсового блока
 * и по одному `random()` на группу.
 */
export const shuffleCandidates = (
  candidates: readonly Candidate[],
  options: Pick<SchedulerOptionsDto, 'masteryWindows'>,
  rng: Rng,
  precision: Precision = 'f64',
): Candidate[] => {
  const threshold = options.masteryWindows.target.range[1];
  const low: Candidate[] = [];
  const high: Candidate[] = [];
  for (const candidate of candidates) {
    (candidate.exerciseScore <= threshold ? low : high).push(candidate);
  }
  low.sort((a, b) => compareStrings(a.courseId, b.courseId));

  const groups: Candidate[][] = [];
  for (const chunk of chunkByCourse(low)) {
    rng.shuffle(chunk);
    for (let start = 0; start < chunk.length; start += MAX_GROUP_SIZE) {
      groups.push(chunk.slice(start, start + MAX_GROUP_SIZE));
    }
  }
  for (const candidate of high) groups.push([candidate]);

  const keyed = groups.map((group) => ({
    key: groupSortKey(group, rng, precision),
    group,
  }));
  keyed.sort((a, b) => a.key - b.key);
  return keyed.flatMap(({ group }) => group);
};
