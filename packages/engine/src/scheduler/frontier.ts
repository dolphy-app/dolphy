import type {
  FrontierItemDto,
  SchedulerOptionsDto,
  UnitId,
} from '@dolphy-app/engine-contract';
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
 * **Нет данных = закрыто**: зависимость с упражнениями, но без попыток, имеет
 * оценку 0 и среднее число попыток 0 и порог не проходит — как у Trane
 * (дифференциальный тест T-49: множество совпадает с Rust на 46 из 47
 * состояний). Юнит без валидных упражнений (пустой, из blacklist, вытесненный)
 * оценки не имеет и, как в Trane (`satisfied_effective_dependency`), считается
 * выполненным — иначе цепочка за пустым уроком закрылась бы навсегда;
 * зависимость на несуществующий юнит — тоже. Осознанное расхождение с DFS
 * Trane: зависимые курса, вытесненного до завершения его уроков, DFS не
 * достигает (счётчик «непройденных уроков» курса не обнуляется), а фронтир их
 * открывает — вытесненный юнит считается выполненным. Из фронтира исключаются
 * уроки без валидных упражнений, из blacklist и вытесненные. Порядок: курс,
 * затем урок (по коду символов). Фронтир не учитывает лимит
 * `maxLessonsInProgress` и выбор `getBatch`.
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

  /** Зависимости юнита: у урока плюс зависимости курса, если урок стартовый. */
  const effectiveDependencies = (unitId: UnitId) => {
    const dependencies = new Set(graph.getDependencies(unitId));
    if (graph.getUnitType(unitId) !== 'Lesson') return dependencies;
    const courseId = graph.getLessonCourse(unitId) ?? '';
    const starting = graph.getStartingLessons(courseId) ?? EMPTY_SET;
    if (starting.has(unitId)) {
      for (const id of graph.getDependencies(courseId) ?? EMPTY_SET) {
        dependencies.add(id);
      }
    }
    return dependencies;
  };

  const openCache = new Map<UnitId, boolean>();
  const areDependenciesOpen = (unitId: UnitId) => {
    for (const id of effectiveDependencies(unitId)) {
      // eslint-disable-next-line no-use-before-define
      if (!isDependencyOpen(id)) return false;
    }
    return true;
  };

  /**
   * Зависимость выполнена, если прошла порог. Юнит без оценки (нет валидных
   * упражнений, blacklist) «прозрачен»: он выполнен, когда выполнены его
   * собственные зависимости — Trane не достигает зависимых за таким юнитом,
   * пока не пройдены его предки. Вытесненный юнит выполнен безусловно.
   */
  const isDependencyOpen = (dependencyId: UnitId): boolean => {
    const cached = openCache.get(dependencyId);
    if (cached !== undefined) return cached;
    openCache.set(dependencyId, true); // защита от циклов
    // eslint-disable-next-line no-use-before-define
    const open = computeDependencyOpen(dependencyId);
    openCache.set(dependencyId, open);
    return open;
  };

  const computeDependencyOpen = (dependencyId: UnitId) => {
    if (!unitExists(dependencyId)) return true;
    const courseId = graph.getLessonCourse(dependencyId) ?? '';
    const isBlacklisted =
      blacklist.isBlacklisted(dependencyId) ||
      blacklist.isBlacklisted(courseId);
    if (isBlacklisted) return areDependenciesOpen(dependencyId);
    if (isSuperseded(dependencyId)) return true;
    const score = scoreOf(dependencyId);
    const averageTrials = scorer.getAvgTrials(dependencyId);
    if (score === null || averageTrials === null) {
      return areDependenciesOpen(dependencyId);
    }
    return passesThreshold(passingScore, score, averageTrials);
  };

  const isStarted = (lessonId: UnitId) => {
    for (const exerciseId of graph.getLessonExercises(lessonId) ?? EMPTY_SET) {
      if (scorer.getExerciseNumTrials(exerciseId) > 0) return true;
    }
    return false;
  };

  const isOnFrontier = (lessonId: UnitId, courseId: UnitId) => {
    if (blacklist.isBlacklisted(lessonId)) return false;
    if (blacklist.isBlacklisted(courseId)) return false;
    if (isSuperseded(lessonId) || isSuperseded(courseId)) return false;
    if (isStarted(lessonId)) return false;
    return areDependenciesOpen(lessonId);
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
