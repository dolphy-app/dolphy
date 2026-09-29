import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assembleLibrary } from '../../../src/domain/library.ts';
import { scan } from '../../../src/authoring/scan.ts';
import { createNodeFsCourseSource } from '../../../src/node/index.ts';
import { generateLibrary } from '../../helpers/gen.ts';
import { TRANE_LIBRARIES } from '../../helpers/fixtures.ts';

const scanLibrary = (root: string) => scan(createNodeFsCourseSource(root));

describe('скан библиотек Trane v0.34.1 (T-18, T-33)', () => {
  it('embedded: 1 курс, 1 урок, 1 упражнение; ни ошибок, ни предупреждений', async () => {
    const { model, diagnostics } = await scanLibrary(TRANE_LIBRARIES.embedded);
    expect(diagnostics).toEqual([]);
    expect(model.courses).toHaveLength(1);
    expect(model.lessons).toHaveLength(1);
    expect(model.exercises).toHaveLength(1);
    // пути ассетов нормализованы относительно корня библиотеки
    const course = model.courses[0]?.manifest;
    expect(course?.course_instructions).toEqual({
      MarkdownAsset: { path: 'raw_course/course.instructions.md' },
    });
    expect(course?.course_material).toEqual({
      MarkdownAsset: { path: 'raw_course/course.material.md' },
    });
    expect(model.exercises[0]?.manifest.exercise_asset).toEqual({
      FlashcardAsset: {
        front_path: 'raw_course/lesson/exercise/front.md',
        back_path: 'raw_course/lesson/exercise/back.md',
      },
    });
  });

  it('embedded собирается в библиотеку с ожидаемыми id', async () => {
    const { model } = await scanLibrary(TRANE_LIBRARIES.embedded);
    const library = assembleLibrary(
      model.courses.map((u) => u.manifest),
      model.lessons.map((u) => u.manifest),
      model.exercises.map((u) => u.manifest),
      { cycleCheck: true },
    );
    const [courseId] = library.getCourseIds();
    expect(library.getLessonIds(courseId as string)).toHaveLength(1);
    expect(library.getAllExerciseIds()).toHaveLength(1);
  });

  it('small: 3 KB-курса, 126 уроков, 126 упражнений, 0 диагностик', async () => {
    const { model, diagnostics } = await scanLibrary(TRANE_LIBRARIES.small);
    expect(diagnostics).toEqual([]);
    expect(model.courses).toHaveLength(3);
    expect(model.lessons).toHaveLength(126);
    expect(model.exercises).toHaveLength(126);
    expect(
      model.courses.every(
        ({ manifest }) =>
          manifest.generator_config !== null &&
          'KnowledgeBase' in manifest.generator_config,
      ),
    ).toBe(true);
    // уроки и упражнения KB-курсов имеют id `курс::урок[::упражнение]`
    for (const { manifest } of model.exercises) {
      expect(manifest.id).toBe(
        `${manifest.lesson_id}::${manifest.id.split('::').at(-1)}`,
      );
      expect(manifest.lesson_id.startsWith(`${manifest.course_id}::`)).toBe(
        true,
      );
    }
  });

  it('large: 0 ошибок, ровно 48 W_UNSUPPORTED_GENERATOR с файлом и строкой', async () => {
    const { model, diagnostics } = await scanLibrary(TRANE_LIBRARIES.large);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(diagnostics).toHaveLength(48);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.code).toBe('W_UNSUPPORTED_GENERATOR');
      expect(diagnostic.path).toMatch(/\/course_manifest\.json$/);
      expect(diagnostic.line).toBeGreaterThan(1);
      expect(diagnostic.unitId).toBeTruthy();
    }
    expect(model.courses).toHaveLength(51);
    expect(model.skippedCourses).toHaveLength(48);
    expect(model.lessons).toHaveLength(126);
    expect(model.exercises).toHaveLength(126);
  });

  it('все манифесты small и large разобраны схемой и собираются в граф', async () => {
    for (const root of [TRANE_LIBRARIES.small, TRANE_LIBRARIES.large]) {
      const { model } = await scanLibrary(root);
      const library = assembleLibrary(
        model.courses.map((u) => u.manifest),
        model.lessons.map((u) => u.manifest),
        model.exercises.map((u) => u.manifest),
        { cycleCheck: true },
      );
      expect(library.getCourseIds()).toHaveLength(model.courses.length);
      expect(library.getAllExerciseIds()).toHaveLength(model.exercises.length);
    }
  });
});

describe('синтетические библиотеки: чистый скан', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it.each(['kb', 'json'] as const)(
    '%s: 0 ошибок и предупреждений, все front-файлы разобраны',
    async (layout) => {
      const out = mkdtempSync(join(tmpdir(), `scan-${layout}-`));
      dirs.push(out);
      generateLibrary({
        out,
        lessons: 300,
        exercises: 4,
        courses: 6,
        layout,
        seed: 7,
      });
      const result = await scanLibrary(out);
      expect(result.diagnostics).toEqual([]);
      expect(result.model.lessons).toHaveLength(300);
      expect(result.model.exercises).toHaveLength(1200);
      expect(result.stats.frontFiles).toBe(1200);
      expect(result.model.exercises.some((u) => u.engine !== undefined)).toBe(
        true,
      );
      expect(result.model.exercises.some((u) => u.engineBroken)).toBe(false);
    },
    120_000,
  );
});
