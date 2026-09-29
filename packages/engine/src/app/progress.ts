import type {
  ProgressNodeDto,
  ProgressQuery,
  UnitId,
  UnitKind,
  UnitScoreDto,
  UnitStatus,
} from '@lms/engine-contract';
import type { UnitType } from '../domain/graph.ts';
import type { Library } from '../domain/library.ts';
import { windowNameOf } from '../scheduler/options.ts';
import { ScoringError } from '../scoring/errors.ts';
import type { EngineContext } from './context.ts';
import { EngineError } from './errors.ts';

const KIND_OF: Record<UnitType, UnitKind> = {
  Course: 'course',
  Lesson: 'lesson',
  Exercise: 'exercise',
};

const compareStrings = (a: string, b: string) => Number(a > b) - Number(a < b);

const notFound = (unitId: UnitId) =>
  new EngineError('NOT_FOUND', { details: { unitId } });

/** Оценки и статусы юнитов поверх `UnitScorer` и проекций (engine-ts-api.md §4). */
export interface ProgressReader {
  unitScore(unitId: UnitId): UnitScoreDto;
  /** Упражнение, его урок и курс: оценки, изменившиеся после попытки. */
  scoresOfExercise(exerciseId: UnitId): UnitScoreDto[];
  progress(query: ProgressQuery): ProgressNodeDto[];
}

export const createProgressReader = (ctx: EngineContext): ProgressReader => {
  const { scorer, projections, options } = ctx;

  const kindOf = (library: Library, unitId: UnitId): UnitKind => {
    const type = library.graph.getUnitType(unitId);
    if (type === undefined) throw notFound(unitId);
    return KIND_OF[type];
  };

  /** Ошибка скорера на входе (`Err` Trane) — оценки нет, как у агрегатов. */
  const scoreOf = (unitId: UnitId): number | null => {
    try {
      return scorer.getUnitScore(unitId);
    } catch (error) {
      if (error instanceof ScoringError) return null;
      throw error;
    }
  };

  const toScoreDto = (library: Library, unitId: UnitId): UnitScoreDto => {
    const kind = kindOf(library, unitId);
    const score = scoreOf(unitId);
    return {
      unitId,
      kind,
      score,
      avgTrials: kind === 'exercise' ? null : scorer.getAvgTrials(unitId),
      window: score === null ? null : windowNameOf(options.get(), score),
    };
  };

  const unitScore = (unitId: UnitId) =>
    toScoreDto(ctx.library.require(), unitId);

  const scoresOfExercise = (exerciseId: UnitId) => {
    const library = ctx.library.require();
    const { graph } = library;
    const lessonId = graph.getExerciseLesson(exerciseId);
    const courseId =
      lessonId === undefined ? undefined : graph.getLessonCourse(lessonId);
    return [exerciseId, lessonId, courseId]
      .filter((id): id is UnitId => id !== undefined)
      .map((id) => toScoreDto(library, id));
  };

  const progress = (query: ProgressQuery): ProgressNodeDto[] => {
    const library = ctx.library.require();
    const { graph } = library;
    const { attempts, flags } = projections;
    const { masteryWindows } = options.get();
    const includeExercises = query.includeExercises ?? false;

    const unitIds = ((): UnitId[] => {
      const { scope } = query;
      if (scope === undefined) return library.getCourseIds();
      if ('unitIds' in scope) return [...new Set(scope.unitIds)];
      return ['courseId' in scope ? scope.courseId : scope.lessonId];
    })();
    for (const unitId of unitIds) kindOf(library, unitId);

    const frontier = new Set(ctx.getFrontier().map(({ lessonId }) => lessonId));
    const dueByExercise = new Set(
      ctx.getDue().map(({ exerciseId }) => exerciseId),
    );

    const exercisesUnder = (unitId: UnitId) => graph.getExercisesUnder(unitId);

    const attemptStats = (unitId: UnitId) => {
      let count = 0;
      let last: number | undefined;
      for (const exerciseId of exercisesUnder(unitId)) {
        count += attempts.count(exerciseId);
        const [newest] = attempts.getTrials(exerciseId, 1);
        if (
          newest !== undefined &&
          (last === undefined || newest.timestamp > last)
        ) {
          last = newest.timestamp;
        }
      }
      return { count, last };
    };

    const isInsideBlacklist = (unitId: UnitId) =>
      [unitId, ...graph.getContainers(unitId)].some((id) =>
        flags.isBlacklisted(id),
      );

    const isUnitSuperseded = (unitId: UnitId) =>
      scorer.isSuperseded(
        unitId,
        scorer.getSupersedingRecursive(unitId) ?? new Set(),
      );

    const statusOf = (
      unitId: UnitId,
      kind: UnitKind,
      score: number | null,
      attemptCount: number,
    ): UnitStatus => {
      if (isInsideBlacklist(unitId)) return 'blacklisted';
      const lessonId =
        kind === 'exercise' ? graph.getExerciseLesson(unitId) : unitId;
      if (isUnitSuperseded(unitId)) return 'superseded';
      if (
        kind === 'exercise' &&
        lessonId !== undefined &&
        isUnitSuperseded(lessonId)
      ) {
        return 'superseded';
      }
      if (
        score !== null &&
        attemptCount > 0 &&
        score >= masteryWindows.easy.range[0]
      ) {
        return 'mastered';
      }
      if (attemptCount > 0) return 'in-progress';
      if (kind === 'lesson') return frontier.has(unitId) ? 'ready' : 'locked';
      if (kind === 'exercise') {
        // урок открыт, если он на фронтире или в нём уже есть попытки
        const isOpen =
          lessonId !== undefined &&
          (frontier.has(lessonId) || attemptStats(lessonId).count > 0);
        return isOpen ? 'ready' : 'locked';
      }
      const lessons = graph.getCourseLessons(unitId) ?? new Set<UnitId>();
      return [...lessons].some((id) => frontier.has(id)) ? 'ready' : 'locked';
    };

    const nodeOf = (unitId: UnitId): ProgressNodeDto => {
      const kind = kindOf(library, unitId);
      const { count, last } = attemptStats(unitId);
      const score = scoreOf(unitId);
      const node: ProgressNodeDto = {
        id: unitId,
        kind,
        status: statusOf(unitId, kind, score, count),
        score,
        avgTrials: kind === 'exercise' ? null : scorer.getAvgTrials(unitId),
        attempts: count,
      };
      if (last !== undefined) node.lastAttemptAt = last;
      if (kind !== 'exercise') {
        node.dueExercises = exercisesUnder(unitId).filter((id) =>
          dueByExercise.has(id),
        ).length;
      }
      return node;
    };

    const expand = (unitId: UnitId): UnitId[] => {
      const type = graph.getUnitType(unitId);
      if (type === 'Exercise') return [unitId];
      if (type === 'Lesson') {
        const exercises = [...(graph.getLessonExercises(unitId) ?? [])];
        return includeExercises
          ? [unitId, ...exercises.sort(compareStrings)]
          : [unitId];
      }
      const lessons = [...(graph.getCourseLessons(unitId) ?? [])].sort(
        compareStrings,
      );
      const below = includeExercises ? lessons.flatMap(expand) : lessons;
      return [unitId, ...below];
    };

    const isExplicit = query.scope !== undefined && 'unitIds' in query.scope;
    return (isExplicit ? unitIds : unitIds.flatMap(expand)).map(nodeOf);
  };

  return { unitScore, scoresOfExercise, progress };
};
