/**
 * Библиотеки golden L2 `get_unit_score`: одно определение для теста
 * (`unit-score-l2.test.ts`) и для регенерации fixture
 * (`regenerate-unit-score-l2.ts`). Каждая библиотека материализуется на диск
 * в раскладке Trane; Rust-Trane открывает копию этого каталога, TS — другую
 * копию того же дерева (`treeSha256` в заголовке fixture сверяет обе).
 */
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  buildCourse,
  buildExercise,
  buildLesson,
  generateLibrary,
  renderLibrary,
} from '@dolphy-app/testkit';
import type { CourseLibrary } from '@dolphy-app/testkit';
import { DUMP_CASES } from '../helpers/rust-dumps.ts';
import { generateLoaderLibrary } from '../helpers/loader-gen.ts';

export interface L2Library {
  name: string;
  description: string;
  /** Материализует библиотеку в новый каталог внутри `tmp`; возвращает корень. */
  prepare(tmp: string): Promise<string>;
}

const writeLibrary = (library: CourseLibrary, root: string) => {
  for (const [path, text] of renderLibrary(library)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
};

/** Готовая библиотека из репозитория: копия, чтобы Trane не писал `.trane` в fixture. */
const fromDumpCase =
  (name: string): L2Library['prepare'] =>
  async (tmp) => {
    const dumpCase = DUMP_CASES.find((candidate) => candidate.name === name);
    if (dumpCase === undefined) throw new Error(`unknown library ${name}`);
    const { root } = await dumpCase.prepare(tmp);
    const copy = join(tmp, `l2-${name}`);
    cpSync(root, copy, { recursive: true });
    return copy;
  };

interface UnitFields {
  dependencies?: string[];
  encompassed?: Array<[string, number]>;
  superseded?: string[];
}

/** Рукописная библиотека: курсы, уроки с `n` упражнениями (оба типа по чётности). */
const createBuilder = () => {
  const library: CourseLibrary = { courses: [], lessons: [], exercises: [] };
  const course = (id: string, fields: UnitFields = {}) =>
    library.courses.push(buildCourse({ id, ...fields }));
  const lesson = (id: string, exercises: number, fields: UnitFields = {}) => {
    library.lessons.push(buildLesson({ id, ...fields }));
    for (let e = 0; e < exercises; e++) {
      library.exercises.push(
        buildExercise({
          id: `${id}::e${e}`,
          exercise_type:
            (e + id.length) % 2 === 0 ? 'Declarative' : 'Procedural',
        }),
      );
    }
  };
  return { library, course, lesson };
};

/**
 * Вложенные зависимости, явные веса охвата, вытеснение уроков и курса. Веса
 * (0.25, 0.5, 0.75) точны в f32: на границах распространения наград (`< 0.2`)
 * f32 и f64 не расходятся.
 */
export const buildNestedLibrary = (): CourseLibrary => {
  const { library, course, lesson } = createBuilder();
  course('a');
  lesson('a::l0', 4);
  lesson('a::l1', 3, { dependencies: ['a::l0'] });
  lesson('a::l2', 3, {
    dependencies: ['a::l1'],
    superseded: ['a::l0'],
    encompassed: [
      ['a::l1', 0.5],
      ['a::l0', 0.25],
    ],
  });
  lesson('a::l3', 2, { dependencies: ['a::l2'], superseded: ['a::l0'] });

  course('b', { dependencies: ['a'], encompassed: [['a', 0.5]] });
  lesson('b::l0', 3, { encompassed: [['a::l2', 0.75]] });
  lesson('b::l1', 3, { dependencies: ['b::l0'], superseded: ['b::l0'] });
  lesson('b::l2', 2, { dependencies: ['b::l1'] });

  course('c');
  lesson('c::l0', 2);
  lesson('c::l1', 2, { dependencies: ['c::l0'] });

  course('d', { dependencies: ['c'], superseded: ['c'] });
  lesson('d::l0', 2, { encompassed: [['c::l1', 0.5]] });
  lesson('d::l1', 2, { dependencies: ['d::l0'] });
  return library;
};

/** Число уроков, охватывающих узел `f::hub`, с попарно разными весами. */
export const FAN_IN_SOURCES = 12;

/**
 * Узел `f::hub` и 12 охватывающих его уроков с весами 0.30 … 0.85: одна и та
 * же оценка 5 даёт узлу 12 различных наград за один день — окно дедупа
 * (10 новейших) обрезает повтор старее десятой.
 */
export const buildFanInLibrary = (): CourseLibrary => {
  const { library, course, lesson } = createBuilder();
  course('f');
  lesson('f::hub', 2);
  for (let k = 0; k < FAN_IN_SOURCES; k++) {
    lesson(`f::s${String(k).padStart(2, '0')}`, 2, {
      dependencies: ['f::hub'],
      encompassed: [['f::hub', (30 + 5 * k) / 100]],
    });
  }
  return library;
};

export const L2_LIBRARIES: readonly L2Library[] = [
  {
    name: 'trane-embedded',
    description: 'Библиотека Trane: 1 курс, 1 урок, 1 упражнение',
    prepare: fromDumpCase('trane-embedded'),
  },
  {
    name: 'sql-course-json',
    description: 'sql-course, JSON-манифесты: 7 уроков, 21 упражнение, охват',
    prepare: fromDumpCase('sql-course-json'),
  },
  {
    name: 'sql-course-kb',
    description: 'sql-course, KnowledgeBase-курс',
    prepare: fromDumpCase('sql-course-kb'),
  },
  {
    name: 'trane-small',
    description: 'Библиотека Trane: 3 KB-курса, 126 уроков, охват и вытеснение',
    prepare: fromDumpCase('trane-small'),
  },
  {
    name: 'testkit-generated',
    description:
      '@dolphy-app/testkit generateLibrary: 3 курса цепочкой, 8 уроков, 3 упражнения, оба типа',
    prepare: async (tmp) => {
      const root = join(tmp, 'l2-testkit-generated');
      writeLibrary(
        generateLibrary({
          courses: 3,
          lessonsPerCourse: 8,
          exercisesPerLesson: 3,
          maxDependencies: 3,
          chainCourses: true,
          seed: 20260930,
        }),
        root,
      );
      return root;
    },
  },
  {
    name: 'testkit-nested',
    description:
      '@dolphy-app/testkit buildCourse/buildLesson: вложенные зависимости, веса охвата, вытеснение уроков и курса',
    prepare: async (tmp) => {
      const root = join(tmp, 'l2-testkit-nested');
      writeLibrary(buildNestedLibrary(), root);
      return root;
    },
  },
  {
    name: 'testkit-fanin',
    description:
      '@dolphy-app/testkit: узел, охваченный 12 уроками с разными весами (дедуп наград)',
    prepare: async (tmp) => {
      const root = join(tmp, 'l2-testkit-fanin');
      writeLibrary(buildFanInLibrary(), root);
      return root;
    },
  },
  {
    name: 'loader-rich',
    description:
      'генератор загрузчика: 3 курса, 30 уроков, окно, явные encompassed/superseded',
    prepare: async (tmp) => {
      const root = join(tmp, 'l2-loader-rich');
      generateLoaderLibrary({
        out: root,
        lessons: 30,
        exercises: [2, 3],
        deps: 3,
        courses: 3,
        topology: 'window',
        rich: true,
        seed: 7,
      });
      return root;
    },
  },
];
