/**
 * `getFrontier` (engine-ts-api.md §4): урок не начат и все эффективные
 * зависимости проходят порог; «нет данных = закрыто». Границы порога
 * берутся из фактического значения скорера, чтобы тест не зависел от чисел
 * `PowerLawScorer`. T-16 — гейт FSRS закрывается после перерыва.
 */
import type { Grade, UnitId } from '@lms/engine-contract';
import { describe, expect, it } from 'vitest';
import { type World, createWorld } from './helpers/world.ts';
import type { WorldCourseSpec } from './helpers/world.ts';

const DAY_MS = 86_400_000;

/** Курс `0`: цепочка 0::0 → 0::1 → 0::2, по 3 упражнения. */
const chain = (): WorldCourseSpec[] => [
  {
    id: '0',
    lessons: [
      { id: '0::0', exercises: 3 },
      { id: '0::1', dependencies: ['0::0'], exercises: 3 },
      { id: '0::2', dependencies: ['0::1'], exercises: 3 },
    ],
  },
];

const exercisesOf = (lessonId: UnitId, count = 3) =>
  Array.from({ length: count }, (_, i) => `${lessonId}::${i}`);

/** `attempts` попыток оценки `grade` на каждом упражнении урока. */
const practice = (
  world: World,
  lessonId: UnitId,
  { attempts = 2, grade = 5 as Grade, count = 3 } = {},
) => {
  for (let round = 0; round < attempts; round++) {
    for (const exerciseId of exercisesOf(lessonId, count)) {
      world.record(exerciseId, grade);
      world.clock.advance(1000);
    }
  }
};

const lessonsOf = (world: World, query?: { courseId?: UnitId }) =>
  world.getFrontier(query).map((item) => item.lessonId);

describe('getFrontier', () => {
  it('у нового ученика фронтир — уроки без зависимостей', () => {
    const world = createWorld({
      courses: [
        ...chain(),
        { id: '1', lessons: [{ id: '1::0', exercises: 2 }] },
      ],
    });
    expect(world.getFrontier()).toEqual([
      { lessonId: '0::0', courseId: '0', exerciseCount: 3 },
      { lessonId: '1::0', courseId: '1', exerciseCount: 2 },
    ]);
  });

  it('зависимость без попыток блокирует урок: нет данных = закрыто', () => {
    const world = createWorld({ courses: chain() });
    expect(lessonsOf(world)).not.toContain('0::1');
    expect(lessonsOf(world)).not.toContain('0::2');
  });

  it('начатый урок выходит из фронтира, его зависимые открываются после порога', () => {
    const world = createWorld({ courses: chain() });
    practice(world, '0::0');
    expect(lessonsOf(world)).toEqual(['0::1']);
  });

  it('одной попытки на упражнение мало: среднее число попыток 1 < 1.8', () => {
    const world = createWorld({ courses: chain() });
    practice(world, '0::0', { attempts: 1 });
    expect(lessonsOf(world)).toEqual([]);
  });

  it('две попытки лишь на одном упражнении из трёх — закрыто', () => {
    const world = createWorld({ courses: chain() });
    practice(world, '0::0', { attempts: 2, count: 1 });
    expect(lessonsOf(world)).toEqual([]);
  });

  it('низкая оценка закрывает зависимых даже при достаточном числе попыток', () => {
    const world = createWorld({ courses: chain() });
    practice(world, '0::0', { attempts: 3, grade: 1 });
    expect(lessonsOf(world)).toEqual([]);
  });

  it('порог по оценке включителен: value == minScore открывает, чуть выше — нет', () => {
    const world = createWorld({ courses: chain() });
    practice(world, '0::0', { grade: 4 });
    const value = world.scorer.getUnitScore('0::0') as number;
    expect(value).toBeGreaterThan(0);
    world.options.set({ passingScore: { minScore: value } });
    expect(lessonsOf(world)).toEqual(['0::1']);
    world.options.set({ passingScore: { minScore: value + 1e-9 } });
    expect(lessonsOf(world)).toEqual([]);
  });

  it('порог по числу попыток включителен: среднее == minAvgTrials открывает', () => {
    const world = createWorld({ courses: chain() });
    practice(world, '0::0', { attempts: 2 });
    world.options.set({ passingScore: { minAvgTrials: 2 } });
    expect(lessonsOf(world)).toEqual(['0::1']);
    world.options.set({ passingScore: { minAvgTrials: 2.0001 } });
    expect(lessonsOf(world)).toEqual([]);
  });

  it('урок в blacklist и уроки blacklisted курса не попадают во фронтир', () => {
    const world = createWorld({
      courses: [
        {
          id: '0',
          lessons: [
            { id: '0::0', exercises: 1 },
            { id: '0::1', exercises: 1 },
          ],
        },
        { id: '1', lessons: [{ id: '1::0', exercises: 1 }] },
      ],
    });
    world.blacklist.add('0::1');
    expect(lessonsOf(world)).toEqual(['0::0', '1::0']);
    world.blacklist.add('1');
    expect(lessonsOf(world)).toEqual(['0::0']);
  });

  it('зависимость в blacklist (или в blacklisted курсе) не блокирует урок', () => {
    const world = createWorld({
      courses: [
        { id: '0', lessons: [{ id: '0::0', exercises: 1 }] },
        {
          id: '1',
          lessons: [
            { id: '1::0', dependencies: ['0::0'], exercises: 1 },
            { id: '1::1', dependencies: ['0::0'], exercises: 1 },
          ],
        },
      ],
    });
    expect(lessonsOf(world)).toEqual(['0::0']);
    world.blacklist.add('0::0');
    expect(lessonsOf(world)).toEqual(['1::0', '1::1']);
    world.blacklist.remove('0::0');
    world.blacklist.add('0');
    expect(lessonsOf(world)).toEqual(['1::0', '1::1']);
  });

  it('зависимость от вытесненного урока открыта, пока вытеснивший освоен', () => {
    const world = createWorld({
      courses: [
        {
          id: '0',
          lessons: [
            { id: '0::0', exercises: 2 },
            { id: '0::1', dependencies: ['0::0'], exercises: 2 },
          ],
        },
        {
          id: '1',
          lessons: [
            { id: '1::0', exercises: 2, superseded: ['0::0'] },
            { id: '1::1', dependencies: ['0::0'], exercises: 2 },
          ],
        },
      ],
    });
    // 0::0 начат и освоен плохо: зависимые закрыты
    practice(world, '0::0', { count: 2, attempts: 3, grade: 1 });
    expect(lessonsOf(world)).toEqual(['1::0']);
    // 1::0 освоен ≥ supersedingScore: 0::0 вытеснен и больше не блокирует
    practice(world, '1::0', { count: 2, grade: 5 });
    expect(lessonsOf(world)).toEqual(['0::1', '1::1']);
  });

  it('вытеснение не действует на урок без оценок: он остаётся во фронтире', () => {
    const world = createWorld({
      courses: [
        {
          id: '0',
          lessons: [
            { id: '0::0', exercises: 2 },
            { id: '0::1', exercises: 2, superseded: ['0::0'] },
          ],
        },
      ],
    });
    expect(lessonsOf(world)).toEqual(['0::0', '0::1']);
    practice(world, '0::1', { count: 2, grade: 5 });
    // вытеснение действует, лишь если у вытесняемого есть оценки (Trane: `all_valid_exercises_have_scores`)
    expect(lessonsOf(world)).toEqual(['0::0']);
  });

  it('стартовый урок наследует зависимости курса', () => {
    const world = createWorld({
      courses: [
        {
          id: '0',
          lessons: [
            { id: '0::0', exercises: 2 },
            { id: '0::1', exercises: 2 },
          ],
        },
        {
          id: '1',
          dependencies: ['0'],
          lessons: [
            { id: '1::0', exercises: 2 },
            { id: '1::1', dependencies: ['1::0'], exercises: 2 },
          ],
        },
      ],
    });
    expect(lessonsOf(world)).toEqual(['0::0', '0::1']);
    practice(world, '0::0', { count: 2 });
    // курс 0 усредняет по всем урокам, 0::1 не начат — порог курса не пройден
    expect(lessonsOf(world)).toEqual(['0::1']);
    practice(world, '0::1', { count: 2 });
    expect(lessonsOf(world)).toEqual(['1::0']);
  });

  it('урок без валидных упражнений не во фронтире и как зависимость закрыт', () => {
    const world = createWorld({
      courses: [
        {
          id: '0',
          lessons: [
            { id: '0::0', exercises: 0 },
            { id: '0::1', dependencies: ['0::0'], exercises: 2 },
            { id: '0::2', exercises: 2 },
          ],
        },
      ],
    });
    expect(lessonsOf(world)).toEqual(['0::2']);
  });

  it('зависимость на несуществующий юнит не блокирует урок', () => {
    const world = createWorld({
      courses: [
        {
          id: '0',
          lessons: [{ id: '0::0', dependencies: ['9::9'], exercises: 1 }],
        },
      ],
    });
    expect(lessonsOf(world)).toEqual(['0::0']);
  });

  it('exerciseCount не считает упражнения из blacklist', () => {
    const world = createWorld({
      courses: [{ id: '0', lessons: [{ id: '0::0', exercises: 3 }] }],
    });
    world.blacklist.add('0::0::1');
    expect(world.getFrontier()).toEqual([
      { lessonId: '0::0', courseId: '0', exerciseCount: 2 },
    ]);
  });

  it('фильтр по курсу оставляет только его уроки; порядок — курс, урок', () => {
    const world = createWorld({
      courses: [
        {
          id: 'b',
          lessons: [
            { id: 'b::1', exercises: 1 },
            { id: 'b::0', exercises: 1 },
          ],
        },
        { id: 'a', lessons: [{ id: 'a::0', exercises: 1 }] },
      ],
    });
    expect(lessonsOf(world)).toEqual(['a::0', 'b::0', 'b::1']);
    expect(lessonsOf(world, { courseId: 'b' })).toEqual(['b::0', 'b::1']);
    expect(lessonsOf(world, { courseId: 'z' })).toEqual([]);
  });

  it('не меняет состояние: повторный вызов даёт тот же результат', () => {
    const world = createWorld({ courses: chain() });
    practice(world, '0::0');
    expect(world.getFrontier()).toEqual(world.getFrontier());
    expect(world.session.trialCounts()).toEqual({ success: 6, failed: 0 });
  });
});

describe('T-16: гейт фронтира на FSRS', () => {
  it('закрывается после перерыва и открывается после повторения prerequisite', () => {
    const world = createWorld({ courses: chain(), scorer: 'fsrs' });
    practice(world, '0::0');
    expect(lessonsOf(world)).toEqual(['0::1']);

    world.clock.advance(400 * DAY_MS);
    expect(lessonsOf(world)).toEqual([]);

    practice(world, '0::0', { attempts: 2 });
    expect(lessonsOf(world)).toEqual(['0::1']);
  });
});
