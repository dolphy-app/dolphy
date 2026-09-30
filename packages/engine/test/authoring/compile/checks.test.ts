import type { Diagnostic, DiagnosticCode } from '@dolphy-app/engine-contract';
import { createFakeExerciseTypes } from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  DEFAULT_CHECK_OPTIONS,
  locateFinding,
  runChecks,
} from '../../../src/authoring/checks.ts';
import type { CheckOptions } from '../../../src/authoring/checks.ts';
import { sortDiagnostics } from '../../../src/authoring/diagnostics.ts';
import { buildModel } from '../../helpers/model-builder.ts';
import type { ExerciseSpec, ModelSpec } from '../../helpers/model-builder.ts';

const run = (spec: ModelSpec, options: Partial<CheckOptions> = {}) => {
  const index = buildIndex(buildModel(spec));
  const { findings } = runChecks(index, {
    ...DEFAULT_CHECK_OPTIONS,
    ...options,
  });
  return sortDiagnostics(findings.map((f) => locateFinding(index, f)));
};

const ofCode = (diagnostics: Diagnostic[], code: DiagnosticCode) =>
  diagnostics.filter((d) => d.code === code);

const codesOf = (diagnostics: Diagnostic[]) => [
  ...new Set(diagnostics.map((d) => d.code)),
];

/** Курс `crs` и уроки `crs::a`, `crs::b`, … без зависимостей. */
const lessons = (...names: string[]) =>
  names.map((name) => ({ id: `crs::${name}`, course: 'crs' }));

describe('ids', () => {
  it('E_ID_EMPTY points at the id of the unit', () => {
    const found = run({ courses: [{ id: '' }] });
    expect(ofCode(found, 'E_ID_EMPTY')).toEqual([
      expect.objectContaining({
        unitId: '',
        path: '/course_manifest.json',
        line: 2,
      }),
    ]);
  });

  it('E_ID_DUPLICATE is reported at the second definition and names the first', () => {
    const found = run({
      courses: [{ id: 'c1' }, { id: 'c2' }],
      lessons: [
        { id: 'shared', course: 'c1' },
        { id: 'shared', course: 'c2' },
      ],
    });
    expect(ofCode(found, 'E_ID_DUPLICATE')).toEqual([
      expect.objectContaining({
        unitId: 'shared',
        path: 'c2/shared/lesson_manifest.json',
        line: 2,
        related: ['c1/shared/lesson_manifest.json'],
      }),
    ]);
  });

  it('an id shared by a course and a lesson is a duplicate too', () => {
    const found = run({
      courses: [{ id: 'crs' }, { id: 'x' }],
      lessons: [{ id: 'x', course: 'crs' }],
    });
    const [duplicate] = ofCode(found, 'E_ID_DUPLICATE');
    expect(duplicate?.path).toBe('crs/x/lesson_manifest.json');
  });

  it('E_ID_MISMATCH: lesson course_id, exercise lesson_id and course_id', () => {
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [{ id: 'crs::a', course: 'crs', courseIdInManifest: 'other' }],
      exercises: [
        {
          id: 'crs::a::e',
          lesson: 'crs::a',
          lessonIdInManifest: 'crs::z',
          courseIdInManifest: 'other',
        },
      ],
    });
    expect(
      ofCode(found, 'E_ID_MISMATCH')
        .map((d) => `${d.unitId} ${d.path}`)
        .sort(),
    ).toEqual([
      'crs::a crs/a/lesson_manifest.json',
      'crs::a::e crs/a/e/exercise_manifest.json',
      'crs::a::e crs/a/e/exercise_manifest.json',
    ]);
  });

  it('matching ids give no E_ID_* findings', () => {
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: lessons('a'),
      exercises: [{ id: 'crs::a::e', lesson: 'crs::a' }],
    });
    expect(codesOf(found).filter((code) => code.startsWith('E_ID_'))).toEqual(
      [],
    );
  });
});

describe('references', () => {
  it('E_DEP_MISSING names the missing target and the dependencies line', () => {
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [{ id: 'crs::a', course: 'crs', dependencies: ['ghost'] }],
    });
    expect(ofCode(found, 'E_DEP_MISSING')).toEqual([
      expect.objectContaining({
        unitId: 'crs::a',
        related: ['ghost'],
        path: 'crs/a/lesson_manifest.json',
        line: 3,
      }),
    ]);
  });

  it('a dependency on a unit of a skipped (unsupported generator) course is not missing', () => {
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [
        {
          id: 'crs::a',
          course: 'crs',
          dependencies: ['gen', 'gen::lesson_1'],
        },
      ],
      skippedCourses: ['gen'],
    });
    expect(ofCode(found, 'E_DEP_MISSING')).toEqual([]);
  });

  it('a dependency on a similarly named id of a skipped course prefix is still missing', () => {
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [{ id: 'crs::a', course: 'crs', dependencies: ['generic'] }],
      skippedCourses: ['gen'],
    });
    expect(ofCode(found, 'E_DEP_MISSING')).toHaveLength(1);
  });

  it('self-dependency is E_DEP_SELF only, not a one-node cycle', () => {
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [{ id: 'crs::a', course: 'crs', dependencies: ['crs::a'] }],
    });
    expect(ofCode(found, 'E_DEP_SELF')).toHaveLength(1);
    expect(ofCode(found, 'E_CYCLE_DEPENDENCY')).toEqual([]);
  });

  it('E_DEP_KIND: a lesson depending on an exercise and a course depending on a lesson', () => {
    const found = run({
      courses: [{ id: 'crs' }, { id: 'crs2', dependencies: ['crs::a'] }],
      lessons: [
        ...lessons('a'),
        { id: 'crs::b', course: 'crs', dependencies: ['crs::a::e'] },
      ],
      exercises: [{ id: 'crs::a::e', lesson: 'crs::a' }],
    });
    expect(
      ofCode(found, 'E_DEP_KIND')
        .map((d) => d.unitId)
        .sort(),
    ).toEqual(['crs2', 'crs::b']);
  });

  it('E_ENC_WEIGHT accepts 0 and 1 and rejects values outside [0, 1]', () => {
    const encompassed: Array<[string, number]> = [
      ['crs::a', 0],
      ['crs::a', 1],
      ['crs::a', 1.5],
      ['crs::a', -0.1],
    ];
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [
        ...lessons('a'),
        {
          id: 'crs::b',
          course: 'crs',
          dependencies: ['crs::a'],
          encompassed,
        },
      ],
    });
    expect(ofCode(found, 'E_ENC_WEIGHT')).toHaveLength(2);
    expect(ofCode(found, 'E_ENC_WEIGHT')[0]).toMatchObject({
      unitId: 'crs::b',
      line: 4,
      related: ['crs::a'],
    });
  });

  it('E_ENC_MISSING and E_SUP_MISSING', () => {
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [
        {
          id: 'crs::a',
          course: 'crs',
          encompassed: [['ghost', 0.5]],
          superseded: ['phantom'],
        },
      ],
    });
    expect(ofCode(found, 'E_ENC_MISSING')).toEqual([
      expect.objectContaining({ related: ['ghost'], line: 4 }),
    ]);
    expect(ofCode(found, 'E_SUP_MISSING')).toEqual([
      expect.objectContaining({ related: ['phantom'], line: 5 }),
    ]);
    // отсутствующая цель не порождает ещё и «не предок»
    expect(ofCode(found, 'E_ENC_NOT_ANCESTOR')).toEqual([]);
  });
});

describe('cycles', () => {
  it('E_CYCLE_DEPENDENCY carries the full path in related and the message', () => {
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [
        { id: 'crs::a', course: 'crs', dependencies: ['crs::c'] },
        { id: 'crs::b', course: 'crs', dependencies: ['crs::a'] },
        { id: 'crs::c', course: 'crs', dependencies: ['crs::b'] },
      ],
    });
    const cycles = ofCode(found, 'E_CYCLE_DEPENDENCY');
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.related).toEqual([
      'crs::a',
      'crs::c',
      'crs::b',
      'crs::a',
    ]);
    expect(cycles[0]).toMatchObject({
      unitId: 'crs::a',
      path: 'crs/a/lesson_manifest.json',
      line: 3,
    });
    expect(cycles[0]?.message).toContain(
      'crs::a -> crs::c -> crs::b -> crs::a',
    );
    // такой цикл — ещё и цикл охвата, но отдельно он не называется
    expect(ofCode(found, 'E_CYCLE_ENCOMPASSED')).toEqual([]);
  });

  it('E_CYCLE_SUPERSEDED', () => {
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [
        { id: 'crs::a', course: 'crs', superseded: ['crs::b'] },
        { id: 'crs::b', course: 'crs', superseded: ['crs::a'] },
      ],
    });
    expect(ofCode(found, 'E_CYCLE_SUPERSEDED')).toEqual([
      expect.objectContaining({
        unitId: 'crs::a',
        related: ['crs::a', 'crs::b', 'crs::a'],
        line: 5,
      }),
    ]);
  });

  it('E_CYCLE_ENCOMPASSED through explicit encompassed entries only', () => {
    const engine = { nonAncestor: true };
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [
        {
          id: 'crs::a',
          course: 'crs',
          encompassed: [['crs::b', 0.5]],
          engine,
        },
        {
          id: 'crs::b',
          course: 'crs',
          encompassed: [['crs::a', 0.5]],
          engine,
        },
      ],
    });
    expect(ofCode(found, 'E_CYCLE_ENCOMPASSED')).toEqual([
      expect.objectContaining({
        unitId: 'crs::a',
        related: ['crs::a', 'crs::b', 'crs::a'],
        line: 4,
      }),
    ]);
    expect(ofCode(found, 'E_CYCLE_DEPENDENCY')).toEqual([]);
  });

  it('a lesson depending on its own course is a cycle through containment', () => {
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [{ id: 'crs::a', course: 'crs', dependencies: ['crs'] }],
    });
    const [cycle] = ofCode(found, 'E_CYCLE_DEPENDENCY');
    expect(cycle?.unitId).toBe('crs::a');
    expect(cycle?.related).toContain('crs::a');
  });

  it('stops after maxCycles distinct cycles', () => {
    const pairs = ['a', 'b', 'c', 'd', 'e'];
    const found = run(
      {
        courses: [{ id: 'crs' }],
        lessons: pairs.flatMap((name) => [
          { id: `crs::${name}1`, course: 'crs', superseded: [`crs::${name}2`] },
          { id: `crs::${name}2`, course: 'crs', superseded: [`crs::${name}1`] },
        ]),
      },
      { maxCycles: 3 },
    );
    expect(ofCode(found, 'E_CYCLE_SUPERSEDED')).toHaveLength(3);
  });
});

describe('graph shape', () => {
  it('W_REDUNDANT_EDGE names the dependency and the witness prerequisite', () => {
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [
        { id: 'crs::a', course: 'crs' },
        { id: 'crs::b', course: 'crs', dependencies: ['crs::a'] },
        { id: 'crs::c', course: 'crs', dependencies: ['crs::b', 'crs::a'] },
      ],
    });
    expect(ofCode(found, 'W_REDUNDANT_EDGE')).toEqual([
      expect.objectContaining({
        unitId: 'crs::c',
        related: ['crs::a', 'crs::b'],
        path: 'crs/c/lesson_manifest.json',
        line: 3,
      }),
    ]);
  });

  it('a redundant edge is found through a longer chain, a diamond is not redundant', () => {
    const chain = run({
      courses: [{ id: 'crs' }],
      lessons: [
        { id: 'crs::a', course: 'crs' },
        { id: 'crs::b', course: 'crs', dependencies: ['crs::a'] },
        { id: 'crs::c', course: 'crs', dependencies: ['crs::b'] },
        { id: 'crs::d', course: 'crs', dependencies: ['crs::c', 'crs::a'] },
      ],
    });
    expect(ofCode(chain, 'W_REDUNDANT_EDGE')).toEqual([
      expect.objectContaining({
        unitId: 'crs::d',
        related: ['crs::a', 'crs::c'],
      }),
    ]);
    const diamond = run({
      courses: [{ id: 'crs' }],
      lessons: [
        { id: 'crs::a', course: 'crs' },
        { id: 'crs::b', course: 'crs', dependencies: ['crs::a'] },
        { id: 'crs::c', course: 'crs', dependencies: ['crs::a'] },
        { id: 'crs::d', course: 'crs', dependencies: ['crs::b', 'crs::c'] },
      ],
    });
    expect(ofCode(diamond, 'W_REDUNDANT_EDGE')).toEqual([]);
  });

  it('a repeated dependency is not redundant with itself', () => {
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [
        { id: 'crs::a', course: 'crs' },
        { id: 'crs::b', course: 'crs', dependencies: ['crs::a', 'crs::a'] },
      ],
    });
    expect(ofCode(found, 'W_REDUNDANT_EDGE')).toEqual([]);
  });

  it('E_ENC_NOT_ANCESTOR: unrelated target is an error, dependency and transitive ancestor are fine', () => {
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [
        { id: 'crs::a', course: 'crs' },
        { id: 'crs::b', course: 'crs', dependencies: ['crs::a'] },
        {
          id: 'crs::c',
          course: 'crs',
          dependencies: ['crs::b'],
          encompassed: [
            ['crs::b', 1],
            ['crs::a', 0.5],
          ],
        },
        {
          id: 'crs::d',
          course: 'crs',
          encompassed: [['crs::a', 0.5]],
        },
      ],
    });
    expect(ofCode(found, 'E_ENC_NOT_ANCESTOR')).toEqual([
      expect.objectContaining({
        unitId: 'crs::d',
        related: ['crs::a'],
        line: 4,
      }),
    ]);
  });

  it('a dependency on a course makes its lessons ancestors, and courses inherit down to lessons', () => {
    const found = run({
      courses: [{ id: 'crs' }, { id: 'crs2', dependencies: ['crs'] }],
      lessons: [
        ...lessons('a'),
        {
          id: 'crs2::x',
          course: 'crs2',
          encompassed: [['crs::a', 0.5]],
        },
      ],
    });
    expect(ofCode(found, 'E_ENC_NOT_ANCESTOR')).toEqual([]);
  });

  it('nonAncestor: true and a matching array remove E_ENC_NOT_ANCESTOR, a different array does not', () => {
    const build = (nonAncestor: boolean | string[]) =>
      run({
        courses: [{ id: 'crs' }],
        lessons: [
          ...lessons('a'),
          {
            id: 'crs::b',
            course: 'crs',
            encompassed: [['crs::a', 0.5]],
            engine: { nonAncestor },
          },
        ],
      });
    expect(ofCode(build(true), 'E_ENC_NOT_ANCESTOR')).toEqual([]);
    expect(ofCode(build(['crs::a']), 'E_ENC_NOT_ANCESTOR')).toEqual([]);
    expect(ofCode(build(['crs::other']), 'E_ENC_NOT_ANCESTOR')).toHaveLength(1);
    expect(ofCode(build(false), 'E_ENC_NOT_ANCESTOR')).toHaveLength(1);
  });

  it('W_FAN_IN: 7 prerequisites pass, 8 warn; maxFanIn is configurable', () => {
    const names = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    const build = (count: number, options: Partial<CheckOptions> = {}) =>
      run(
        {
          courses: [{ id: 'crs' }],
          lessons: [
            ...lessons(...names),
            {
              id: 'crs::top',
              course: 'crs',
              dependencies: names.slice(0, count).map((n) => `crs::${n}`),
            },
          ],
        },
        options,
      );
    expect(ofCode(build(7), 'W_FAN_IN')).toEqual([]);
    expect(ofCode(build(8), 'W_FAN_IN')).toEqual([
      expect.objectContaining({ unitId: 'crs::top', line: 3 }),
    ]);
    expect(ofCode(build(3, { maxFanIn: 2 }), 'W_FAN_IN')).toHaveLength(1);
  });

  it('W_ORPHAN_LESSON: only a disconnected lesson of a multi-lesson course', () => {
    const found = run({
      courses: [{ id: 'crs' }, { id: 'solo' }],
      lessons: [
        { id: 'crs::a', course: 'crs' },
        { id: 'crs::b', course: 'crs', dependencies: ['crs::a'] },
        { id: 'crs::lonely', course: 'crs' },
        { id: 'solo::only', course: 'solo' },
      ],
    });
    expect(ofCode(found, 'W_ORPHAN_LESSON').map((d) => d.unitId)).toEqual([
      'crs::lonely',
    ]);
  });
});

describe('engine extension', () => {
  const ancestry = (
    keyPrerequisites: string[],
    exercise: Partial<ExerciseSpec> = {},
  ) =>
    run({
      courses: [{ id: 'crs' }],
      lessons: [
        { id: 'crs::a', course: 'crs' },
        { id: 'crs::b', course: 'crs', dependencies: ['crs::a'] },
        { id: 'crs::z', course: 'crs' },
      ],
      exercises: [
        { id: 'crs::a::e', lesson: 'crs::a' },
        { id: 'crs::z::e', lesson: 'crs::z' },
        {
          id: 'crs::b::e',
          lesson: 'crs::b',
          engine: { keyPrerequisites },
          ...exercise,
        },
      ],
    });

  it('E_KEYPREREQ_MISSING for an id that does not exist', () => {
    const found = ancestry(['ghost']);
    expect(ofCode(found, 'E_KEYPREREQ_MISSING')).toEqual([
      expect.objectContaining({
        unitId: 'crs::b::e',
        related: ['ghost'],
        path: 'crs/b/e/exercise_manifest.json',
        line: 6,
      }),
    ]);
  });

  it('keyPrerequisites accept an ancestor lesson and an exercise of an ancestor lesson', () => {
    const found = ancestry(['crs::a', 'crs::a::e']);
    expect(ofCode(found, 'E_KEYPREREQ_NOT_ANCESTOR')).toEqual([]);
    expect(ofCode(found, 'E_KEYPREREQ_MISSING')).toEqual([]);
  });

  it('E_KEYPREREQ_NOT_ANCESTOR: an unrelated lesson, an exercise of an unrelated lesson, the own lesson', () => {
    const found = ancestry(['crs::z', 'crs::z::e', 'crs::b']);
    expect(
      ofCode(found, 'E_KEYPREREQ_NOT_ANCESTOR')
        .flatMap((d) => d.related ?? [])
        .sort(),
    ).toEqual(['crs::b', 'crs::z', 'crs::z::e']);
  });

  it('lesson-level keyPrerequisites are checked against the lesson itself', () => {
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [
        { id: 'crs::a', course: 'crs' },
        {
          id: 'crs::b',
          course: 'crs',
          engine: { keyPrerequisites: ['crs::a'] },
        },
      ],
    });
    expect(ofCode(found, 'E_KEYPREREQ_NOT_ANCESTOR')).toHaveLength(1);
  });

  it('E_NO_VERIFICATION with requiresChecks, aggregated I_NO_VERIFICATION without', () => {
    const exercise = { type: 'dolphy.sql' };
    const found = run({
      courses: [
        { id: 'strict', engine: { requiresChecks: true } },
        { id: 'loose' },
      ],
      lessons: [
        { id: 'strict::a', course: 'strict' },
        { id: 'loose::a', course: 'loose' },
      ],
      exercises: [
        { id: 'strict::a::x', lesson: 'strict::a' },
        { id: 'strict::a::ok', lesson: 'strict::a', engine: { exercise } },
        { id: 'loose::a::x', lesson: 'loose::a' },
        { id: 'loose::a::y', lesson: 'loose::a' },
        { id: 'loose::a::ok', lesson: 'loose::a', engine: { exercise } },
      ],
    });
    expect(ofCode(found, 'E_NO_VERIFICATION').map((d) => d.unitId)).toEqual([
      'strict::a::x',
    ]);
    expect(ofCode(found, 'I_NO_VERIFICATION')).toEqual([
      expect.objectContaining({
        unitId: 'loose::a',
        related: ['loose::a::x', 'loose::a::y'],
      }),
    ]);
    expect(found.find((d) => d.code === 'I_NO_VERIFICATION')?.severity).toBe(
      'info',
    );
  });

  it('a broken front/engine does not cascade into E_NO_VERIFICATION or I_NO_VERIFICATION', () => {
    const found = run({
      courses: [{ id: 'strict', engine: { requiresChecks: true } }],
      lessons: [{ id: 'strict::a', course: 'strict' }],
      exercises: [
        { id: 'strict::a::x', lesson: 'strict::a', engineBroken: true },
      ],
    });
    expect(ofCode(found, 'E_NO_VERIFICATION')).toEqual([]);
    expect(ofCode(found, 'I_NO_VERIFICATION')).toEqual([]);
  });

  describe('exercise types', () => {
    const spec: ModelSpec = {
      courses: [{ id: 'crs' }],
      lessons: lessons('a'),
      exercises: [
        {
          id: 'crs::a::x',
          lesson: 'crs::a',
          engine: { exercise: { type: 'dolphy.sql', spec: { fixture: 1 } } },
        },
      ],
    };

    it('W_UNKNOWN_EXERCISE_TYPE for a type outside the catalog', () => {
      const exerciseTypes = createFakeExerciseTypes();
      expect(
        ofCode(run(spec, { exerciseTypes }), 'W_UNKNOWN_EXERCISE_TYPE'),
      ).toEqual([
        expect.objectContaining({
          unitId: 'crs::a::x',
          severity: 'warning',
          message:
            "exercise type 'dolphy.sql' is not provided by any installed extension",
        }),
      ]);
    });

    it('E_EXERCISE_SPEC joins the schema violations of a spec', () => {
      const exerciseTypes = createFakeExerciseTypes({
        types: {
          'dolphy.sql': {
            specErrors: ['/fixture must be string', '/ missing'],
          },
        },
      });
      const found = run(spec, { exerciseTypes });
      expect(ofCode(found, 'E_EXERCISE_SPEC')).toEqual([
        expect.objectContaining({
          unitId: 'crs::a::x',
          severity: 'error',
          message: '/fixture must be string; / missing',
        }),
      ]);
      expect(ofCode(found, 'W_UNKNOWN_EXERCISE_TYPE')).toEqual([]);
    });

    it('a valid spec gives neither code', () => {
      const exerciseTypes = createFakeExerciseTypes({
        types: { 'dolphy.sql': {} },
      });
      const found = run(spec, { exerciseTypes });
      expect(ofCode(found, 'E_EXERCISE_SPEC')).toEqual([]);
      expect(ofCode(found, 'W_UNKNOWN_EXERCISE_TYPE')).toEqual([]);
    });

    it('without a catalog (exerciseTypes: null) neither code is reported', () => {
      const found = run(spec, { exerciseTypes: null });
      expect(ofCode(found, 'E_EXERCISE_SPEC')).toEqual([]);
      expect(ofCode(found, 'W_UNKNOWN_EXERCISE_TYPE')).toEqual([]);
    });
  });
});

describe('W_GRANULARITY', () => {
  const courseWith = (count: number, engine?: object) =>
    run({
      courses: [{ id: 'crs', ...(engine !== undefined ? { engine } : {}) }],
      lessons: lessons('a'),
      exercises: Array.from({ length: count }, (_, i) => ({
        id: `crs::a::e${i}`,
        lesson: 'crs::a',
      })),
    });
  const granularity = (count: number, engine: object = {}) =>
    ofCode(courseWith(count, engine), 'W_GRANULARITY');

  it('2 exercises warn on the lesson file', () => {
    expect(granularity(2)).toEqual([
      expect.objectContaining({
        unitId: 'crs::a',
        path: 'crs/a/lesson_manifest.json',
        severity: 'warning',
      }),
    ]);
  });

  it('13 exercises warn', () => {
    expect(granularity(13)).toHaveLength(1);
  });

  it('3 and 12 exercises are inside the default bounds', () => {
    expect(granularity(3)).toEqual([]);
    expect(granularity(12)).toEqual([]);
  });

  it('a lesson without exercises is below the minimum', () => {
    expect(granularity(0)).toHaveLength(1);
  });

  it('engine.granularity of the course overrides the defaults', () => {
    expect(granularity(2, { granularity: { min: 2, max: 2 } })).toEqual([]);
    expect(granularity(3, { granularity: { min: 2, max: 2 } })).toHaveLength(1);
    // непереопределённый порог остаётся умолчанием
    expect(granularity(13, { granularity: { min: 1 } })).toHaveLength(1);
    expect(granularity(12, { granularity: { min: 1 } })).toEqual([]);
    expect(granularity(1, { granularity: { min: 1 } })).toEqual([]);
  });

  it('a course without an engine block is silent, even for a lesson with one exercise', () => {
    expect(ofCode(courseWith(1), 'W_GRANULARITY')).toEqual([]);
    expect(ofCode(courseWith(0), 'W_GRANULARITY')).toEqual([]);
  });
});

describe('several defects in one pass (T-17)', () => {
  it('reports a cycle, a missing reference, a redundant edge and more at once', () => {
    const found = run({
      courses: [{ id: 'crs' }],
      lessons: [
        { id: 'crs::a', course: 'crs', dependencies: ['crs::c'] },
        { id: 'crs::b', course: 'crs', dependencies: ['crs::a'] },
        { id: 'crs::c', course: 'crs', dependencies: ['crs::b'] },
        { id: 'crs::d', course: 'crs', dependencies: ['ghost', 'crs::d'] },
        { id: 'crs::e', course: 'crs' },
        { id: 'crs::f', course: 'crs', dependencies: ['crs::e'] },
        { id: 'crs::g', course: 'crs', dependencies: ['crs::f', 'crs::e'] },
      ],
      exercises: [
        {
          id: 'crs::e::x',
          lesson: 'crs::e',
          engine: { exercise: { type: 'python' } },
        },
      ],
    });
    expect(codesOf(found).sort()).toEqual([
      'E_CYCLE_DEPENDENCY',
      'E_DEP_MISSING',
      'E_DEP_SELF',
      'W_REDUNDANT_EDGE',
    ]);
    const cycle = ofCode(found, 'E_CYCLE_DEPENDENCY')[0];
    expect(cycle?.related).toEqual(['crs::a', 'crs::c', 'crs::b', 'crs::a']);
    expect(ofCode(found, 'W_REDUNDANT_EDGE')[0]).toMatchObject({
      unitId: 'crs::g',
      related: ['crs::e', 'crs::f'],
    });
  });
});
