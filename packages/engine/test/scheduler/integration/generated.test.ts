/**
 * Порт `tests/generated_courses.rs` Trane: упражнения курса, порождённого
 * генератором, достижимы планировщиком.
 *
 * Портирован только `knowledge_base_course_generator_assets` (генератор
 * `KnowledgeBase` перенесён: `authoring/knowledge-base.ts`). Библиотека
 * собирается сканером из файлов в памяти (вместо диска и `TempDir`), затем
 * `assembleLibrary`. `literacy_course_generator` и
 * `transcription_course_generator` не портируются: генераторы Literacy и
 * Transcription в порт не переносятся (решение проекта), проверять нечего.
 */
import { describe, expect, it } from 'vitest';
import { assembleLibrary } from '../../../src/domain/library.ts';
import type {
  BasicAsset,
  ExerciseAsset,
} from '../../../src/domain/manifest.ts';
import { scan } from '../../../src/authoring/scan.ts';
import { asJson, memoryFiles } from '../../helpers/scan-source.ts';
import { createWorldFromLibrary } from '../helpers/world.ts';
import {
  always,
  assertScheduledExactly,
  assertSimulationScores,
  forEachSeed,
  simulate,
} from './helpers.ts';

const COURSE = 'knowledge_base_course';

const FILES: Record<string, string> = {
  [`${COURSE}/course_manifest.json`]: asJson({
    id: COURSE,
    name: COURSE,
    generator_config: { KnowledgeBase: { inlined: false } },
    course_instructions: { MarkdownAsset: { path: 'course.instructions.md' } },
    course_material: { MarkdownAsset: { path: 'course.material.md' } },
  }),
  [`${COURSE}/course.instructions.md`]: 'Course instructions',
  [`${COURSE}/course.material.md`]: 'Course material',
  [`${COURSE}/lesson_0.lesson/lesson.instructions.md`]: 'Lesson instructions',
  [`${COURSE}/lesson_0.lesson/lesson.material.md`]: 'Lesson material',
  [`${COURSE}/lesson_0.lesson/exercise_0.front.md`]: 'Front 0',
  [`${COURSE}/lesson_0.lesson/exercise_0.back.md`]: 'Back 0',
  [`${COURSE}/lesson_1.lesson/exercise_1.front.md`]: 'Front 1',
  [`${COURSE}/lesson_1.lesson/exercise_1.back.md`]: 'Back 1',
  [`${COURSE}/lesson_1.lesson/lesson.dependencies.json`]: '["lesson_0"]',
};

const markdownPath = (asset: BasicAsset | null | undefined) =>
  asset !== null && asset !== undefined && 'MarkdownAsset' in asset
    ? asset.MarkdownAsset.path
    : null;

const flashcardPaths = (asset: ExerciseAsset | undefined) =>
  asset !== undefined && 'FlashcardAsset' in asset
    ? asset.FlashcardAsset
    : null;

describe('курсы, порождённые генераторами', () => {
  it('knowledge_base_course_generator_assets: все упражнения достижимы, ассеты читаются по путям манифестов', async () => {
    const source = memoryFiles(FILES);
    const { model, diagnostics } = await scan(source);
    expect(diagnostics).toEqual([]);
    const library = assembleLibrary(
      model.courses.map((unit) => unit.manifest),
      model.lessons.map((unit) => unit.manifest),
      model.exercises.map((unit) => unit.manifest),
      { cycleCheck: true },
    );

    const expected = [
      `${COURSE}::lesson_0::exercise_0`,
      `${COURSE}::lesson_1::exercise_1`,
    ];
    expect(library.getAllExerciseIds()).toEqual(expected);
    // зависимость `lesson_0` в файле превращается в полный id
    expect(library.getLesson(`${COURSE}::lesson_1`)?.dependencies).toEqual([
      `${COURSE}::lesson_0`,
    ]);

    forEachSeed((seed) => {
      const world = createWorldFromLibrary(library, { seed });
      const history = simulate(world, {
        exercises: expected.length * 10,
        answer: always(5),
      });
      expect(history.size).toBe(expected.length);
      assertScheduledExactly(world, history, expected, () => true);
      for (const exerciseId of expected) {
        assertSimulationScores(world, exerciseId, history);
      }
    });

    // Ассеты курса и урока: пути от корня библиотеки, содержимое — из файлов.
    const readAsset = (asset: BasicAsset | null | undefined) =>
      source.readText(markdownPath(asset) as string);
    const courseManifest = library.getCourse(COURSE);
    expect(markdownPath(courseManifest?.course_instructions)).toBe(
      `${COURSE}/course.instructions.md`,
    );
    expect(await readAsset(courseManifest?.course_instructions)).toBe(
      'Course instructions',
    );
    expect(markdownPath(courseManifest?.course_material)).toBe(
      `${COURSE}/course.material.md`,
    );
    expect(await readAsset(courseManifest?.course_material)).toBe(
      'Course material',
    );

    const lessonManifest = library.getLesson(`${COURSE}::lesson_0`);
    expect(markdownPath(lessonManifest?.lesson_instructions)).toBe(
      `${COURSE}/lesson_0.lesson/lesson.instructions.md`,
    );
    expect(await readAsset(lessonManifest?.lesson_instructions)).toBe(
      'Lesson instructions',
    );
    expect(markdownPath(lessonManifest?.lesson_material)).toBe(
      `${COURSE}/lesson_0.lesson/lesson.material.md`,
    );
    expect(await readAsset(lessonManifest?.lesson_material)).toBe(
      'Lesson material',
    );

    // Упражнения: FlashcardAsset с путями от корня (без ведущего `/`).
    const expectedAssets = [
      [expected[0], 'Front 0', 'Back 0'],
      [expected[1], 'Front 1', 'Back 1'],
    ] as const;
    for (const [exerciseId, front, back] of expectedAssets) {
      const paths = flashcardPaths(
        library.getExercise(exerciseId)?.exercise_asset,
      );
      expect(paths, `FlashcardAsset of ${exerciseId}`).not.toBeNull();
      expect(paths?.front_path.startsWith('/')).toBe(false);
      expect(paths?.back_path?.startsWith('/')).toBe(false);
      expect(await source.readText(paths?.front_path ?? '')).toBe(front);
      expect(await source.readText(paths?.back_path ?? '')).toBe(back);
    }
  });
});
