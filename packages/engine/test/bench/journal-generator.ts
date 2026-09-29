/**
 * Генератор журнала для бенчмарков F-слоя (T-57, engine-ts-testing.md §7.1):
 * 500k попыток, 3 устройства, 730 дней, 85 % успехов, библиотека
 * 1 500 уроков × 4 упражнения. Детерминирован: один seed — один журнал.
 *
 * Порядок записей — по возрастанию `at` (строго, миллисекунды не повторяются);
 * `seq` каждого устройства идёт с 1 без пропусков, поэтому журнал можно
 * вставлять в хранилище батчами и публиковать сегментами `FolderSync`.
 */
import { T0_MS, buildAttempt, generateLibrary } from '@lms/testkit';
import type { AttemptEntry } from '../../src/domain/journal.ts';
import { createMulberry32 } from '../../src/planning/seeded-random.ts';

export const BENCH_SEED = 20260929;
export const BENCH_EVENTS = 500_000;
export const BENCH_DEVICES = ['device-a', 'device-b', 'device-c'] as const;
export const BENCH_DAYS = 730;
export const BENCH_SUCCESS_RATE = 0.85;
export const BENCH_LESSONS = 1_500;
export const BENCH_EXERCISES_PER_LESSON = 4;
export const BENCH_COURSES = 10;

const MS_PER_DAY = 86_400_000;

export interface JournalOptions {
  /** Идентификаторы упражнений; по умолчанию — библиотека 1 500 × 4. */
  exerciseIds?: readonly string[];
  count?: number;
  seed?: number;
  deviceIds?: readonly string[];
  days?: number;
  /** Доля попыток с оценкой 3..5 (остальные — 1..2). */
  successRate?: number;
  /** Момент начала окна `days`, мс. */
  startAt?: number;
}

/** Упражнения библиотеки `lessons × exercisesPerLesson` из `@lms/testkit`. */
export const benchExerciseIds = (
  lessons = BENCH_LESSONS,
  exercisesPerLesson = BENCH_EXERCISES_PER_LESSON,
  seed = BENCH_SEED,
): string[] =>
  generateLibrary({
    courses: BENCH_COURSES,
    lessonsPerCourse: lessons / BENCH_COURSES,
    exercisesPerLesson,
    seed,
  }).exercises.map(({ id }) => id);

export const generateJournal = ({
  exerciseIds = benchExerciseIds(),
  count = BENCH_EVENTS,
  seed = BENCH_SEED,
  deviceIds = BENCH_DEVICES,
  days = BENCH_DAYS,
  successRate = BENCH_SUCCESS_RATE,
  startAt = T0_MS,
}: JournalOptions = {}): AttemptEntry[] => {
  const random = createMulberry32(seed);
  const int = (limit: number) => Math.floor(random() * limit);
  const moments = Float64Array.from({ length: count }, () =>
    Math.floor(random() * days * MS_PER_DAY),
  ).sort();
  const seqs = new Array<number>(deviceIds.length).fill(0);
  const journal: AttemptEntry[] = [];
  let previous = -1;
  for (const moment of moments) {
    // `at` строго растёт: одинаковые миллисекунды сдвигаются на 1 мс
    const offset = Math.max(moment, previous + 1);
    previous = offset;
    const device = int(deviceIds.length);
    const seq = (seqs[device] as number) + 1;
    seqs[device] = seq;
    const isSuccess = random() < successRate;
    journal.push(
      buildAttempt({
        deviceId: deviceIds[device] as string,
        seq,
        at: startAt + offset,
        exerciseId: exerciseIds[int(exerciseIds.length)] as string,
        grade: (isSuccess ? 3 + int(3) : 1 + int(2)) as 1 | 2 | 3 | 4 | 5,
      }),
    );
  }
  return journal;
};
