import { findCycle } from './graph-algorithms.ts';

export type UnitType = 'Course' | 'Lesson' | 'Exercise';
export type WeightedUnit = readonly [id: string, weight: number];

export type UnitGraphErrorKind =
  'AddUnit' | 'AddDependencies' | 'AddEncompassed' | 'CheckCycles';

/** Ошибка графа; тексты — `Display` `UnitGraphError` Trane (spec B.3). */
export class UnitGraphError extends Error {
  readonly kind: UnitGraphErrorKind;
  readonly unitId?: string;
  readonly unitType?: UnitType;

  constructor(
    kind: UnitGraphErrorKind,
    message: string,
    options: { unitId?: string; unitType?: UnitType; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'UnitGraphError';
    this.kind = kind;
    if (options.unitId !== undefined) this.unitId = options.unitId;
    if (options.unitType !== undefined) this.unitType = options.unitType;
  }
}

/**
 * Неизменяемое после сборки представление графа юнитов (Trane `UnitGraph`)
 * плюс обходы, нужные планировщику и проекциям. Возвращаемые множества —
 * живые представления: не мутировать.
 */
export interface UnitGraph {
  getUnitType(id: string): UnitType | undefined;
  getCourseLessons(courseId: string): ReadonlySet<string> | undefined;
  getStartingLessons(courseId: string): ReadonlySet<string> | undefined;
  getLessonCourse(lessonId: string): string | undefined;
  getLessonExercises(lessonId: string): ReadonlySet<string> | undefined;
  getExerciseLesson(exerciseId: string): string | undefined;
  getDependencies(id: string): ReadonlySet<string> | undefined;
  getDependents(id: string): ReadonlySet<string> | undefined;
  getDependencySinks(): ReadonlySet<string>;
  /** Явные охваты плюс недостающие зависимости с весом 1.0 (или зависимости). */
  getEncompasses(id: string): readonly WeightedUnit[] | undefined;
  getEncompassedBy(id: string): readonly WeightedUnit[] | undefined;
  getSupersedes(id: string): ReadonlySet<string> | undefined;
  getSupersededBy(id: string): ReadonlySet<string> | undefined;
  /** Ни один манифест не задаёт `encompassed`: охват = зависимости @ 1.0. */
  encompassingEqualsDependency(): boolean;
  /** Все известные юниты в порядке вставки. */
  unitIds(): IterableIterator<string>;
  readonly size: number;
  /** Число рёбер зависимостей (у курсов и уроков). */
  dependencyEdgeCount(): number;
  /** Родитель по вложенности: упражнение → урок, урок → курс. */
  getParent(id: string): string | undefined;
  /** Цепочка вложенности вверх без самого юнита: `[урок, курс]`. */
  getContainers(id: string): readonly string[];
  /** Упражнения под юнитом: курс, урок или само упражнение; неизвестный — `[]`. */
  getExercisesUnder(id: string): readonly string[];
  /** Транзитивные зависимости (предки по зависимостям), без самого юнита. */
  getDependencyAncestors(id: string): ReadonlySet<string>;
  /** Транзитивные зависимые (потомки по зависимостям), без самого юнита. */
  getDependencyDescendants(id: string): ReadonlySet<string>;
  /** DOT-описание графа зависимых (тест `generate_dot_graph`). */
  generateDotGraph(coursesOnly: boolean): string;
}

export interface UnitGraphBuilder extends UnitGraph {
  addCourse(courseId: string): void;
  addLesson(lessonId: string, courseId: string): void;
  addExercise(exerciseId: string, lessonId: string): void;
  addDependencies(
    unitId: string,
    unitType: UnitType,
    dependencies: readonly string[],
  ): void;
  addEncompassed(
    unitId: string,
    dependencies: readonly string[],
    encompassed: readonly WeightedUnit[],
  ): void;
  addSuperseded(unitId: string, superseded: readonly string[]): void;
  updateStartingLessons(): void;
  setEncompassingEqualsDependency(): void;
  /** Циклы и согласованность прямых и обратных карт; бросает `UnitGraphError`. */
  checkCycles(): void;
}

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_LIST: readonly string[] = [];
const compare = (a: string, b: string) => Number(a > b) - Number(a < b);

const getOrCreate = <K, V>(map: Map<K, V>, key: K, create: () => V): V => {
  let value = map.get(key);
  if (value === undefined) {
    value = create();
    map.set(key, value);
  }
  return value;
};

/** Граф Trane `InMemoryUnitGraph` (graph.rs); порядок вставки детерминирован. */
export const createUnitGraph = (): UnitGraphBuilder => {
  const typeMap = new Map<string, UnitType>();
  const courseLessons = new Map<string, Set<string>>();
  const startingLessonsMap = new Map<string, Set<string>>();
  const lessonCourse = new Map<string, string>();
  const lessonExercises = new Map<string, Set<string>>();
  const exerciseLesson = new Map<string, string>();
  const dependencyGraph = new Map<string, Set<string>>();
  const dependentGraph = new Map<string, Set<string>>();
  const dependencySinks = new Set<string>();
  const encompassesGraph = new Map<string, WeightedUnit[]>();
  const encompassedByGraph = new Map<string, WeightedUnit[]>();
  const supersedesGraph = new Map<string, Set<string>>();
  const supersededByGraph = new Map<string, Set<string>>();
  let ancestorsCache = new Map<string, ReadonlySet<string>>();
  let descendantsCache = new Map<string, ReadonlySet<string>>();

  const invalidate = () => {
    if (ancestorsCache.size > 0) ancestorsCache = new Map();
    if (descendantsCache.size > 0) descendantsCache = new Map();
  };

  const updateDependencySinks = (
    unitId: string,
    dependencies: readonly string[],
  ) => {
    const current = dependencyGraph.get(unitId);
    const hasNone = current === undefined || current.size === 0;
    if (hasNone && dependencies.length === 0) dependencySinks.add(unitId);
    else dependencySinks.delete(unitId);
    if (lessonCourse.has(unitId)) dependencySinks.delete(unitId);
    for (const dependency of dependencies) {
      updateDependencySinks(dependency, EMPTY_LIST);
    }
  };

  const updateUnitType = (id: string, unitType: UnitType) => {
    const existing = typeMap.get(id);
    if (existing === undefined) typeMap.set(id, unitType);
    else if (existing !== unitType) {
      throw new Error(
        `cannot update unit type of unit ${id} from type ${existing} to ${unitType}.`,
      );
    }
  };

  const addUnit = (
    unitId: string,
    unitType: UnitType,
    body: () => void,
  ): void => {
    try {
      if (typeMap.has(unitId)) {
        const noun = unitType.toLowerCase();
        throw new Error(`${noun} with ID ${unitId} already exists`);
      }
      body();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new UnitGraphError(
        'AddUnit',
        `cannot add unit ${unitId} of type ${unitType} to the unit graph: ${reason}`,
        { unitId, unitType, cause: error },
      );
    }
  };

  const addCourse = (courseId: string) => {
    addUnit(courseId, 'Course', () => updateUnitType(courseId, 'Course'));
    invalidate();
  };

  const addLesson = (lessonId: string, courseId: string) => {
    addUnit(lessonId, 'Lesson', () => {
      updateUnitType(lessonId, 'Lesson');
      updateUnitType(courseId, 'Course');
      lessonCourse.set(lessonId, courseId);
      getOrCreate(courseLessons, courseId, () => new Set()).add(lessonId);
    });
    invalidate();
  };

  const addExercise = (exerciseId: string, lessonId: string) => {
    addUnit(exerciseId, 'Exercise', () => {
      updateUnitType(exerciseId, 'Exercise');
      updateUnitType(lessonId, 'Lesson');
      getOrCreate(lessonExercises, lessonId, () => new Set()).add(exerciseId);
      exerciseLesson.set(exerciseId, lessonId);
    });
    invalidate();
  };

  const addDependencies = (
    unitId: string,
    unitType: UnitType,
    dependencies: readonly string[],
  ) => {
    const fail = (reason: string): never => {
      throw new UnitGraphError(
        'AddDependencies',
        `cannot add dependencies for unit ${unitId} of type ${unitType} to the unit graph: ${reason}`,
        { unitId, unitType },
      );
    };
    if (unitType === 'Exercise') {
      fail(`exercise ${unitId} cannot have dependencies`);
    }
    if (dependencies.includes(unitId)) {
      fail(`unit ${unitId} cannot depend on itself`);
    }
    if (!typeMap.has(unitId)) {
      fail(
        `unit ${unitId} of type ${unitType} must be explicitly added before adding dependencies`,
      );
    }
    updateDependencySinks(unitId, dependencies);
    const set = getOrCreate(dependencyGraph, unitId, () => new Set());
    for (const dependency of dependencies) set.add(dependency);
    for (const dependency of dependencies) {
      getOrCreate(dependentGraph, dependency, () => new Set()).add(unitId);
    }
    invalidate();
  };

  const addEncompassed = (
    unitId: string,
    dependencies: readonly string[],
    encompassed: readonly WeightedUnit[],
  ) => {
    for (const [, weight] of encompassed) {
      if (!(weight >= 0 && weight <= 1)) {
        throw new UnitGraphError(
          'AddEncompassed',
          `cannot add encompassed units for unit ${unitId} to the unit graph: encompassed units of unit ${unitId} must have weights within the range [0.0, 1.0]`,
          { unitId },
        );
      }
    }
    const full: WeightedUnit[] = encompassed.map(
      ([id, weight]): WeightedUnit => [id, weight],
    );
    for (const dependency of dependencies) {
      if (!encompassed.some(([id]) => id === dependency)) {
        full.push([dependency, 1]);
      }
    }
    const list = getOrCreate(encompassesGraph, unitId, () => []);
    for (const entry of full) list.push(entry);
    for (const [id, weight] of full) {
      getOrCreate(encompassedByGraph, id, () => []).push([unitId, weight]);
    }
  };

  const addSuperseded = (unitId: string, superseded: readonly string[]) => {
    if (superseded.length === 0) return;
    const set = getOrCreate(supersedesGraph, unitId, () => new Set());
    for (const id of superseded) set.add(id);
    for (const id of superseded) {
      getOrCreate(supersededByGraph, id, () => new Set()).add(unitId);
    }
  };

  const updateStartingLessons = () => {
    for (const [courseId, lessons] of courseLessons) {
      const starting = new Set<string>();
      for (const lessonId of lessons) {
        const dependencies = dependencyGraph.get(lessonId);
        let isDisjoint = true;
        if (dependencies !== undefined) {
          for (const dependency of dependencies) {
            if (lessons.has(dependency)) {
              isDisjoint = false;
              break;
            }
          }
        }
        if (isDisjoint) starting.add(lessonId);
      }
      if (dependencySinks.has(courseId)) {
        let hasStartingDependencies = false;
        for (const lessonId of starting) {
          const dependencies = dependencyGraph.get(lessonId);
          if (dependencies === undefined || dependencies.size === 0) continue;
          let isKnown = true;
          for (const dependency of dependencies) {
            if (!typeMap.has(dependency)) {
              isKnown = false;
              break;
            }
          }
          if (isKnown) {
            hasStartingDependencies = true;
            break;
          }
        }
        if (hasStartingDependencies) dependencySinks.delete(courseId);
      }
      startingLessonsMap.set(courseId, starting);
    }
  };

  const setEncompassingEqualsDependency = () => {
    encompassesGraph.clear();
    encompassedByGraph.clear();
  };

  const encompassingEqualsDependency = () =>
    encompassesGraph.size === 0 && encompassedByGraph.size === 0;

  const unitWeights = (ids: ReadonlySet<string> | undefined) =>
    ids === undefined ? undefined : [...ids].map((id): WeightedUnit => [id, 1]);

  const getEncompasses = (id: string) =>
    encompassesGraph.size === 0
      ? unitWeights(dependencyGraph.get(id))
      : encompassesGraph.get(id);

  const getEncompassedBy = (id: string) =>
    encompassedByGraph.size === 0
      ? unitWeights(dependentGraph.get(id))
      : encompassedByGraph.get(id);

  const checkCycles = () => {
    const fail = (message: string): never => {
      throw new UnitGraphError(
        'CheckCycles',
        `checking for cycles in the unit graph failed: ${message}`,
      );
    };
    const dependencyCycle = findCycle(
      dependencyGraph.keys(),
      (id) => dependencyGraph.get(id) ?? EMPTY_SET,
    );
    if (dependencyCycle) {
      fail(
        `cycle in dependency graph detected: ${dependencyCycle.join(' -> ')}`,
      );
    }
    const supersededCycle = findCycle(
      supersedesGraph.keys(),
      (id) => supersedesGraph.get(id) ?? EMPTY_SET,
    );
    if (supersededCycle) {
      fail(
        `cycle in superseded graph detected: ${supersededCycle.join(' -> ')}`,
      );
    }
    if (encompassesGraph.size > 0) {
      const encompassedCycle = findCycle(encompassesGraph.keys(), (id) =>
        (encompassesGraph.get(id) ?? []).map(([target]) => target),
      );
      if (encompassedCycle) {
        fail(
          `cycle in encompassed graph detected: ${encompassedCycle.join(' -> ')}`,
        );
      }
    }
    for (const [unit, dependencies] of dependencyGraph) {
      for (const dependency of dependencies) {
        if (!dependentGraph.get(dependency)?.has(unit)) {
          fail(
            `unit ${unit} lists unit ${dependency} as a dependency but the dependent relationship does not exist`,
          );
        }
      }
    }
    for (const [unit, superseded] of supersedesGraph) {
      for (const id of superseded) {
        if (!supersededByGraph.get(id)?.has(unit)) {
          fail(
            `unit ${unit} lists unit ${id} as a superseded unit but the superseding relationship does not exist`,
          );
        }
      }
    }
    for (const [unit, targets] of encompassesGraph) {
      for (const [id] of targets) {
        const isMirrored = encompassedByGraph
          .get(id)
          ?.some(([source]) => source === unit);
        if (!isMirrored) {
          fail(
            `unit ${unit} lists unit ${id} as an encompassed unit but the encompassing relationship does not exist`,
          );
        }
      }
    }
  };

  const getParent = (id: string) =>
    typeMap.get(id) === 'Exercise'
      ? exerciseLesson.get(id)
      : lessonCourse.get(id);

  const getContainers = (id: string): readonly string[] => {
    const chain: string[] = [];
    let current = getParent(id);
    while (current !== undefined && !chain.includes(current)) {
      chain.push(current);
      current = getParent(current);
    }
    return chain;
  };

  const getExercisesUnder = (id: string): readonly string[] => {
    const type = typeMap.get(id);
    if (type === 'Exercise') return [id];
    if (type === 'Lesson') return [...(lessonExercises.get(id) ?? EMPTY_SET)];
    if (type !== 'Course') return EMPTY_LIST;
    const found: string[] = [];
    for (const lessonId of courseLessons.get(id) ?? EMPTY_SET) {
      for (const exerciseId of lessonExercises.get(lessonId) ?? EMPTY_SET) {
        found.push(exerciseId);
      }
    }
    return found;
  };

  const reach = (
    id: string,
    edges: ReadonlyMap<string, ReadonlySet<string>>,
    cache: Map<string, ReadonlySet<string>>,
  ): ReadonlySet<string> => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const seen = new Set<string>();
    const stack = [...(edges.get(id) ?? EMPTY_SET)];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (seen.has(next) || next === id) continue;
      seen.add(next);
      for (const target of edges.get(next) ?? EMPTY_SET) stack.push(target);
    }
    cache.set(id, seen);
    return seen;
  };

  const generateDotGraph = (coursesOnly: boolean) => {
    let out = 'digraph dependent_graph {\n';
    for (const course of [...courseLessons.keys()].sort(compare)) {
      out += `    "${course}" [color=red, style=filled]\n`;
      let targets = [...(dependentGraph.get(course) ?? EMPTY_SET)];
      if (coursesOnly) {
        targets = targets.filter((id) => typeMap.get(id) === 'Course');
      } else targets.push(...(startingLessonsMap.get(course) ?? EMPTY_SET));
      for (const target of targets.sort(compare)) {
        out += `    "${course}" -> "${target}"\n`;
      }
      if (coursesOnly) continue;
      const lessons = [...(courseLessons.get(course) ?? EMPTY_SET)];
      for (const lesson of lessons.sort(compare)) {
        out += `    "${lesson}" [color=blue, style=filled]\n`;
        const dependents = [...(dependentGraph.get(lesson) ?? EMPTY_SET)];
        for (const target of dependents.sort(compare)) {
          out += `    "${lesson}" -> "${target}"\n`;
        }
      }
    }
    return `${out}}\n`;
  };

  return {
    addCourse,
    addLesson,
    addExercise,
    addDependencies,
    addEncompassed,
    addSuperseded,
    updateStartingLessons,
    setEncompassingEqualsDependency,
    checkCycles,
    getUnitType: (id) => typeMap.get(id),
    getCourseLessons: (id) => courseLessons.get(id),
    getStartingLessons: (id) => startingLessonsMap.get(id),
    getLessonCourse: (id) => lessonCourse.get(id),
    getLessonExercises: (id) => lessonExercises.get(id),
    getExerciseLesson: (id) => exerciseLesson.get(id),
    getDependencies: (id) => dependencyGraph.get(id),
    getDependents: (id) => dependentGraph.get(id),
    getDependencySinks: () => dependencySinks,
    getEncompasses,
    getEncompassedBy,
    getSupersedes: (id) => supersedesGraph.get(id),
    getSupersededBy: (id) => supersededByGraph.get(id),
    encompassingEqualsDependency,
    unitIds: () => typeMap.keys(),
    get size() {
      return typeMap.size;
    },
    dependencyEdgeCount: () => {
      let count = 0;
      for (const set of dependencyGraph.values()) count += set.size;
      return count;
    },
    getParent,
    getContainers,
    getExercisesUnder,
    getDependencyAncestors: (id) => reach(id, dependencyGraph, ancestorsCache),
    getDependencyDescendants: (id) =>
      reach(id, dependentGraph, descendantsCache),
    generateDotGraph,
  };
};
