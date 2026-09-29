/**
 * Синтетическая JSON-библиотека в раскладке Trane для сверки графа с
 * Rust-Trane (порт `spike/loader-bench/src/gen.ts`): топологии `banded`
 * и `window`, режим `rich` добавляет явные `encompassed`/`superseded`,
 * метаданные и материалы. В отличие от `gen.ts` (чистая библиотека с
 * `engine`), граф здесь случайный: есть избыточные рёбра.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

export type Topology = 'banded' | 'window';

export interface LoaderGenOptions {
  out: string;
  lessons: number;
  /** Упражнений на урок: число или `[lo, hi]` — циклически по индексу урока. */
  exercises: number | [number, number];
  deps: number;
  courses: number;
  topology: Topology;
  /** `encompassed` (10% уроков), `superseded` (5%), metadata (30%), материал (20%). */
  rich: boolean;
  seed: number;
}

const createXorshift32 = (seed: number) => {
  let state = seed | 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
};

const BAND = 50;
const WINDOW = 200;

const pickDeps = (
  i: number,
  { topology, deps }: LoaderGenOptions,
  random: () => number,
) => {
  if (i === 0 || (topology === 'banded' && i % BAND === 0)) return [];
  const lo =
    topology === 'banded'
      ? Math.max(i - 60, i - (i % BAND))
      : Math.max(0, i - WINDOW);
  const want = Math.min(deps, i - lo);
  const picked = new Set<number>();
  for (let guard = 0; picked.size < want && guard < want * 20; guard++) {
    picked.add(lo + Math.floor(random() * (i - lo)));
  }
  return [...picked].sort((a, b) => a - b);
};

const pad = (n: number, width: number) => String(n).padStart(width, '0');

export const generateLoaderLibrary = (options: LoaderGenOptions) => {
  const { out, lessons, courses, rich } = options;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const random = createXorshift32(options.seed);
  const writeText = (path: string, text: string) => writeFileSync(path, text);
  const writeJson = (path: string, value: unknown) =>
    writeText(path, JSON.stringify(value, null, 2));
  const perCourse = Math.ceil(lessons / courses);
  const courseId = (c: number) => `bench::c${pad(c, 2)}`;
  const lessonId = (i: number) =>
    `${courseId(Math.floor(i / perCourse))}::l${pad(i, 5)}`;

  for (let c = 0; c < courses; c++) {
    const dir = `${out}/c${pad(c, 2)}`;
    mkdirSync(dir, { recursive: true });
    writeText(
      `${dir}/course.material.md`,
      `# Course ${c}\n\nMaterial for course ${c}.\n`,
    );
    writeText(
      `${dir}/course.instructions.md`,
      `Practice each exercise of course ${c} and rate yourself honestly.\n`,
    );
    writeJson(`${dir}/course_manifest.json`, {
      id: courseId(c),
      name: `Synthetic course ${c}`,
      dependencies: [c - 1, c - 2].filter((x) => x >= 0).map(courseId),
      description: `Synthetic benchmark course number ${c}.`,
      authors: ['loader-bench'],
      metadata: { series: ['bench'], skill: ['synthetic'] },
      course_material: { MarkdownAsset: { path: 'course.material.md' } },
      course_instructions: {
        MarkdownAsset: { path: 'course.instructions.md' },
      },
    });
    const first = c * perCourse;
    for (let i = first; i < Math.min(lessons, first + perCourse); i++) {
      const lessonDir = `${dir}/l${pad(i, 5)}`;
      mkdirSync(lessonDir);
      const depIndexes = pickDeps(i, options, random);
      const lesson: Record<string, unknown> = {
        id: lessonId(i),
        course_id: courseId(c),
        name: `Lesson ${i}`,
        dependencies: depIndexes.map(lessonId),
      };
      if (rich) {
        if (i % 10 === 3 && depIndexes.length > 0) {
          lesson.encompassed = [[lessonId(depIndexes[0] as number), 0.5]];
        }
        if (i % 20 === 7 && i > 0) lesson.superseded = [lessonId(i - 1)];
        if (i % 10 < 3) {
          lesson.metadata = {
            key: [`k${i % 12}`],
            difficulty: [i % 2 ? 'easy' : 'hard'],
          };
        }
        if (i % 5 === 1) {
          lesson.lesson_material = {
            MarkdownAsset: { path: 'lesson.material.md' },
          };
          writeText(
            `${lessonDir}/lesson.material.md`,
            `# Lesson ${i}\n\nSome material.\n`,
          );
        }
        lesson.description = `Lesson ${i} of ${courseId(c)}.`;
      }
      writeJson(`${lessonDir}/lesson_manifest.json`, lesson);
      const [lo, hi] = Array.isArray(options.exercises)
        ? options.exercises
        : [options.exercises, options.exercises];
      const count = lo + (i % (hi - lo + 1));
      for (let e = 0; e < count; e++) {
        const exerciseDir = `${lessonDir}/e${e}`;
        mkdirSync(exerciseDir);
        writeJson(`${exerciseDir}/exercise_manifest.json`, {
          id: `${lessonId(i)}::e${e}`,
          lesson_id: lessonId(i),
          course_id: courseId(c),
          name: `Exercise ${e}`,
          description: rich ? `Exercise ${e} of lesson ${i}.` : undefined,
          exercise_type: e % 2 ? 'Declarative' : 'Procedural',
          exercise_asset: {
            FlashcardAsset: { front_path: 'front.md', back_path: 'back.md' },
          },
        });
        writeText(
          `${exerciseDir}/front.md`,
          `What is the answer to question ${e} of lesson ${i}?\n`,
        );
        writeText(
          `${exerciseDir}/back.md`,
          `The answer to question ${e} of lesson ${i} is ${(i * 7 + e) % 97}.\n`,
        );
      }
    }
  }
};
