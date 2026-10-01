/**
 * Кодеки wire-формата фильтров и учебных сессий Trane v0.34.1 на zod 4
 * (разделы 1.4–1.5 спеки поведения Trane).
 *
 * Правила serde: неизвестные ключи структур отбрасываются; внешне
 * тегированный enum — объект ровно с одним ключом-вариантом, unit-вариант —
 * строка (принимается и `{"ReviewListFilter":null}`, выдаётся строка);
 * `#[serde(default)]` — ключ можно опустить, `null` — ошибка.
 */
import * as z from 'zod';
import type {
  ExerciseFilterDto,
  KeyValueFilterWire,
  SavedFilterDto,
  SessionPartWire,
  StudySessionWire,
  UnitFilterWire,
} from '@dolphy-app/engine-contract';
import type { ParseResult } from '../domain/manifest-schema.ts';

const MAX_DURATION_MINUTES = 2 ** 31;

const str = z.string();
const nonEmptyId = z.string().min(1);
const strList = z.array(str);
const duration = z.int().min(0).max(MAX_DURATION_MINUTES);

const filterType = z.enum(['Include', 'Exclude']);
const filterOp = z.enum(['All', 'Any']);

const basicFilterBody = z.object({
  key: str,
  value: str,
  filter_type: filterType,
});

const keyValueFilter: z.ZodType<KeyValueFilterWire> = z.lazy(() =>
  z.union([
    z.strictObject({ CourseFilter: basicFilterBody }),
    z.strictObject({ LessonFilter: basicFilterBody }),
    z.strictObject({
      CombinedFilter: z.object({
        op: filterOp,
        filters: z.array(keyValueFilter),
      }),
    }),
  ]),
);

const reviewListFilter = z.union([
  z.literal('ReviewListFilter'),
  z
    .strictObject({ ReviewListFilter: z.null() })
    .transform((): 'ReviewListFilter' => 'ReviewListFilter'),
]);

const unitFilter: z.ZodType<UnitFilterWire> = z.union([
  z.strictObject({ CourseFilter: z.object({ course_ids: strList }) }),
  z.strictObject({ LessonFilter: z.object({ lesson_ids: strList }) }),
  z.strictObject({ MetadataFilter: z.object({ filter: keyValueFilter }) }),
  reviewListFilter,
  z.strictObject({ Dependents: z.object({ unit_ids: strList }) }),
  z.strictObject({
    Dependencies: z.object({ unit_ids: strList, depth: z.int().min(0) }),
  }),
]);

const sessionPart: z.ZodType<SessionPartWire> = z.union([
  z.strictObject({ UnitFilter: z.object({ filter: unitFilter, duration }) }),
  z.strictObject({ SavedFilter: z.object({ filter_id: str, duration }) }),
  z.strictObject({ NoFilter: z.object({ duration }) }),
]);

const studySession: z.ZodType<Required<StudySessionWire>> = z.object({
  id: nonEmptyId,
  description: str.default(''),
  parts: z.array(sessionPart).default(() => []),
});

const savedFilter: z.ZodType<SavedFilterDto> = z.object({
  id: nonEmptyId,
  description: str,
  filter: unitFilter,
});

const exerciseFilter: z.ZodType<ExerciseFilterDto> = z.union([
  z.strictObject({ UnitFilter: unitFilter }),
  z.strictObject({
    StudySession: z.object({
      startTimeMs: z.int().nonnegative(),
      definition: studySession,
    }),
  }),
]);

const formatPath = (path: readonly PropertyKey[]): string => {
  if (path.length === 0) return '(root)';
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? String(part) : `.${String(part)}`;
  }
  return out;
};

const parser =
  <T>(schema: z.ZodType<T>) =>
  (raw: unknown): ParseResult<T> => {
    const result = schema.safeParse(raw);
    if (result.success) return { ok: true, value: result.data };
    return {
      ok: false,
      issues: result.error.issues.map(({ path, message }) => ({
        path: formatPath(path),
        message,
      })),
    };
  };

export const parseKeyValueFilter = parser(keyValueFilter);
export const parseUnitFilter = parser(unitFilter);
export const parseSessionPart = parser(sessionPart);
export const parseStudySession = parser(studySession);
export const parseSavedFilter = parser(savedFilter);
export const parseExerciseFilter = parser(exerciseFilter);

const encodeKeyValueFilter = (
  filter: KeyValueFilterWire,
): KeyValueFilterWire => {
  if ('CourseFilter' in filter) {
    const { key, value, filter_type: type } = filter.CourseFilter;
    return { CourseFilter: { key, value, filter_type: type } };
  }
  if ('LessonFilter' in filter) {
    const { key, value, filter_type: type } = filter.LessonFilter;
    return { LessonFilter: { key, value, filter_type: type } };
  }
  const { op, filters } = filter.CombinedFilter;
  return { CombinedFilter: { op, filters: filters.map(encodeKeyValueFilter) } };
};

/** Каноническая wire-форма Trane: unit-вариант — голая строка. */
export const encodeUnitFilter = (filter: UnitFilterWire): UnitFilterWire => {
  if (typeof filter === 'string') return filter;
  if ('CourseFilter' in filter) {
    return {
      CourseFilter: { course_ids: [...filter.CourseFilter.course_ids] },
    };
  }
  if ('LessonFilter' in filter) {
    return {
      LessonFilter: { lesson_ids: [...filter.LessonFilter.lesson_ids] },
    };
  }
  if ('MetadataFilter' in filter) {
    return {
      MetadataFilter: {
        filter: encodeKeyValueFilter(filter.MetadataFilter.filter),
      },
    };
  }
  if ('Dependents' in filter) {
    return { Dependents: { unit_ids: [...filter.Dependents.unit_ids] } };
  }
  const { unit_ids: unitIds, depth } = filter.Dependencies;
  return { Dependencies: { unit_ids: [...unitIds], depth } };
};

const encodeSessionPart = (part: SessionPartWire): SessionPartWire => {
  if ('UnitFilter' in part) {
    const { filter, duration } = part.UnitFilter;
    return { UnitFilter: { filter: encodeUnitFilter(filter), duration } };
  }
  if ('SavedFilter' in part) {
    const { filter_id: filterId, duration } = part.SavedFilter;
    return { SavedFilter: { filter_id: filterId, duration } };
  }
  return { NoFilter: { duration: part.NoFilter.duration } };
};

export const encodeSavedFilter = (filter: SavedFilterDto): SavedFilterDto => ({
  id: filter.id,
  description: filter.description,
  filter: encodeUnitFilter(filter.filter),
});

/** Всегда пишет `description` и `parts` (как serde при сериализации). */
export const encodeStudySession = (
  session: StudySessionWire,
): Required<StudySessionWire> => ({
  id: session.id,
  description: session.description ?? '',
  parts: (session.parts ?? []).map(encodeSessionPart),
});
