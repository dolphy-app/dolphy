import type {
  FrontierItemDto,
  SchedulerOptionsDto,
  UnitId,
} from '@lms/engine-contract';
import { ScoringError } from '../scoring/errors.ts';
import type { BlacklistView } from '../scoring/graph.ts';
import type { UnitScorer } from '../scoring/unit-scorer.ts';
import type { SchedulerLibrary } from './data.ts';
import { passesThreshold } from './depth-first-scheduler.ts';

export interface FrontierDeps {
  /** Текущая библиотека; читается при каждом запросе. */
  library(): SchedulerLibrary;
  readonly scorer: UnitScorer;
  readonly blacklist: BlacklistView;
  options(): Pick<SchedulerOptionsDto, 'passingScore'>;
}

export interface FrontierQuery {
  /** Только уроки этого курса. */
  readonly courseId?: UnitId;
}

const EMPTY_SET: ReadonlySet<UnitId> = new Set();

const compareStrings = (a: string, b: string) => Number(a > b) - Number(a < b);

/**
 * Фронтир: уроки, которые ещё не начаты (ни у одного упражнения нет попыток)
 * и все эффективные зависимости которых проходят порог Trane — среднее
 * `value` ≥ `minScore` и среднее число попыток ≥ `minAvgTrials` по данным
 * `UnitScorer` (engine-ts-api.md §4). Эффективные зависимости урока — его
 * зависимости плюс зависимости курса, если урок стартовый.
 *
 * **Нет данных = закрыто**: зависимость, у которой нет оценки или среднего
 * числа попыток, блокирует урок (в `getBatch` Trane такая зависимость
 * считается выполненной). Исключения, где Trane и порт совпадают по смыслу
 * «пользователь снял препятствие»: зависимость в blacklist (или урок из
 * blacklisted курса) и вытесненная (`superseded`) считаются выполненными;
 * зависимость на несуществующий юнит (нет в графе или манифеста) — тоже,
 * потому что изучить её нельзя. Из фронтира исключаются уроки без валидных
 * упражнений, из blacklist и вытесненные. Порядок: курс, затем урок (по коду
 * символов). Фронтир не учитывает лимит `maxLessonsInProgress` и выбор
 * `getBatch`.
 */
export const getFrontier = (
  deps: FrontierDeps,
  query: FrontierQuery = {},
): FrontierItemDto[] => {
  const { scorer, blacklist } = deps;
  const library = deps.library();
  const { graph } = library;
  const { passingScore } = deps.options();

  const isSuperseded = (unitId: UnitId) =>
    scorer.isSuperseded(
      unitId,
      scorer.getSupersedingRecursive(unitId) ?? EMPTY_SET,
    );

  const scoreOf = (unitId: UnitId) => {
    try {
      return scorer.getUnitScore(unitId);
    } catch (error) {
      if (error instanceof ScoringError) return null;
      throw error;
    }
  };

  const unitExists = (unitId: UnitId) => {
    const type = graph.getUnitType(unitId);
    if (type === 'Course') return library.getCourse(unitId) !== undefined;
    if (type === 'Lesson') return library.getLesson(unitId) !== undefined;
    return type === 'Exercise' && library.getExercise(unitId) !== undefined;
  };

  const isDependencyOpen = (dependencyId: UnitId) => {
    if (!unitExists(dependencyId)) return true;
    if (blacklist.isBlacklisted(dependencyId)) return true;
    const courseId = graph.getLessonCourse(dependencyId) ?? '';
    if (blacklist.isBlacklisted(courseId)) return true;
    if (isSuperseded(dependencyId)) return true;
    const score = scoreOf(dependencyId);
    const averageTrials = scorer.getAvgTrials(dependencyId);
    if (score === null || averageTrials === null) return false;
    return passesThreshold(passingScore, score, averageTrials);
  };

  const isStarted = (lessonId: UnitId) => {
    for (const exerciseId of graph.getLessonExercises(lessonId) ?? EMPTY_SET) {
      if (scorer.getExerciseNumTrials(exerciseId) > 0) return true;
    }
    return false;
  };

  const effectiveDependencies = (lessonId: UnitId, courseId: UnitId) => {
    const dependencies = new Set(graph.getDependencies(lessonId));
    const starting = graph.getStartingLessons(courseId) ?? EMPTY_SET;
    if (starting.has(lessonId)) {
      for (const id of graph.getDependencies(courseId) ?? EMPTY_SET) {
        dependencies.add(id);
      }
    }
    return dependencies;
  };

  const isOnFrontier = (lessonId: UnitId, courseId: UnitId) => {
    if (blacklist.isBlacklisted(lessonId)) return false;
    if (blacklist.isBlacklisted(courseId)) return false;
    if (isSuperseded(lessonId) || isSuperseded(courseId)) return false;
    if (isStarted(lessonId)) return false;
    for (const id of effectiveDependencies(lessonId, courseId)) {
      if (!isDependencyOpen(id)) return false;
    }
    return true;
  };

  const items: FrontierItemDto[] = [];
  for (const lessonId of graph.unitIds()) {
    if (graph.getUnitType(lessonId) !== 'Lesson') continue;
    if (library.getLesson(lessonId) === undefined) continue;
    const courseId = graph.getLessonCourse(lessonId);
    if (courseId === undefined) continue;
    if (query.courseId !== undefined && query.courseId !== courseId) continue;
    const exerciseIds = [...(graph.getLessonExercises(lessonId) ?? EMPTY_SET)];
    const exerciseCount = exerciseIds.filter(
      (id) => !blacklist.isBlacklisted(id),
    ).length;
    if (exerciseCount === 0) continue;
    if (isOnFrontier(lessonId, courseId)) {
      items.push({ lessonId, courseId, exerciseCount });
    }
  }
  return items.sort(
    (a, b) =>
      compareStrings(a.courseId, b.courseId) ||
      compareStrings(a.lessonId, b.lessonId),
  );
};
