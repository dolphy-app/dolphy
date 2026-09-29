import { describe, expect, it } from 'vitest';
import { createUnitGraph, UnitGraphError } from '../../src/domain/graph.ts';
import type { UnitGraphBuilder } from '../../src/domain/graph.ts';

const sorted = (ids: Iterable<string> | undefined) =>
  ids === undefined ? undefined : [...ids].sort();

/** Живое представление множества графа: «шов» для порчи обратных карт. */
const liveSet = (set: ReadonlySet<string> | undefined): Set<string> => {
  if (set === undefined) throw new Error('expected a live set');
  return set as Set<string>;
};

const courses = (graph: UnitGraphBuilder, ...ids: string[]) => {
  for (const id of ids) graph.addCourse(id);
};

const catchError = (fn: () => void): UnitGraphError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof UnitGraphError) return error;
    throw error;
  }
  throw new Error('expected UnitGraphError');
};

/** Пять курсов Trane `dependency_graph`: 2,3 -> 1; 4 -> 2; 5 -> 3. */
const fiveCourses = () => {
  const graph = createUnitGraph();
  courses(graph, 'course1', 'course2', 'course3', 'course4', 'course5');
  graph.addDependencies('course1', 'Course', []);
  graph.addDependencies('course2', 'Course', ['course1']);
  graph.addDependencies('course3', 'Course', ['course1']);
  graph.addDependencies('course4', 'Course', ['course2']);
  graph.addDependencies('course5', 'Course', ['course3']);
  return graph;
};

describe('unit graph: structure (graph.rs port)', () => {
  it('get_unit_type', () => {
    const graph = createUnitGraph();
    graph.addCourse('id1');
    graph.addDependencies('id1', 'Course', []);
    expect(graph.getUnitType('id1')).toBe('Course');
    expect(graph.getUnitType('nope')).toBeUndefined();
  });

  it('get_course_lessons_and_exercises', () => {
    const graph = createUnitGraph();
    graph.addCourse('c');
    graph.addLesson('c::l1', 'c');
    graph.addExercise('c::l1::e1', 'c::l1');
    graph.addExercise('c::l1::e2', 'c::l1');
    graph.addLesson('c::l2', 'c');
    graph.addExercise('c::l2::e1', 'c::l2');
    expect(sorted(graph.getCourseLessons('c'))).toEqual(['c::l1', 'c::l2']);
    expect(sorted(graph.getLessonExercises('c::l1'))).toEqual([
      'c::l1::e1',
      'c::l1::e2',
    ]);
    expect(sorted(graph.getLessonExercises('c::l2'))).toEqual(['c::l2::e1']);
    expect(graph.getExerciseLesson('c::l1::e2')).toBe('c::l1');
    expect(graph.getExerciseLesson('c::l2::e1')).toBe('c::l2');
    expect(graph.getLessonCourse('c::l2')).toBe('c');
    expect(graph.getLessonExercises('c')).toBeUndefined();
  });

  it('a course without lessons and a lesson without exercises have no child sets', () => {
    const graph = createUnitGraph();
    graph.addCourse('c');
    graph.addLesson('c::l', 'c');
    graph.addCourse('empty');
    expect(graph.getCourseLessons('empty')).toBeUndefined();
    expect(graph.getLessonExercises('c::l')).toBeUndefined();
    expect(graph.getStartingLessons('empty')).toBeUndefined();
  });

  it('dependency_graph: five courses, sinks = {course1}, no cycles', () => {
    const graph = fiveCourses();
    expect(sorted(graph.getDependents('course1'))).toEqual([
      'course2',
      'course3',
    ]);
    expect(sorted(graph.getDependencies('course1'))).toEqual([]);
    expect(sorted(graph.getDependents('course2'))).toEqual(['course4']);
    expect(sorted(graph.getDependencies('course2'))).toEqual(['course1']);
    expect(sorted(graph.getDependents('course3'))).toEqual(['course5']);
    expect(sorted(graph.getDependencies('course3'))).toEqual(['course1']);
    expect(graph.getDependents('course4')).toBeUndefined();
    expect(sorted(graph.getDependencies('course4'))).toEqual(['course2']);
    expect(graph.getDependents('course5')).toBeUndefined();
    expect(sorted(graph.getDependencies('course5'))).toEqual(['course3']);
    expect(sorted(graph.getDependencySinks())).toEqual(['course1']);
    expect(() => graph.checkCycles()).not.toThrow();
    expect(graph.dependencyEdgeCount()).toBe(4);
  });

  it('courses_with_starting_dependencies_not_in_sinks', () => {
    const graph = createUnitGraph();
    courses(graph, 'course1', 'course2');
    graph.addLesson('course2::lesson1', 'course2');
    graph.addDependencies('course1', 'Course', []);
    graph.addDependencies('course2', 'Course', []);
    graph.addDependencies('course2::lesson1', 'Lesson', ['course1']);
    graph.updateStartingLessons();
    expect(sorted(graph.getDependencySinks())).toEqual(['course1']);
  });

  it('a starting lesson depending on a foreign, unknown unit keeps its course a sink', () => {
    const graph = createUnitGraph();
    graph.addCourse('c');
    graph.addLesson('c::l1', 'c');
    graph.addLesson('c::l2', 'c');
    graph.addDependencies('c', 'Course', []);
    graph.addDependencies('c::l1', 'Lesson', ['elsewhere']);
    graph.addDependencies('c::l2', 'Lesson', ['c::l1']);
    graph.updateStartingLessons();
    expect(sorted(graph.getStartingLessons('c'))).toEqual(['c::l1']);
    expect(graph.getDependencySinks().has('c')).toBe(true);
  });

  it('getStartingLessons of a non-course is undefined', () => {
    const graph = createUnitGraph();
    graph.addCourse('c');
    graph.addLesson('c::l', 'c');
    graph.addExercise('c::l::e', 'c::l');
    graph.updateStartingLessons();
    expect(graph.getStartingLessons('c::l')).toBeUndefined();
    expect(graph.getStartingLessons('c::l::e')).toBeUndefined();
    expect(graph.getStartingLessons('missing')).toBeUndefined();
  });
});

describe('unit graph: encompassing, superseding', () => {
  it('encompassing_graph: explicit weights beat the default 1.0', () => {
    const graph = createUnitGraph();
    courses(graph, 'course1', 'course2', 'course3');
    graph.addDependencies('course1', 'Course', []);
    graph.addEncompassed('course1', [], []);
    graph.addDependencies('course2', 'Course', ['course1']);
    graph.addEncompassed('course2', ['course1'], []);
    graph.addDependencies('course3', 'Course', ['course1']);
    graph.addEncompassed(
      'course3',
      ['course1'],
      [
        ['course1', 0.5],
        ['course2', 0.5],
      ],
    );
    expect(graph.encompassingEqualsDependency()).toBe(false);
    expect(graph.getEncompasses('course1')).toEqual([]);
    expect(graph.getEncompassedBy('course1')).toHaveLength(2);
    expect(graph.getEncompassedBy('course1')).toContainEqual(['course3', 0.5]);
    expect(graph.getEncompassedBy('course1')).toContainEqual(['course2', 1]);
    expect(graph.getEncompasses('course3')).toHaveLength(2);
    expect(graph.getEncompasses('course3')).toContainEqual(['course1', 0.5]);
    expect(graph.getEncompasses('course3')).toContainEqual(['course2', 0.5]);
    expect(graph.getEncompassedBy('course2')).toEqual([['course3', 0.5]]);
    expect(graph.getEncompasses('course2')).toEqual([['course1', 1]]);
    expect(graph.getEncompassedBy('course3')).toBeUndefined();
  });

  it('explicit encompassed plus missing dependencies at weight 1.0, in that order', () => {
    const graph = createUnitGraph();
    graph.addEncompassed('adv', ['intro', 'other::x'], [['intro', 0.5]]);
    expect(graph.getEncompasses('adv')).toEqual([
      ['intro', 0.5],
      ['other::x', 1],
    ]);
    expect(graph.getEncompassedBy('intro')).toEqual([['adv', 0.5]]);
  });

  it.each([-0.1, 1.1, NaN, Infinity])(
    'encompassed_with_invalid_weights: %s is rejected and nothing is recorded',
    (weight) => {
      const graph = createUnitGraph();
      graph.addCourse('unit');
      const error = catchError(() =>
        graph.addEncompassed('unit', [], [['encompassed', weight]]),
      );
      expect(error.kind).toBe('AddEncompassed');
      expect(error.message).toBe(
        'cannot add encompassed units for unit unit to the unit graph: encompassed units of unit unit must have weights within the range [0.0, 1.0]',
      );
      expect(graph.getEncompasses('unit')).toBeUndefined();
      expect(graph.encompassingEqualsDependency()).toBe(true);
    },
  );

  it.each([0, 1])('boundary weight %s is accepted', (weight) => {
    const graph = createUnitGraph();
    graph.addEncompassed('u', [], [['e', weight]]);
    expect(graph.getEncompasses('u')).toEqual([['e', weight]]);
  });

  it('encompassing_equals_dependencies: falls back to dependencies at 1.0', () => {
    const graph = createUnitGraph();
    courses(graph, 'course1', 'course2', 'course3');
    graph.addDependencies('course1', 'Course', []);
    graph.addDependencies('course2', 'Course', ['course1']);
    graph.addDependencies('course3', 'Course', ['course1']);
    expect(graph.encompassingEqualsDependency()).toBe(true);
    expect(graph.getEncompasses('course1')).toEqual([]);
    const by = graph.getEncompassedBy('course1');
    expect(by).toHaveLength(2);
    expect(by).toContainEqual(['course2', 1]);
    expect(by).toContainEqual(['course3', 1]);
    expect(graph.getEncompasses('course2')).toEqual([['course1', 1]]);
    expect(graph.getEncompassedBy('course2')).toBeUndefined();
    expect(graph.getEncompassedBy('course3')).toBeUndefined();
  });

  it('setEncompassingEqualsDependency drops explicit encompassed data', () => {
    const graph = createUnitGraph();
    graph.addEncompassed('a', ['b'], []);
    expect(graph.encompassingEqualsDependency()).toBe(false);
    graph.setEncompassingEqualsDependency();
    expect(graph.encompassingEqualsDependency()).toBe(true);
  });

  it('superseding_graph', () => {
    const graph = createUnitGraph();
    courses(graph, 'course1', 'course2', 'course3');
    graph.addDependencies('course1', 'Course', []);
    graph.addSuperseded('course1', ['course2']);
    graph.addDependencies('course2', 'Course', ['course1']);
    graph.addSuperseded('course2', ['course3']);
    graph.addDependencies('course3', 'Course', ['course2']);
    expect(sorted(graph.getSupersedes('course1'))).toEqual(['course2']);
    expect(graph.getSupersededBy('course1')).toBeUndefined();
    expect(sorted(graph.getSupersedes('course2'))).toEqual(['course3']);
    expect(sorted(graph.getSupersededBy('course2'))).toEqual(['course1']);
    expect(graph.getSupersedes('course3')).toBeUndefined();
    expect(sorted(graph.getSupersededBy('course3'))).toEqual(['course2']);
  });

  it('addSuperseded with an empty list records nothing', () => {
    const graph = createUnitGraph();
    graph.addSuperseded('a', []);
    expect(graph.getSupersedes('a')).toBeUndefined();
  });
});

describe('unit graph: DOT output', () => {
  const dotGraph = () => {
    const graph = createUnitGraph();
    graph.addLesson('1::1', '1');
    graph.addLesson('1::2', '1');
    graph.addLesson('2::1', '2');
    graph.addLesson('3::1', '3');
    graph.addLesson('3::2', '3');
    graph.addDependencies('1', 'Course', []);
    graph.addDependencies('1::2', 'Lesson', ['1::1']);
    graph.addDependencies('2', 'Course', ['1']);
    graph.addDependencies('3', 'Course', ['2']);
    graph.addDependencies('3::2', 'Lesson', ['3::1']);
    graph.updateStartingLessons();
    return graph;
  };

  it('generate_dot_graph with lessons', () => {
    expect(dotGraph().generateDotGraph(false)).toBe(
      [
        'digraph dependent_graph {',
        '    "1" [color=red, style=filled]',
        '    "1" -> "1::1"',
        '    "1" -> "2"',
        '    "1::1" [color=blue, style=filled]',
        '    "1::1" -> "1::2"',
        '    "1::2" [color=blue, style=filled]',
        '    "2" [color=red, style=filled]',
        '    "2" -> "2::1"',
        '    "2" -> "3"',
        '    "2::1" [color=blue, style=filled]',
        '    "3" [color=red, style=filled]',
        '    "3" -> "3::1"',
        '    "3::1" [color=blue, style=filled]',
        '    "3::1" -> "3::2"',
        '    "3::2" [color=blue, style=filled]',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('generate_dot_graph courses only', () => {
    expect(dotGraph().generateDotGraph(true)).toBe(
      [
        'digraph dependent_graph {',
        '    "1" [color=red, style=filled]',
        '    "1" -> "2"',
        '    "2" [color=red, style=filled]',
        '    "2" -> "3"',
        '    "3" [color=red, style=filled]',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('courses without lessons are not listed', () => {
    const graph = createUnitGraph();
    graph.addCourse('lonely');
    expect(graph.generateDotGraph(false)).toBe(
      'digraph dependent_graph {\n}\n',
    );
  });
});

describe('unit graph: construction errors (texts of spec B.3)', () => {
  it('duplicate_ids: each repeated add fails with the exact message and kind', () => {
    const graph = createUnitGraph();
    graph.addCourse('course_id');
    let error = catchError(() => graph.addCourse('course_id'));
    expect(error.kind).toBe('AddUnit');
    expect(error.unitId).toBe('course_id');
    expect(error.unitType).toBe('Course');
    expect(error.message).toBe(
      'cannot add unit course_id of type Course to the unit graph: course with ID course_id already exists',
    );
    graph.addLesson('lesson_id', 'course_id');
    error = catchError(() => graph.addLesson('lesson_id', 'course_id'));
    expect(error.message).toBe(
      'cannot add unit lesson_id of type Lesson to the unit graph: lesson with ID lesson_id already exists',
    );
    graph.addExercise('exercise_id', 'lesson_id');
    error = catchError(() => graph.addExercise('exercise_id', 'lesson_id'));
    expect(error.message).toBe(
      'cannot add unit exercise_id of type Exercise to the unit graph: exercise with ID exercise_id already exists',
    );
  });

  it('an id used by another type is reported as already existing for the new type', () => {
    const graph = createUnitGraph();
    graph.addCourse('x');
    expect(catchError(() => graph.addLesson('x', 'c')).message).toBe(
      'cannot add unit x of type Lesson to the unit graph: lesson with ID x already exists',
    );
  });

  it('update_unit_type_different_types: reusing a lesson id as a course parent fails', () => {
    const graph = createUnitGraph();
    graph.addCourse('c');
    graph.addLesson('c::l', 'c');
    const error = catchError(() => graph.addLesson('c::l2', 'c::l'));
    expect(error.kind).toBe('AddUnit');
    expect(error.message).toMatch(
      /^cannot add unit c::l2 of type Lesson to the unit graph: cannot update unit type of unit c::l from type Lesson/,
    );
    expect(error.message).toContain('to Course');
    const other = catchError(() => graph.addExercise('e', 'c'));
    expect(other.message).toContain('unit c from type Course');
    expect(other.message).toContain('to Lesson');
  });

  it('add_course after add_lesson fails: the course was registered implicitly', () => {
    const graph = createUnitGraph();
    graph.addLesson('k::l', 'k');
    expect(graph.getUnitType('k')).toBe('Course');
    expect(catchError(() => graph.addCourse('k')).message).toBe(
      'cannot add unit k of type Course to the unit graph: course with ID k already exists',
    );
  });

  it('add_dependencies checks: exercise, self-dependency, unknown unit (in that order)', () => {
    const graph = createUnitGraph();
    graph.addCourse('c');
    graph.addLesson('c::l', 'c');
    graph.addExercise('c::l::e', 'c::l');
    expect(
      catchError(() => graph.addDependencies('c::l::e', 'Exercise', ['x']))
        .message,
    ).toBe(
      'cannot add dependencies for unit c::l::e of type Exercise to the unit graph: exercise c::l::e cannot have dependencies',
    );
    expect(
      catchError(() => graph.addDependencies('c', 'Course', ['c'])).message,
    ).toBe(
      'cannot add dependencies for unit c of type Course to the unit graph: unit c cannot depend on itself',
    );
    expect(
      catchError(() => graph.addDependencies('ghost', 'Lesson', ['ghost']))
        .message,
    ).toContain('cannot depend on itself');
    const error = catchError(() =>
      graph.addDependencies('ghost', 'Lesson', ['c']),
    );
    expect(error.kind).toBe('AddDependencies');
    expect(error.message).toBe(
      'cannot add dependencies for unit ghost of type Lesson to the unit graph: unit ghost of type Lesson must be explicitly added before adding dependencies',
    );
  });

  it('a failed addDependencies leaves the graph untouched', () => {
    const graph = createUnitGraph();
    graph.addCourse('c');
    expect(() => graph.addDependencies('c', 'Course', ['c'])).toThrow();
    expect(graph.getDependencies('c')).toBeUndefined();
    expect(graph.getDependents('c')).toBeUndefined();
  });

  it('addDependencies is additive across calls', () => {
    const graph = createUnitGraph();
    courses(graph, 'a', 'b', 'c');
    graph.addDependencies('a', 'Course', ['b']);
    graph.addDependencies('a', 'Course', ['c', 'b']);
    expect(sorted(graph.getDependencies('a'))).toEqual(['b', 'c']);
    expect(graph.dependencyEdgeCount()).toBe(2);
  });

  it('a dangling dependency becomes a sink and has no type', () => {
    const graph = createUnitGraph();
    graph.addCourse('a');
    graph.addDependencies('a', 'Course', ['missing']);
    expect(sorted(graph.getDependencySinks())).toEqual(['missing']);
    expect(graph.getUnitType('missing')).toBeUndefined();
    expect(graph.getDependencies('missing')).toBeUndefined();
    expect(sorted(graph.getDependents('missing'))).toEqual(['a']);
  });
});

describe('unit graph: cycles and consistency', () => {
  it('dependencies_cycle: course1 -> course5 closes a loop', () => {
    const graph = fiveCourses();
    graph.addDependencies('course1', 'Course', ['course5']);
    const error = catchError(() => graph.checkCycles());
    expect(error.kind).toBe('CheckCycles');
    expect(error.message).toMatch(
      /^checking for cycles in the unit graph failed: cycle in dependency graph detected: /,
    );
    const path = error.message.split('detected: ')[1]?.split(' -> ') ?? [];
    expect(path[0]).toBe(path.at(-1));
    expect(new Set(path)).toEqual(new Set(['course1', 'course5', 'course3']));
  });

  it('encompassed_cycle without add_course', () => {
    const graph = createUnitGraph();
    graph.addEncompassed('course2', ['course1'], []);
    graph.addEncompassed('course3', ['course1'], []);
    graph.addEncompassed('course4', ['course2'], []);
    graph.addEncompassed('course5', ['course3'], []);
    graph.addEncompassed('course1', ['course5'], []);
    expect(catchError(() => graph.checkCycles()).message).toContain(
      'cycle in encompassed graph detected: ',
    );
  });

  it('superseded_cycle', () => {
    const graph = createUnitGraph();
    graph.addSuperseded('course2', ['course1']);
    graph.addSuperseded('course3', ['course1']);
    graph.addSuperseded('course4', ['course2']);
    graph.addSuperseded('course5', ['course3']);
    graph.addSuperseded('course1', ['course5']);
    expect(catchError(() => graph.checkCycles()).message).toContain(
      'cycle in superseded graph detected: ',
    );
  });

  it('a diamond is not a cycle', () => {
    const graph = createUnitGraph();
    courses(graph, 'a', 'b', 'c', 'd');
    graph.addDependencies('a', 'Course', ['b', 'c']);
    graph.addDependencies('b', 'Course', ['d']);
    graph.addDependencies('c', 'Course', ['d']);
    graph.addDependencies('d', 'Course', []);
    expect(() => graph.checkCycles()).not.toThrow();
  });

  it('missing_dependent_relationship: an emptied dependents set is detected', () => {
    const graph = createUnitGraph();
    graph.addCourse('course_id');
    graph.addLesson('lesson1_id', 'course_id');
    graph.addLesson('lesson2_id', 'course_id');
    graph.addDependencies('lesson2_id', 'Lesson', ['lesson1_id']);
    expect(() => graph.checkCycles()).not.toThrow();
    liveSet(graph.getDependents('lesson1_id')).clear();
    expect(catchError(() => graph.checkCycles()).message).toBe(
      'checking for cycles in the unit graph failed: unit lesson2_id lists unit lesson1_id as a dependency but the dependent relationship does not exist',
    );
  });

  it('missing_encompasing_relationship: a dropped mirror entry is detected', () => {
    const graph = createUnitGraph();
    graph.addEncompassed('lesson2_id', ['lesson1_id'], []);
    expect(() => graph.checkCycles()).not.toThrow();
    (graph.getEncompassedBy('lesson1_id') as unknown[]).length = 0;
    expect(catchError(() => graph.checkCycles()).message).toBe(
      'checking for cycles in the unit graph failed: unit lesson2_id lists unit lesson1_id as an encompassed unit but the encompassing relationship does not exist',
    );
  });

  it('missing_superseding_relationship: an emptied superseded_by set is detected', () => {
    const graph = createUnitGraph();
    graph.addSuperseded('lesson2_id', ['lesson1_id']);
    expect(() => graph.checkCycles()).not.toThrow();
    liveSet(graph.getSupersededBy('lesson1_id')).clear();
    expect(catchError(() => graph.checkCycles()).message).toBe(
      'checking for cycles in the unit graph failed: unit lesson2_id lists unit lesson1_id as a superseded unit but the superseding relationship does not exist',
    );
  });
});

describe('unit graph: traversals', () => {
  const tree = () => {
    const graph = createUnitGraph();
    graph.addCourse('c');
    graph.addLesson('c::l1', 'c');
    graph.addLesson('c::l2', 'c');
    graph.addExercise('c::l1::e1', 'c::l1');
    graph.addExercise('c::l1::e2', 'c::l1');
    graph.addExercise('c::l2::e1', 'c::l2');
    return graph;
  };

  it('getContainers walks up: exercise -> [lesson, course]', () => {
    const graph = tree();
    expect(graph.getContainers('c::l1::e1')).toEqual(['c::l1', 'c']);
    expect(graph.getContainers('c::l1')).toEqual(['c']);
    expect(graph.getContainers('c')).toEqual([]);
    expect(graph.getContainers('unknown')).toEqual([]);
    expect(graph.getParent('c::l1::e1')).toBe('c::l1');
    expect(graph.getParent('c')).toBeUndefined();
  });

  it('getExercisesUnder covers course, lesson, exercise and unknown ids', () => {
    const graph = tree();
    expect([...graph.getExercisesUnder('c')].sort()).toEqual([
      'c::l1::e1',
      'c::l1::e2',
      'c::l2::e1',
    ]);
    expect([...graph.getExercisesUnder('c::l2')]).toEqual(['c::l2::e1']);
    expect(graph.getExercisesUnder('c::l1::e2')).toEqual(['c::l1::e2']);
    expect(graph.getExercisesUnder('nope')).toEqual([]);
  });

  it('getDependencyAncestors / Descendants on a diamond', () => {
    const graph = createUnitGraph();
    courses(graph, 'top', 'left', 'right', 'bottom');
    graph.addDependencies('top', 'Course', []);
    graph.addDependencies('left', 'Course', ['top']);
    graph.addDependencies('right', 'Course', ['top']);
    graph.addDependencies('bottom', 'Course', ['left', 'right']);
    expect(sorted(graph.getDependencyAncestors('bottom'))).toEqual([
      'left',
      'right',
      'top',
    ]);
    expect(sorted(graph.getDependencyDescendants('top'))).toEqual([
      'bottom',
      'left',
      'right',
    ]);
    expect(sorted(graph.getDependencyAncestors('left'))).toEqual(['top']);
    expect(sorted(graph.getDependencyDescendants('bottom'))).toEqual([]);
    expect(sorted(graph.getDependencyAncestors('unknown'))).toEqual([]);
  });

  it('reachability terminates on a cycle and excludes the unit itself', () => {
    const graph = createUnitGraph();
    courses(graph, 'a', 'b', 'c');
    graph.addDependencies('a', 'Course', ['b']);
    graph.addDependencies('b', 'Course', ['c']);
    graph.addDependencies('c', 'Course', ['a']);
    expect(sorted(graph.getDependencyAncestors('a'))).toEqual(['b', 'c']);
    expect(sorted(graph.getDependencyDescendants('a'))).toEqual(['b', 'c']);
  });

  it('cached reachability is invalidated by added edges and units', () => {
    const graph = createUnitGraph();
    courses(graph, 'a', 'b', 'c');
    graph.addDependencies('a', 'Course', ['b']);
    expect(sorted(graph.getDependencyAncestors('a'))).toEqual(['b']);
    expect(sorted(graph.getDependencyDescendants('b'))).toEqual(['a']);
    graph.addDependencies('b', 'Course', ['c']);
    expect(sorted(graph.getDependencyAncestors('a'))).toEqual(['b', 'c']);
    expect(sorted(graph.getDependencyDescendants('c'))).toEqual(['a', 'b']);
  });

  it('size and unitIds follow insertion order', () => {
    const graph = tree();
    expect(graph.size).toBe(6);
    expect([...graph.unitIds()]).toEqual([
      'c',
      'c::l1',
      'c::l2',
      'c::l1::e1',
      'c::l1::e2',
      'c::l2::e1',
    ]);
  });
});
