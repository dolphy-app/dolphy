import { describe, expect, it } from 'vitest';
import {
  encodeSavedFilter,
  encodeStudySession,
  encodeUnitFilter,
  parseExerciseFilter,
  parseKeyValueFilter,
  parseSavedFilter,
  parseSessionPart,
  parseStudySession,
  parseUnitFilter,
} from '../../src/scheduler/filter-codec.ts';

const parts = [
  {
    UnitFilter: {
      filter: { CourseFilter: { course_ids: ['0'] } },
      duration: 15,
    },
  },
  { SavedFilter: { filter_id: 'f1', duration: 30 } },
  { NoFilter: { duration: 5 } },
];

const unitFilterExamples: unknown[] = [
  { CourseFilter: { course_ids: ['c1', 'c2'] } },
  { LessonFilter: { lesson_ids: ['c1::l1'] } },
  'ReviewListFilter',
  { Dependents: { unit_ids: ['c1::l1'] } },
  { Dependencies: { unit_ids: ['c1::l1'], depth: 2 } },
  {
    MetadataFilter: {
      filter: {
        CombinedFilter: {
          op: 'All',
          filters: [
            {
              CourseFilter: { key: 'k', value: 'v', filter_type: 'Include' },
            },
            {
              CombinedFilter: {
                op: 'Any',
                filters: [
                  {
                    LessonFilter: {
                      key: 'k2',
                      value: 'v2',
                      filter_type: 'Exclude',
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  },
];

const valueOf = <T>(result: { ok: boolean; value?: T }): T => {
  expect(result.ok).toBe(true);
  return result.value as T;
};

describe('wire round-trip (spec §1.5)', () => {
  it.each(unitFilterExamples)('UnitFilter %j', (example) => {
    const parsed = valueOf(parseUnitFilter(example));
    expect(parsed).toEqual(example);
    expect(encodeUnitFilter(parsed)).toEqual(example);
    expect(JSON.parse(JSON.stringify(encodeUnitFilter(parsed)))).toEqual(
      example,
    );
  });

  it('SavedFilter', () => {
    const wire = { id: 'f1', description: 'd', filter: 'ReviewListFilter' };
    const parsed = valueOf(parseSavedFilter(wire));
    expect(encodeSavedFilter(parsed)).toEqual(wire);
  });

  it('StudySession', () => {
    const wire = { id: 's', description: 'desc', parts };
    const parsed = valueOf(parseStudySession(wire));
    expect(parsed).toEqual(wire);
    expect(encodeStudySession(parsed)).toEqual(wire);
  });

  it('ExerciseFilter', () => {
    expect(
      valueOf(parseExerciseFilter({ UnitFilter: 'ReviewListFilter' })),
    ).toEqual({ UnitFilter: 'ReviewListFilter' });
    const study = {
      StudySession: {
        startTimeMs: 1_790_000_000_000,
        definition: { id: 's', description: 'desc', parts },
      },
    };
    expect(valueOf(parseExerciseFilter(study))).toEqual(study);
  });

  it('SessionPart и KeyValueFilter разбираются по отдельности', () => {
    for (const part of parts) {
      expect(valueOf(parseSessionPart(part))).toEqual(part);
    }
    const kv = {
      CourseFilter: { key: 'k', value: 'v', filter_type: 'Include' },
    };
    expect(valueOf(parseKeyValueFilter(kv))).toEqual(kv);
  });
});

describe('parseUnitFilter', () => {
  it('принимает {"ReviewListFilter":null}, результат — голая строка', () => {
    expect(valueOf(parseUnitFilter({ ReviewListFilter: null }))).toBe(
      'ReviewListFilter',
    );
  });

  it('вырезает лишние ключи структур', () => {
    const parsed = valueOf(
      parseUnitFilter({
        Dependencies: { unit_ids: ['a'], depth: 1, extra: true },
      }),
    );
    expect(parsed).toEqual({ Dependencies: { unit_ids: ['a'], depth: 1 } });
  });

  it.each([
    ['без depth', { Dependencies: { unit_ids: ['a'] } }],
    ['depth < 0', { Dependencies: { unit_ids: ['a'], depth: -1 } }],
    ['нецелый depth', { Dependencies: { unit_ids: ['a'], depth: 1.5 } }],
    ['неизвестный вариант', { Nope: {} }],
    [
      'два варианта сразу',
      { CourseFilter: { course_ids: [] }, Dependents: { unit_ids: [] } },
    ],
    ['неизвестная строка', 'reviewlistfilter'],
    ['null вместо списка', { CourseFilter: { course_ids: null } }],
    [
      'неверный filter_type',
      {
        MetadataFilter: {
          filter: {
            CourseFilter: { key: 'k', value: 'v', filter_type: 'include' },
          },
        },
      },
    ],
  ])('отказ: %s', (_name, raw) => {
    const result = parseUnitFilter(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('parseSessionPart', () => {
  it.each([
    ['отрицательная duration', -1],
    ['дробная duration', 1.5],
    ['duration > 2^31', 2 ** 31 + 1],
  ])('отказ: %s', (_name, duration) => {
    expect(parseSessionPart({ NoFilter: { duration } }).ok).toBe(false);
  });

  it('границы duration: 0 и 2^31', () => {
    expect(parseSessionPart({ NoFilter: { duration: 0 } }).ok).toBe(true);
    expect(parseSessionPart({ NoFilter: { duration: 2 ** 31 } }).ok).toBe(true);
  });
});

describe('parseSavedFilter / parseStudySession', () => {
  it('SavedFilter без description невалиден', () => {
    const result = parseSavedFilter({ id: 'f', filter: 'ReviewListFilter' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.path).toBe('description');
  });

  it('пустой id невалиден', () => {
    expect(
      parseSavedFilter({ id: '', description: '', filter: 'ReviewListFilter' })
        .ok,
    ).toBe(false);
    expect(parseStudySession({ id: '' }).ok).toBe(false);
  });

  it('StudySession: description и parts по умолчанию', () => {
    expect(valueOf(parseStudySession({ id: 's', extra: 1 }))).toEqual({
      id: 's',
      description: '',
      parts: [],
    });
  });

  it('null вместо default-поля — ошибка', () => {
    expect(parseStudySession({ id: 's', parts: null }).ok).toBe(false);
    expect(parseStudySession({ id: 's', description: null }).ok).toBe(false);
  });

  it('encodeStudySession дописывает умолчания', () => {
    expect(encodeStudySession({ id: 's' })).toEqual({
      id: 's',
      description: '',
      parts: [],
    });
  });

  it('пути ошибок указывают на место в документе', () => {
    const result = parseStudySession({
      id: 's',
      parts: [{ NoFilter: { duration: -1 } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.every((i) => i.path.startsWith('parts[0]'))).toBe(
        true,
      );
    }
  });
});
