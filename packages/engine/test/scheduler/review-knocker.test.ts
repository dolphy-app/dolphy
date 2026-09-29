/**
 * Порт модульных тестов `scheduler/review_knocker.rs` (mod tests, :228-483, 4
 * теста) и пробелов спеки `spec-scoring-filter.md` §4.7: ручной пример
 * цепочки L2→L1→L0, `createReviewKnocker.knockOutReviews` целиком.
 *
 * Отличия от Rust: граф — `Library.graph` из `buildWorldLibrary` (Rust:
 * `InMemoryUnitGraph` с `add_encompassed(id, &[prev], &[])`, то есть
 * зависимости с весом покрытия 1.0 по умолчанию); карты названы по смыслу
 * `computeEncompassingMap(reverse)`; кандидаты не мутируются — копии.
 */
import type { UnitId } from '@lms/engine-contract';
import { describe, expect, it } from 'vitest';
import type { UnitGraph } from '../../src/domain/graph.ts';
import {
  HIGHLY_SCORE,
  HIGHLY_WEIGHT,
  VERY_HIGHLY_SCORE,
  VERY_HIGHLY_WEIGHT,
  computeEncompassingMap,
  createCandidate,
  createReviewKnocker,
  getHighlyEncompassed,
  removeVeryHighlyEncompassed,
} from '../../src/scheduler/index.ts';
import type { Candidate } from '../../src/scheduler/index.ts';
import { buildWorldLibrary } from './helpers/world.ts';
import type { WorldCourseSpec } from './helpers/world.ts';

/** Курсы 0..n-1: курс зависит от предыдущего, урок — от предыдущего урока. */
const chainCourses = (
  numCourses: number,
  lessonsPerCourse: number,
  chained: boolean,
): WorldCourseSpec[] =>
  Array.from({ length: numCourses }, (_, course) => ({
    id: `course_${course}`,
    dependencies: chained && course > 0 ? [`course_${course - 1}`] : [],
    lessons: Array.from({ length: lessonsPerCourse }, (_, lesson) => ({
      id: `course_${course}::lesson_${lesson}`,
      dependencies:
        chained && lesson > 0 ? [`course_${course}::lesson_${lesson - 1}`] : [],
      exercises: 1,
    })),
  }));

/** По одному упражнению на урок: id `course_c::lesson_l::0`. */
const batchOf = (
  numCourses: number,
  lessonsPerCourse: number,
  scoreOf: (course: number, lesson: number) => number = () => 4.5,
) =>
  Array.from({ length: numCourses }, (_, course) =>
    Array.from({ length: lessonsPerCourse }, (_, lesson) =>
      createCandidate({
        exerciseId: `course_${course}::lesson_${lesson}::0`,
        lessonId: `course_${course}::lesson_${lesson}`,
        courseId: `course_${course}`,
        exerciseScore: scoreOf(course, lesson),
      }),
    ),
  ).flat();

const candidate = (
  exerciseId: string,
  exerciseScore: number,
  lessonId = `lesson-of-${exerciseId}`,
  courseId = 'course1',
) => createCandidate({ exerciseId, exerciseScore, lessonId, courseId });

describe('computeEncompassingMap', () => {
  it('test_compute_weight_many_encompassed: длинные цепочки дают большие веса', () => {
    const numCourses = 20;
    const lessons = 5;
    const { graph } = buildWorldLibrary(
      chainCourses(numCourses, lessons, true),
    );
    const batch = batchOf(numCourses, lessons);
    const weightOf = (
      map: Map<UnitId, number>,
      course: number,
      lesson: number,
    ) => map.get(`course_${course}::lesson_${lesson}::0`) ?? 0;

    // «охватываемые»: первые пять курсов охвачены многими — вес не ниже порога
    const forward = computeEncompassingMap(batch, graph, false);
    for (let course = 0; course < 5; course++) {
      for (let lesson = 0; lesson < lessons; lesson++) {
        expect(weightOf(forward, course, lesson)).toBeGreaterThanOrEqual(
          VERY_HIGHLY_WEIGHT,
        );
      }
    }
    // последнее упражнение не охвачено никем
    expect(weightOf(forward, numCourses - 1, lessons - 1)).toBe(0);

    // обратная карта: последние пять курсов охватывают многое
    const reverse = computeEncompassingMap(batch, graph, true);
    for (let course = numCourses - 5; course < numCourses; course++) {
      for (let lesson = 0; lesson < lessons; lesson++) {
        expect(weightOf(reverse, course, lesson)).toBeGreaterThanOrEqual(
          VERY_HIGHLY_WEIGHT,
        );
      }
    }
    // первое упражнение ничего не охватывает
    expect(weightOf(reverse, 0, 0)).toBe(0);
  });

  it('test_compute_weight_few_encompassed: без рёбер все веса нулевые', () => {
    const { graph } = buildWorldLibrary(chainCourses(5, 3, false));
    const batch = batchOf(5, 3);
    for (const reverse of [false, true]) {
      const map = computeEncompassingMap(batch, graph, reverse);
      expect(map.size).toBe(batch.length);
      for (const weight of map.values()) expect(weight).toBe(0);
    }
  });

  describe('цепочка L2 → L1 → L0 (спека §4.7)', () => {
    const courses: WorldCourseSpec[] = [
      {
        id: 'C',
        lessons: [
          { id: 'C::L0', exercises: 1 },
          { id: 'C::L1', encompassed: [['C::L0', 1.0]], exercises: 1 },
          { id: 'C::L2', encompassed: [['C::L1', 1.0]], exercises: 1 },
        ],
      },
    ];
    const batch = ['L0', 'L1', 'L2'].map((lesson) =>
      createCandidate({
        exerciseId: `C::${lesson}::0`,
        lessonId: `C::${lesson}`,
        courseId: 'C',
      }),
    );

    it('прямая карта: веса упражнений 2, 1, 0', () => {
      const { graph } = buildWorldLibrary(courses);
      const map = computeEncompassingMap(batch, graph, false);
      expect(batch.map((c) => map.get(c.exerciseId))).toEqual([2, 1, 0]);
    });

    it('обратная карта: веса упражнений 0, 1, 2', () => {
      const { graph } = buildWorldLibrary(courses);
      const map = computeEncompassingMap(batch, graph, true);
      expect(batch.map((c) => map.get(c.exerciseId))).toEqual([0, 1, 2]);
    });

    it('вес копится по весу ребра, а не по затухающему весу пути', () => {
      const weighted = buildWorldLibrary([
        {
          id: 'C',
          lessons: [
            { id: 'C::L0', exercises: 1 },
            { id: 'C::L1', encompassed: [['C::L0', 0.5]], exercises: 1 },
          ],
        },
      ]);
      const map = computeEncompassingMap(
        batch.slice(0, 2),
        weighted.graph,
        false,
      );
      expect(map.get('C::L0::0')).toBe(0.5);
      expect(map.get('C::L1::0')).toBe(0);
    });
  });
});

describe('removeVeryHighlyEncompassed', () => {
  it('test_remove_very_highly_encompassed: убирает вес ≥ 10 и оценку ≥ 4.5', () => {
    const batch = [
      candidate('ex1', 4.5),
      candidate('ex2', 3.5),
      candidate('ex3', 2.0),
    ];
    const weights = new Map([
      ['ex1', 12.0],
      ['ex2', 8.0],
      ['ex3', 2.0],
    ]);
    const result = removeVeryHighlyEncompassed(batch, weights);
    expect(result.map((c) => c.exerciseId)).toEqual(['ex2', 'ex3']);
  });

  it('границы: вес ровно 10 и оценка ровно 4.5 удаляются; ниже любого порога — нет', () => {
    const batch = [
      candidate('at-both', VERY_HIGHLY_SCORE),
      candidate('score-below', VERY_HIGHLY_SCORE - 0.01),
      candidate('weight-below', VERY_HIGHLY_SCORE),
      candidate('no-weight', 5.0),
    ];
    const weights = new Map([
      ['at-both', VERY_HIGHLY_WEIGHT],
      ['score-below', 12],
      ['weight-below', VERY_HIGHLY_WEIGHT - 0.01],
    ]);
    expect(
      removeVeryHighlyEncompassed(batch, weights).map((c) => c.exerciseId),
    ).toEqual(['score-below', 'weight-below', 'no-weight']);
  });
});

describe('getHighlyEncompassed', () => {
  it('test_get_highly_encompassed: вес ≥ 5 и оценка ≥ 3.75, без очень сильных', () => {
    const batch = [
      candidate('ex1', 4.5),
      candidate('ex2', 3.9),
      candidate('ex3', 2.0),
      candidate('ex4', 3.8),
      candidate('ex5', 4.0),
    ];
    const weights = new Map([
      ['ex1', 12.0],
      ['ex2', 8.0],
      ['ex3', 2.0],
      ['ex4', 3.0],
      ['ex5', 12.0],
    ]);
    const result = getHighlyEncompassed(batch, weights);
    expect(result.map((c) => c.exerciseId)).toEqual(['ex2', 'ex5']);
  });

  it('границы порогов и упражнения без записи в карте', () => {
    const batch = [
      candidate('at-both', HIGHLY_SCORE),
      candidate('score-below', HIGHLY_SCORE - 0.01),
      candidate('weight-below', 4.0),
      candidate('not-in-map', 4.0),
    ];
    const weights = new Map([
      ['at-both', HIGHLY_WEIGHT],
      ['score-below', 9],
      ['weight-below', HIGHLY_WEIGHT - 0.01],
    ]);
    expect(
      getHighlyEncompassed(batch, weights).map((c) => c.exerciseId),
    ).toEqual(['at-both']);
  });
});

describe('createReviewKnocker.knockOutReviews', () => {
  /**
   * Заглушка графа: двенадцать стартовых уроков `s1…s12` охватывают урок X,
   * первые шесть — урок Y, первые два — урок Z. Курсы рёбер не имеют.
   */
  const stubGraph = (): Pick<
    UnitGraph,
    'getEncompasses' | 'getEncompassedBy' | 'getLessonCourse'
  > => ({
    getEncompasses: (id) => {
      const match = /^s(\d+)$/.exec(id);
      if (match === null) return [];
      const index = Number(match[1]);
      const targets: Array<[string, number]> = [['X', 1]];
      if (index <= 6) targets.push(['Y', 1]);
      if (index <= 2) targets.push(['Z', 1]);
      return targets;
    },
    getEncompassedBy: () => undefined,
    getLessonCourse: () => undefined,
  });

  const starters = Array.from({ length: 12 }, (_, i) =>
    createCandidate({
      exerciseId: `ex-s${i + 1}`,
      lessonId: `s${i + 1}`,
      courseId: 'course',
      exerciseScore: 1.0,
    }),
  );
  const x = createCandidate({
    exerciseId: 'ex-x',
    lessonId: 'X',
    courseId: 'course',
    exerciseScore: 4.5,
  });
  const xLowScore = createCandidate({
    exerciseId: 'ex-x2',
    lessonId: 'X',
    courseId: 'course',
    exerciseScore: 4.4,
  });
  const y = createCandidate({
    exerciseId: 'ex-y',
    lessonId: 'Y',
    courseId: 'course',
    exerciseScore: 4.0,
  });
  const z = createCandidate({
    exerciseId: 'ex-z',
    lessonId: 'Z',
    courseId: 'course',
    exerciseScore: 4.5,
  });
  const batch: Candidate[] = [...starters, x, xLowScore, y, z].map((c) =>
    Object.freeze(c),
  );

  it('удаляет очень сильно покрытых, выделяет сильно покрытых, проставляет веса копиям', () => {
    const knocker = createReviewKnocker(stubGraph);
    const { candidates, highlyEncompassed } = knocker.knockOutReviews(batch);

    // X: вес 12, оценка 4.5 — удалён; Y: 6 — highly; Z: 2 — обычный; x2: 12, но 4.4 < 4.5
    expect(candidates.map((c) => c.exerciseId)).toEqual([
      ...starters.map((c) => c.exerciseId),
      'ex-x2',
      'ex-y',
      'ex-z',
    ]);
    expect(highlyEncompassed.map((c) => c.exerciseId)).toEqual([
      'ex-x2',
      'ex-y',
    ]);
    // highly ⊂ candidates (те же объекты)
    for (const item of highlyEncompassed) expect(candidates).toContain(item);

    const byId = new Map(candidates.map((c) => [c.exerciseId, c]));
    expect(byId.get('ex-x2')?.encompassedWeight).toBe(12);
    expect(byId.get('ex-y')?.encompassedWeight).toBe(6);
    expect(byId.get('ex-z')?.encompassedWeight).toBe(2);
    expect(byId.get('ex-s1')?.encompassedWeight).toBe(0);
    // прочие поля кандидатов не тронуты
    expect(byId.get('ex-y')?.exerciseScore).toBe(4.0);
  });

  it('входные объекты не меняются (копии), у копий свои веса', () => {
    const knocker = createReviewKnocker(stubGraph);
    const { candidates } = knocker.knockOutReviews(batch);
    for (const copy of candidates) {
      expect(batch).not.toContain(copy);
    }
    expect(y.encompassedWeight).toBe(0);
    expect(y.encompassesWeight).toBe(0);
  });

  it('encompassesWeight берётся из обратной карты', () => {
    const graph = {
      ...stubGraph(),
      getEncompassedBy: (id: UnitId): Array<[UnitId, number]> | undefined =>
        id === 'Y' ? [['s1', 1]] : undefined,
    };
    const knocker = createReviewKnocker(() => graph);
    const { candidates } = knocker.knockOutReviews([
      y,
      starters[0] as Candidate,
    ]);
    // старт Y идёт по «охвачен кем»: вес оседает на s1, который охватывает Y
    expect(
      candidates.find((c) => c.exerciseId === 'ex-s1')?.encompassesWeight,
    ).toBe(1);
    expect(
      candidates.find((c) => c.exerciseId === 'ex-y')?.encompassesWeight,
    ).toBe(0);
  });

  it('граф текущей библиотеки читается при каждом вызове', () => {
    let graph = stubGraph();
    const knocker = createReviewKnocker(() => graph);
    expect(knocker.knockOutReviews(batch).candidates).toHaveLength(15);
    graph = {
      getEncompasses: () => undefined,
      getEncompassedBy: () => undefined,
      getLessonCourse: () => undefined,
    };
    const { candidates, highlyEncompassed } = knocker.knockOutReviews(batch);
    expect(candidates).toHaveLength(batch.length);
    expect(highlyEncompassed).toEqual([]);
  });

  it('пустая пачка — пустой результат', () => {
    const knocker = createReviewKnocker(stubGraph);
    expect(knocker.knockOutReviews([])).toEqual({
      candidates: [],
      highlyEncompassed: [],
    });
  });

  it('на графе мира: удалены ровно упражнения с весом ≥ 10 и оценкой ≥ 4.5', () => {
    const library = buildWorldLibrary(chainCourses(20, 5, true));
    // чётные курсы — 4.5, нечётные — 4.0: очень сильные бывают только среди чётных
    const initial = batchOf(20, 5, (course) => (course % 2 === 0 ? 4.5 : 4.0));
    const forward = computeEncompassingMap(initial, library.graph, false);
    const knocker = createReviewKnocker(() => library.graph);
    const { candidates, highlyEncompassed } = knocker.knockOutReviews(initial);

    const weightOf = (c: Candidate) => forward.get(c.exerciseId) ?? 0;
    const expectedRemoved = initial.filter(
      (c) => weightOf(c) >= 10 && c.exerciseScore >= 4.5,
    );
    expect(expectedRemoved.length).toBeGreaterThan(0);
    expect(candidates).toHaveLength(initial.length - expectedRemoved.length);
    for (const removed of expectedRemoved) {
      expect(candidates.map((c) => c.exerciseId)).not.toContain(
        removed.exerciseId,
      );
    }
    for (const item of candidates) {
      expect(item.encompassedWeight).toBe(weightOf(item));
    }
    expect(highlyEncompassed.length).toBeGreaterThan(0);
    for (const item of highlyEncompassed) {
      expect(candidates).toContain(item);
      expect(item.encompassedWeight).toBeGreaterThanOrEqual(HIGHLY_WEIGHT);
    }
  });
});
