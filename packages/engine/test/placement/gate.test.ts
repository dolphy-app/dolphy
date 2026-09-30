import { buildLibrary } from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import { assembleLibrary } from '../../src/domain/library.ts';
import type { Library } from '../../src/domain/library.ts';
import { loadDirectory } from '../../src/authoring/load-directory.ts';
import { createNodeFsCourseSource } from '../../src/node/index.ts';
import {
  CLASS_KNOWN,
  CLASS_UNCERTAIN,
  CLASS_UNKNOWN,
  PLACEMENT_GRADE,
  buildPlacementTopics,
  createDiagnosticSession,
  frontierOf,
  placementAttempts,
  runDiagnostic,
} from '../../src/placement/index.ts';
import type { PlacementTopics } from '../../src/placement/index.ts';
import { LIBRARIES_DIR } from '../helpers/fixtures.ts';
import {
  isDownset,
  lessonPasses,
  openFrontier,
  trueFrontier,
} from './helpers.ts';
import type { GateAttempt, LessonInfo } from './helpers.ts';

const lessonOf = (id: string, n = 3): LessonInfo => ({
  id,
  exercises: Array.from({ length: n }, (_, i) => `${id}::e${i}`),
});

const attemptsOf = (
  lesson: LessonInfo,
  exercises: number[],
  perExercise: number,
  grade = 4,
): GateAttempt[] =>
  exercises.flatMap((i) =>
    Array.from({ length: perExercise }, (_, a) => ({
      exerciseId: lesson.exercises[i] as string,
      lessonId: lesson.id,
      grade,
      at: a,
    })),
  );

/** Попытки placement → входы строгого гейта (урок — по индексу темы). */
const gateAttempts = (
  topics: PlacementTopics,
  classes: ArrayLike<number>,
): GateAttempt[] => {
  const lessonByExercise = new Map<string, string>();
  topics.exercises.forEach((own, topic) => {
    for (const id of own)
      lessonByExercise.set(id, topics.graph.ids[topic] as string);
  });
  return placementAttempts(topics, classes).map((a) => ({
    exerciseId: a.exerciseId,
    lessonId: lessonByExercise.get(a.exerciseId) as string,
    grade: PLACEMENT_GRADE,
    at: a.offsetMs,
  }));
};

const lessonsOf = (topics: PlacementTopics): LessonInfo[] =>
  topics.graph.ids.map((id, topic) => ({
    id,
    exercises: topics.exercises[topic] as readonly string[],
  }));

describe('строгий гейт (T-46)', () => {
  const lesson = lessonOf('L');

  it('2 попытки × все упражнения на оценке 4 открывают; границы закрывают', () => {
    expect(lessonPasses(lesson, attemptsOf(lesson, [0, 1, 2], 2))).toBe(true);
    // средняя попыток 1.0 < 1.8
    expect(lessonPasses(lesson, attemptsOf(lesson, [0, 1, 2], 1))).toBe(false);
    // непройденные упражнения дают 0: среднее 4·1/3 < 3
    expect(lessonPasses(lesson, attemptsOf(lesson, [0], 2))).toBe(false);
    // ровно 3.0
    expect(lessonPasses(lesson, attemptsOf(lesson, [0, 1, 2], 2, 3))).toBe(
      true,
    );
    expect(lessonPasses(lesson, attemptsOf(lesson, [0, 1, 2], 2, 2))).toBe(
      false,
    );
  });

  it('нет данных = закрыт', () => {
    expect(lessonPasses(lesson, [])).toBe(false);
    expect(lessonPasses({ id: 'E', exercises: [] }, [])).toBe(false);
  });
});

describe('placement открывает ровно фронтир', () => {
  // 0←1←2, 0←3, {2,3}←4, 4←5, 0←6←7
  const deps: Record<string, string[]> = {
    t0: [],
    t1: ['t0'],
    t2: ['t1'],
    t3: ['t0'],
    t4: ['t2', 't3'],
    t5: ['t4'],
    t6: ['t0'],
    t7: ['t6'],
  };
  const spec = buildLibrary({
    courses: [
      {
        id: 'c',
        lessons: Object.entries(deps).map(([id, dependencies]) => ({
          id,
          dependencies,
          exercises: 3,
        })),
      },
    ],
  });
  const library: Library = assembleLibrary(
    spec.courses,
    spec.lessons,
    spec.exercises,
    { cycleCheck: true },
  );
  const topics = buildPlacementTopics(library);
  const known = new Set([0, 1, 2, 3, 6]);
  const truth = Uint8Array.from({ length: 8 }, (_, i) =>
    known.has(i) ? 1 : 0,
  );

  it('безшумная диагностика → попытки → гейт: фронтир гейта = диагностики = истинный', () => {
    const session = createDiagnosticSession(topics.graph, {
      budget: 8,
      seed: 5,
    });
    const classes = runDiagnostic(session, (u) => truth[u] === 1);
    expect(
      [...classes].flatMap((c, i) => (c === CLASS_KNOWN ? [i] : [])),
    ).toEqual([0, 1, 2, 3, 6]);
    const attempts = gateAttempts(topics, classes);
    expect(attempts).toHaveLength(5 * 3 * 2);
    const gate = openFrontier(topics.graph, lessonsOf(topics), attempts);
    expect(gate).toEqual(frontierOf(topics.graph, classes));
    expect(gate).toEqual(trueFrontier(topics.graph, truth));
    expect(gate).toEqual([4, 7]);
  });

  it('одна попытка на упражнение не открыла бы зависимых (гейт требует ≥ 1.8)', () => {
    const classes = Uint8Array.from(truth);
    const single = gateAttempts(topics, classes).filter((a) => a.at === 0);
    expect(single).toHaveLength(15);
    expect(openFrontier(topics.graph, lessonsOf(topics), single)).toEqual([0]);
  });

  it('placementAttempts: по 2 попытки на упражнение known, порядок кругами, unknown/uncertain пропущены', () => {
    const classes = new Uint8Array(8).fill(CLASS_UNKNOWN);
    classes[0] = CLASS_KNOWN;
    classes[1] = CLASS_KNOWN;
    classes[2] = CLASS_UNCERTAIN;
    const attempts = placementAttempts(topics, classes);
    expect(attempts).toHaveLength(2 * 3 * 2);
    const first = attempts.slice(0, 6);
    const second = attempts.slice(6);
    expect(first.every((a) => a.offsetMs === 0)).toBe(true);
    expect(second.every((a) => a.offsetMs > 0)).toBe(true);
    expect(second.map((a) => a.exerciseId)).toEqual(
      first.map((a) => a.exerciseId),
    );
    expect(new Set(first.map((a) => a.exerciseId)).size).toBe(6);
    expect(PLACEMENT_GRADE).toBeGreaterThanOrEqual(3);
    expect(placementAttempts(topics, new Uint8Array(8))).toEqual([]);
  });
});

describe('sql-course (7 уроков)', () => {
  it('диагностика восстанавливает downset {select, where, aggregate} вместе с корнем ddl', async () => {
    const { library, diagnostics } = await loadDirectory(
      createNodeFsCourseSource(`${LIBRARIES_DIR}/sql-course/lib_json`),
    );
    expect(diagnostics).toEqual([]);
    if (library === null) throw new Error('library is not loaded');
    const topics = buildPlacementTopics(library);
    expect(topics.graph.size).toBe(7);
    expect(topics.exercises.every((own) => own.length >= 2)).toBe(true);
    expect(topics.verifiable.every(Boolean)).toBe(true);

    const truth = new Uint8Array(7);
    for (const name of ['ddl', 'select', 'where', 'aggregate']) {
      truth[topics.graph.ids.indexOf(`sql_json::${name}`)] = 1;
    }
    expect(isDownset(topics.graph, truth)).toBe(true);
    const session = createDiagnosticSession(topics.graph, {
      budget: 7,
      seed: 1,
    });
    const classes = runDiagnostic(session, (u) => truth[u] === 1);
    expect([...classes]).toEqual(
      [...truth].map((t) => (t === 1 ? CLASS_KNOWN : CLASS_UNKNOWN)),
    );
    expect(session.probes.length).toBeLessThan(7);
    const gate = openFrontier(
      topics.graph,
      lessonsOf(topics),
      gateAttempts(topics, classes),
    );
    expect(gate).toEqual(trueFrontier(topics.graph, truth));
  });
});
