/**
 * Семантические проверки библиотеки: каждая — маленькая чистая функция
 * `(index, options) → Finding[]`. Находка называет юнит и (необязательно)
 * поле манифеста; `locateFinding` превращает её в `path:line` по карте
 * источников сканера, файлы заново не читаются.
 * Источник: spike/compiler/src/checks.ts, каталог кодов — report-compiler.md §3.1.
 */
import type { Diagnostic, DiagnosticCode } from '@dolphy-app/engine-contract';
import type { ExerciseTypes } from '../ports/exercise-types.ts';
import { findCycle } from '../domain/graph-algorithms.ts';
import { buildClosure, hasAncestor, redundantEdges } from './closure.ts';
import type { Closure } from './closure.ts';
import { diag } from './diagnostics.ts';
import type {
  CourseUnit,
  ExerciseUnit,
  LessonUnit,
  Model,
  Src,
} from './model.ts';

export type IndexKind = 'course' | 'lesson' | 'exercise';
export type GraphUnit = CourseUnit | LessonUnit;

export interface Finding {
  code: DiagnosticCode;
  message: string;
  unitId: string;
  /** Поле манифеста (`dependencies`, `engine.keyPrerequisites`, …): место в файле. */
  field?: string;
  related?: string[];
  /** Явное место: нужно, когда id неоднозначен (дубликаты). */
  at?: Src;
}

export interface CheckOptions {
  /** Больше пререквизитов — `W_FAN_IN`. */
  maxFanIn: number;
  /** Каталог видов заданий; `null` — проверки вида пропускаются. */
  exerciseTypes: Pick<ExerciseTypes, 'describe' | 'validateSpec'> | null;
  /** Циклов на граф, после чего поиск прекращается. */
  maxCycles: number;
}

export const DEFAULT_CHECK_OPTIONS: CheckOptions = {
  maxFanIn: 7,
  exerciseTypes: null,
  maxCycles: 20,
};

/**
 * Пороги `W_GRANULARITY` по умолчанию [НЕ ПОДТВЕРЖДЕНО, engine-ts.md §12.18];
 * курс переопределяет их через `engine.granularity`.
 */
export const DEFAULT_GRANULARITY = { min: 3, max: 12 } as const;

export interface Index {
  model: Model;
  kind: ReadonlyMap<string, IndexKind>;
  courses: ReadonlyMap<string, CourseUnit>;
  lessons: ReadonlyMap<string, LessonUnit>;
  exercises: ReadonlyMap<string, ExerciseUnit>;
  /** Курсы, затем уроки; при повторе id побеждает первое вхождение. */
  graphUnits: readonly GraphUnit[];
  lessonsOfCourse: ReadonlyMap<string, readonly string[]>;
  exercisesOfLesson: ReadonlyMap<string, readonly string[]>;
  skipped: readonly string[];
}

const pushTo = <V>(map: Map<string, V[]>, key: string, value: V) => {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
};

export const buildIndex = (model: Model): Index => {
  const kind = new Map<string, IndexKind>();
  const courses = new Map<string, CourseUnit>();
  const lessons = new Map<string, LessonUnit>();
  const exercises = new Map<string, ExerciseUnit>();
  const lessonsOfCourse = new Map<string, string[]>();
  const exercisesOfLesson = new Map<string, string[]>();
  const graphUnits: GraphUnit[] = [];
  for (const course of model.courses) {
    const { id } = course.manifest;
    if (kind.has(id)) continue;
    kind.set(id, 'course');
    courses.set(id, course);
    graphUnits.push(course);
  }
  for (const lesson of model.lessons) {
    const { id } = lesson.manifest;
    if (kind.has(id)) continue;
    kind.set(id, 'lesson');
    lessons.set(id, lesson);
    graphUnits.push(lesson);
    pushTo(lessonsOfCourse, lesson.parentCourseId, id);
  }
  for (const exercise of model.exercises) {
    const { id } = exercise.manifest;
    if (kind.has(id)) continue;
    kind.set(id, 'exercise');
    exercises.set(id, exercise);
    pushTo(exercisesOfLesson, exercise.parentLessonId, id);
  }
  return {
    model,
    kind,
    courses,
    lessons,
    exercises,
    graphUnits,
    lessonsOfCourse,
    exercisesOfLesson,
    skipped: model.skippedCourses,
  };
};

/** Цель — пропущенный курс (неподдерживаемый генератор) или его сгенерированный урок. */
const isSkippedTarget = (index: Index, id: string) =>
  index.skipped.some((course) => id === course || id.startsWith(`${course}::`));

// ------------------------------------------------------------------ ids
export const checkIds = (model: Model): Finding[] => {
  const findings: Finding[] = [];
  const firstFile = new Map<string, string>();
  const units: Array<CourseUnit | LessonUnit | ExerciseUnit> = [
    ...model.courses,
    ...model.lessons,
    ...model.exercises,
  ];
  for (const unit of units) {
    const { id } = unit.manifest;
    const at = unit.fields.id ?? unit.src;
    if (id === '') {
      findings.push({
        code: 'E_ID_EMPTY',
        message: 'unit id is empty',
        unitId: id,
        at,
      });
      continue;
    }
    const first = firstFile.get(id);
    if (first === undefined) firstFile.set(id, unit.src.path);
    else {
      findings.push({
        code: 'E_ID_DUPLICATE',
        message: `id '${id}' is already defined in ${first}`,
        unitId: id,
        at,
        related: [first],
      });
    }
  }
  const mismatch = (
    unit: LessonUnit | ExerciseUnit,
    field: 'course_id' | 'lesson_id',
    actual: string,
    expected: string,
  ) => {
    const noun = field === 'lesson_id' ? 'lesson' : 'course';
    if (actual === expected) return;
    findings.push({
      code: 'E_ID_MISMATCH',
      message: `${field} '${actual}' does not match the enclosing ${noun} '${expected}'`,
      unitId: unit.manifest.id,
      at: unit.fields[field] ?? unit.src,
    });
  };
  for (const lesson of model.lessons) {
    const { manifest } = lesson;
    mismatch(lesson, 'course_id', manifest.course_id, lesson.parentCourseId);
  }
  for (const exercise of model.exercises) {
    const { manifest } = exercise;
    mismatch(
      exercise,
      'lesson_id',
      manifest.lesson_id,
      exercise.parentLessonId,
    );
    mismatch(
      exercise,
      'course_id',
      manifest.course_id,
      exercise.parentCourseId,
    );
  }
  return findings;
};

// ------------------------------------------------------------------ references
export const checkReferences = (index: Index): Finding[] => {
  const findings: Finding[] = [];
  const add = (
    code: DiagnosticCode,
    unitId: string,
    field: string,
    target: string,
    message: string,
  ) => findings.push({ code, message, unitId, field, related: [target] });
  for (const { manifest } of index.graphUnits) {
    const { id } = manifest;
    const isLesson = index.kind.get(id) === 'lesson';
    for (const dependency of manifest.dependencies) {
      const kind = index.kind.get(dependency);
      const field = 'dependencies';
      if (dependency === id) {
        add('E_DEP_SELF', id, field, dependency, 'unit depends on itself');
      } else if (kind === undefined) {
        if (!isSkippedTarget(index, dependency)) {
          const message = `dependency '${dependency}' does not exist`;
          add('E_DEP_MISSING', id, field, dependency, message);
        }
      } else if (kind === 'exercise') {
        const message = `dependency '${dependency}' is an exercise; only courses and lessons can be prerequisites`;
        add('E_DEP_KIND', id, field, dependency, message);
      } else if (!isLesson && kind === 'lesson') {
        const message = `course depends on lesson '${dependency}'; courses may only depend on courses`;
        add('E_DEP_KIND', id, field, dependency, message);
      }
    }
    for (const target of manifest.superseded) {
      if (index.kind.has(target) || isSkippedTarget(index, target)) continue;
      const message = `superseded unit '${target}' does not exist`;
      add('E_SUP_MISSING', id, 'superseded', target, message);
    }
    for (const [target, weight] of manifest.encompassed) {
      if (!(weight >= 0 && weight <= 1)) {
        const message = `encompassed weight ${weight} for '${target}' is outside [0, 1]`;
        add('E_ENC_WEIGHT', id, 'encompassed', target, message);
      }
      if (!index.kind.has(target) && !isSkippedTarget(index, target)) {
        const message = `encompassed unit '${target}' does not exist`;
        add('E_ENC_MISSING', id, 'encompassed', target, message);
      }
    }
  }
  return findings;
};

// ------------------------------------------------------------------ cycles
/**
 * До `max` различных циклов: после каждого замыкающее ребро отбрасывается,
 * поиск продолжается. `skip` отсеивает уже известные циклы (они не считаются).
 */
export const collectCycles = (
  nodes: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
  max: number,
  skip?: (cycle: string[]) => boolean,
): string[][] => {
  const work = new Map<string, string[]>();
  for (const [id, targets] of edges) work.set(id, [...targets]);
  const cycles: string[][] = [];
  // отсеянные циклы тоже расходуют итерации: запас защищает от долгого поиска
  for (let attempt = 0; attempt < max + 200; attempt++) {
    const cycle = findCycle(nodes, (id) => work.get(id) ?? []);
    if (cycle === null) break;
    const from = cycle[cycle.length - 2] as string;
    const to = cycle[cycle.length - 1] as string;
    work.set(
      from,
      (work.get(from) ?? []).filter((target) => target !== to),
    );
    if (skip?.(cycle)) continue;
    cycles.push(cycle);
    if (cycles.length >= max) break;
  }
  return cycles;
};

const isGraphNode = (index: Index, id: string) => {
  const kind = index.kind.get(id);
  return kind === 'course' || kind === 'lesson';
};

export const checkCycles = (
  index: Index,
  { maxCycles }: Pick<CheckOptions, 'maxCycles'>,
): Finding[] => {
  const ids = index.graphUnits.map(({ manifest }) => manifest.id);
  const dependencies = new Map<string, string[]>();
  const superseded = new Map<string, string[]>();
  const encompassed = new Map<string, string[]>();
  const dependencyEdges = new Set<string>();
  const edgeKey = (from: string, to: string) => `${from}\0${to}`;
  for (const { manifest } of index.graphUnits) {
    const { id } = manifest;
    // самозависимость — `E_DEP_SELF`, а не цикл из одного узла
    const targets = manifest.dependencies.filter(
      (target) => target !== id && isGraphNode(index, target),
    );
    dependencies.set(id, targets);
    for (const target of targets) dependencyEdges.add(edgeKey(id, target));
    superseded.set(
      id,
      manifest.superseded.filter(
        (target) => target !== id && index.kind.has(target),
      ),
    );
    const explicit = manifest.encompassed
      .map(([target]) => target)
      .filter(
        (target) =>
          target !== id &&
          isGraphNode(index, target) &&
          !dependencyEdges.has(edgeKey(id, target)),
      );
    encompassed.set(id, [...targets, ...explicit]);
  }
  const findings: Finding[] = [];
  const report = (
    code: DiagnosticCode,
    label: string,
    field: string,
    cycles: string[][],
  ) => {
    for (const cycle of cycles) {
      findings.push({
        code,
        message: `${label} cycle: ${cycle.join(' -> ')}`,
        unitId: cycle[0] as string,
        field,
        related: cycle,
      });
    }
  };
  report(
    'E_CYCLE_DEPENDENCY',
    'dependency',
    'dependencies',
    collectCycles(ids, dependencies, maxCycles),
  );
  report(
    'E_CYCLE_SUPERSEDED',
    'superseded',
    'superseded',
    collectCycles(ids, superseded, maxCycles),
  );
  // граф охвата = зависимости + явный `encompassed`; чисто зависимостные циклы уже названы
  const onlyDependencies = (cycle: string[]) =>
    cycle
      .slice(0, -1)
      .every((from, i) =>
        dependencyEdges.has(edgeKey(from, cycle[i + 1] as string)),
      );
  report(
    'E_CYCLE_ENCOMPASSED',
    'encompassed',
    'encompassed',
    collectCycles(ids, encompassed, maxCycles, onlyDependencies),
  );
  return findings;
};

// ------------------------------------------------------------------ graph shape
export const checkRedundantEdges = (
  closure: Closure,
): { findings: Finding[]; removed: Array<readonly [string, string]> } => {
  const removed = redundantEdges(closure);
  const findings = removed.map(([unitId, dependency, via]): Finding => ({
    code: 'W_REDUNDANT_EDGE',
    message: `dependency '${dependency}' is redundant: already implied by '${via}'`,
    unitId,
    field: 'dependencies',
    related: [dependency, via],
  }));
  return {
    findings,
    removed: removed.map(([unitId, dependency]) => [unitId, dependency]),
  };
};

export const checkEncompassed = (index: Index, closure: Closure): Finding[] => {
  const findings: Finding[] = [];
  for (const { manifest, engine } of index.graphUnits) {
    const { id } = manifest;
    const nonAncestor = engine?.nonAncestor;
    for (const [target, weight] of manifest.encompassed) {
      // отсутствие и вес — `checkReferences`
      if (!index.kind.has(target) || !(weight >= 0 && weight <= 1)) continue;
      if (manifest.dependencies.includes(target)) continue;
      if (hasAncestor(closure, id, target)) continue;
      if (nonAncestor === true) continue;
      if (Array.isArray(nonAncestor) && nonAncestor.includes(target)) continue;
      findings.push({
        code: 'E_ENC_NOT_ANCESTOR',
        message: `encompassed unit '${target}' is neither a dependency nor an ancestor (set engine.nonAncestor to allow)`,
        unitId: id,
        field: 'encompassed',
        related: [target],
      });
    }
  }
  return findings;
};

export const checkFanIn = (
  index: Index,
  { maxFanIn }: Pick<CheckOptions, 'maxFanIn'>,
): Finding[] => {
  const findings: Finding[] = [];
  for (const { manifest } of index.graphUnits) {
    const count = new Set(manifest.dependencies).size;
    if (count <= maxFanIn) continue;
    findings.push({
      code: 'W_FAN_IN',
      message: `${count} prerequisites (more than ${maxFanIn}); consider intermediate topics`,
      unitId: manifest.id,
      field: 'dependencies',
    });
  }
  return findings;
};

/** Урок без пререквизитов и без зависимых в курсе из нескольких уроков. */
export const checkOrphans = (index: Index): Finding[] => {
  const findings: Finding[] = [];
  const hasDependent = new Set<string>();
  for (const { manifest } of index.graphUnits) {
    for (const dependency of manifest.dependencies) {
      hasDependent.add(dependency);
    }
  }
  for (const [courseId, lessonIds] of index.lessonsOfCourse) {
    if (lessonIds.length < 2) continue;
    for (const lessonId of lessonIds) {
      const lesson = index.lessons.get(lessonId) as LessonUnit;
      if (lesson.manifest.dependencies.length > 0) continue;
      if (hasDependent.has(lessonId)) continue;
      findings.push({
        code: 'W_ORPHAN_LESSON',
        message: `lesson is not connected to any other lesson of course '${courseId}'`,
        unitId: lessonId,
      });
    }
  }
  return findings;
};

/**
 * `W_GRANULARITY`: число упражнений урока вне `[min, max]`.
 * ПРАВИЛО ВКЛЮЧЕНИЯ [ВЫВОД]: проверяются только курсы с блоком `engine`
 * (у курсов Trane без расширения предупреждения нет — иначе библиотеки
 * с одним упражнением на урок потеряли бы «0 предупреждений»).
 */
export const checkGranularity = (index: Index): Finding[] => {
  const findings: Finding[] = [];
  for (const [courseId, lessonIds] of index.lessonsOfCourse) {
    const engine = index.courses.get(courseId)?.engine;
    if (engine === undefined) continue;
    const min = engine.granularity?.min ?? DEFAULT_GRANULARITY.min;
    const max = engine.granularity?.max ?? DEFAULT_GRANULARITY.max;
    for (const lessonId of lessonIds) {
      const count = index.exercisesOfLesson.get(lessonId)?.length ?? 0;
      if (count >= min && count <= max) continue;
      findings.push({
        code: 'W_GRANULARITY',
        message: `lesson has ${count} exercise(s); expected ${min}..${max} (course engine.granularity)`,
        unitId: lessonId,
      });
    }
  }
  return findings;
};

// ------------------------------------------------------------------ engine extension
export const checkKeyPrerequisites = (
  index: Index,
  closure: Closure,
): Finding[] => {
  const findings: Finding[] = [];
  const check = (unitId: string, lessonId: string, keys: readonly string[]) => {
    for (const key of keys) {
      const kind = index.kind.get(key);
      const field = 'engine.keyPrerequisites';
      if (kind === undefined) {
        findings.push({
          code: 'E_KEYPREREQ_MISSING',
          message: `keyPrerequisite '${key}' does not exist`,
          unitId,
          field,
          related: [key],
        });
        continue;
      }
      const target =
        kind === 'exercise'
          ? (index.exercises.get(key) as ExerciseUnit).parentLessonId
          : key;
      if (target === lessonId || !hasAncestor(closure, lessonId, target)) {
        findings.push({
          code: 'E_KEYPREREQ_NOT_ANCESTOR',
          message: `keyPrerequisite '${key}' is not an ancestor of '${unitId}'`,
          unitId,
          field,
          related: [key],
        });
      }
    }
  };
  for (const lesson of index.lessons.values()) {
    const keys = lesson.engine?.keyPrerequisites;
    if (keys !== undefined) check(lesson.manifest.id, lesson.manifest.id, keys);
  }
  for (const exercise of index.exercises.values()) {
    const keys = exercise.engine?.keyPrerequisites;
    if (keys !== undefined) {
      check(exercise.manifest.id, exercise.parentLessonId, keys);
    }
  }
  return findings;
};

export const checkVerification = (
  index: Index,
  { exerciseTypes }: Pick<CheckOptions, 'exerciseTypes'>,
): Finding[] => {
  const findings: Finding[] = [];
  const missingByLesson = new Map<string, string[]>();
  for (const exercise of index.exercises.values()) {
    // сломанный front/engine уже назван сканером: каскад подавлен
    if (exercise.engineBroken === true) continue;
    const { id } = exercise.manifest;
    const block = exercise.engine?.exercise;
    if (block !== undefined) {
      if (exerciseTypes !== null) {
        if (exerciseTypes.describe(block.type) === undefined) {
          findings.push({
            code: 'W_UNKNOWN_EXERCISE_TYPE',
            message: `exercise type '${block.type}' is not provided by any installed extension`,
            unitId: id,
            field: 'engine.exercise',
          });
        } else {
          const issues = exerciseTypes.validateSpec(
            block.type,
            block.spec ?? {},
          );
          if (issues.length > 0) {
            findings.push({
              code: 'E_EXERCISE_SPEC',
              message: issues.join('; '),
              unitId: id,
              field: 'engine.exercise',
            });
          }
        }
      }
      continue;
    }
    const { parentCourseId, parentLessonId } = exercise;
    if (index.courses.get(parentCourseId)?.engine?.requiresChecks === true) {
      findings.push({
        code: 'E_NO_VERIFICATION',
        message: `exercise has no engine.exercise but course '${parentCourseId}' sets requiresChecks`,
        unitId: id,
        field: 'engine',
      });
    } else pushTo(missingByLesson, parentLessonId, id);
  }
  // информация агрегируется по уроку, чтобы вывод оставался читаемым
  for (const [lessonId, exerciseIds] of missingByLesson) {
    findings.push({
      code: 'I_NO_VERIFICATION',
      message: `${exerciseIds.length} exercise(s) without engine.exercise`,
      unitId: lessonId,
      related: exerciseIds.slice(0, 20),
    });
  }
  return findings;
};

// ------------------------------------------------------------------ pipeline
export interface CheckResult {
  findings: Finding[];
  /** Транзитивно избыточные рёбра `[юнит, зависимость]` (для флагов `keep` артефакта). */
  redundant: Array<readonly [string, string]>;
}

/** Полный набор семантических проверок над индексом. */
export const runChecks = (index: Index, options: CheckOptions): CheckResult => {
  const closure = buildClosure(index);
  const cycles = checkCycles(index, options);
  const redundant = checkRedundantEdges(closure);
  const findings: Finding[] = [
    ...checkIds(index.model),
    ...checkReferences(index),
    ...cycles,
    ...checkFanIn(index, options),
    ...checkOrphans(index),
    ...checkGranularity(index),
    ...checkVerification(index, options),
    ...redundant.findings,
    ...checkEncompassed(index, closure),
    ...checkKeyPrerequisites(index, closure),
  ];
  const { containmentCycle } = closure;
  if (
    containmentCycle !== null &&
    !cycles.some(({ code }) => code === 'E_CYCLE_DEPENDENCY')
  ) {
    findings.push({
      code: 'E_CYCLE_DEPENDENCY',
      message: `dependency cycle through course containment: ${containmentCycle.join(' -> ')}`,
      unitId: containmentCycle[0] as string,
      field: 'dependencies',
      related: containmentCycle,
    });
  }
  return { findings, redundant: redundant.removed };
};

// ------------------------------------------------------------------ locate
const findUnit = (index: Index, id: string) =>
  index.courses.get(id) ?? index.lessons.get(id) ?? index.exercises.get(id);

/** Место поля юнита; `engine` — блок в front-файле, манифесте или `lesson.engine.json`. */
const sourceOf = (
  unit: CourseUnit | LessonUnit | ExerciseUnit,
  key?: string,
) => {
  if (key === undefined) return unit.src;
  if (key === 'engine') {
    return unit.engineSrc ?? unit.fields.engine ?? unit.src;
  }
  return unit.fields[key] ?? unit.src;
};

/** Находка → диагностика с `path:line` по карте источников юнита. */
export const locateFinding = (index: Index, finding: Finding): Diagnostic => {
  const { code, message, unitId, related } = finding;
  const location = (at: Src | undefined) => ({
    unitId,
    ...(at !== undefined ? { path: at.path } : {}),
    ...(at?.line !== undefined ? { line: at.line } : {}),
    ...(related !== undefined ? { related } : {}),
  });
  if (finding.at !== undefined)
    return diag(code, message, location(finding.at));
  const unit = findUnit(index, unitId);
  if (unit === undefined) return diag(code, message, location(undefined));
  const key = finding.field?.startsWith('engine') ? 'engine' : finding.field;
  return diag(code, message, location(sourceOf(unit, key)));
};
