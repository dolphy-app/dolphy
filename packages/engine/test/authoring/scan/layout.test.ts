import { buildLibrary, createMemoryCourseSource } from '@spirula/testkit';
import { describe, expect, it } from 'vitest';
import { assembleLibrary } from '../../../src/domain/library.ts';
import { scan } from '../../../src/authoring/scan.ts';
import type { ScanResult } from '../../../src/authoring/scan.ts';
import { asJson, codesOf, memoryFiles } from '../../helpers/scan-source.ts';

const courseJson = (id: string, extra: object = {}) =>
  asJson({ id, name: `Course ${id}`, ...extra });
const lessonJson = (id: string, courseId: string) =>
  asJson({ id, course_id: courseId, name: `Lesson ${id}` });
const exerciseJson = (id: string, lessonId: string, courseId: string) =>
  asJson({
    id,
    lesson_id: lessonId,
    course_id: courseId,
    name: `Exercise ${id}`,
    exercise_asset: { FlashcardAsset: { front_path: 'front.md' } },
  });

const idsOf = ({ model }: ScanResult) => ({
  courses: model.courses.map((unit) => unit.manifest.id),
  lessons: model.lessons.map((unit) => unit.manifest.id),
  exercises: model.exercises.map((unit) => unit.manifest.id),
});

describe('обход раскладки Trane (course_library.rs, spec C.3–C.4)', () => {
  it('пропускает манифесты вне раскладки и загружает вложенные курсы', async () => {
    const result = await scan(
      memoryFiles({
        // манифест прямо в корне библиотеки игнорируется
        'course_manifest.json': courseJson('root'),
        // каталог с именем манифеста — не манифест
        'dir/course_manifest.json/inner.txt': 'x',
        // вложенный курс `category/course`
        'category/course/course_manifest.json': courseJson('nested'),
        'category/course/lesson/lesson_manifest.json': lessonJson(
          'nested::lesson',
          'nested',
        ),
        'category/course/lesson/exercise/exercise_manifest.json': exerciseJson(
          'nested::lesson::exercise',
          'nested::lesson',
          'nested',
        ),
        'category/course/lesson/exercise/front.md': 'front',
        // упражнение глубже прямого потомка урока
        'category/course/lesson/deep/er/exercise_manifest.json': exerciseJson(
          'nested::lesson::deep',
          'nested::lesson',
          'nested',
        ),
        // урок глубже прямого потомка курса
        'category/course/group/lesson2/lesson_manifest.json': lessonJson(
          'nested::lesson2',
          'nested',
        ),
        // каталог без манифеста упражнения
        'category/course/lesson/empty/notes.txt': 'x',
      }),
    );
    expect(idsOf(result)).toEqual({
      courses: ['nested'],
      lessons: ['nested::lesson'],
      exercises: ['nested::lesson::exercise'],
    });
    expect(result.diagnostics).toEqual([]);

    const library = assembleLibrary(
      result.model.courses.map((unit) => unit.manifest),
      result.model.lessons.map((unit) => unit.manifest),
      result.model.exercises.map((unit) => unit.manifest),
      { cycleCheck: true },
    );
    expect(library.getCourseIds()).toEqual(['nested']);
    expect(library.getExerciseIds('nested::lesson')).toEqual([
      'nested::lesson::exercise',
    ]);
  });

  it('вложенный курс внутри каталога урока — отдельный курс', async () => {
    const result = await scan(
      memoryFiles({
        'c1/course_manifest.json': courseJson('c1'),
        'c1/l/lesson_manifest.json': lessonJson('c1::l', 'c1'),
        'c1/l/inner/course_manifest.json': courseJson('inner'),
      }),
    );
    expect(idsOf(result)).toEqual({
      courses: ['c1', 'inner'],
      lessons: ['c1::l'],
      exercises: [],
    });
  });

  it('манифест урока в каталоге самого курса не читается', async () => {
    const result = await scan(
      memoryFiles({
        'c1/course_manifest.json': courseJson('c1'),
        'c1/lesson_manifest.json': lessonJson('c1::l', 'c1'),
      }),
    );
    expect(idsOf(result).lessons).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('порядок обхода — по коду символов имени, служебные каталоги пропускаются', async () => {
    const result = await scan(
      memoryFiles({
        'b/course_manifest.json': courseJson('b'),
        'a/course_manifest.json': courseJson('a'),
        'B/course_manifest.json': courseJson('B'),
        'a-b/course_manifest.json': courseJson('a-b'),
        '.git/x/course_manifest.json': courseJson('git'),
        '.hidden/course_manifest.json': courseJson('hidden'),
      }),
    );
    // 'B' < 'a' < 'a-b' < 'b' по кодам символов
    expect(idsOf(result).courses).toEqual(['B', 'a', 'a-b', 'b']);
  });

  it('курс с пустым id попадает в модель: проверку id делает компилятор', async () => {
    const result = await scan(
      memoryFiles({ 'c/course_manifest.json': courseJson('') }),
    );
    expect(idsOf(result).courses).toEqual(['']);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ['пустая библиотека', {}, []],
    ['только не-манифесты', { 'readme.md': 'x', 'a/b/c.txt': 'y' }, []],
    [
      'глубокая вложенность',
      { 'a/b/c/d/course_manifest.json': courseJson('deep') },
      ['deep'],
    ],
  ] as const)('%s', async (_name, files, courses) => {
    const result = await scan(memoryFiles({ ...files }));
    expect(idsOf(result).courses).toEqual(courses);
    expect(result.diagnostics).toEqual([]);
  });
});

describe('ignored_paths (spec C.3 п.3г)', () => {
  const files = {
    'course_0/course_manifest.json': courseJson('c0'),
    'course_5/course_manifest.json': courseJson('c5'),
    'group/course_2/course_manifest.json': courseJson('g2'),
    'group/course_22/course_manifest.json': courseJson('g22'),
  };

  it.each([
    [['course_0/'], ['c5', 'g2', 'g22']],
    [['/course_0'], ['c5', 'g2', 'g22']],
    [
      ['course_0/', 'course_5/'],
      ['g2', 'g22'],
    ],
    [['group'], ['c0', 'c5']],
    // `group/course_2` не задевает `group/course_22`
    [['group/course_2'], ['c0', 'c5', 'g22']],
    // частичное имя ничего не игнорирует
    [['course_'], ['c0', 'c5', 'g2', 'g22']],
    [['../x'], ['c0', 'c5', 'g2', 'g22']],
    // отступление от Trane: `""` и `"/"` там игнорируют всю библиотеку
    [
      ['', '/'],
      ['c0', 'c5', 'g2', 'g22'],
    ],
  ])('%j оставляет %j', async (ignoredPaths, expected) => {
    const result = await scan(memoryFiles(files), { ignoredPaths });
    expect(idsOf(result).courses).toEqual(expected);
  });

  it('ignored_paths: игнорируемые курсы не дают уроков и упражнений', async () => {
    const library = buildLibrary({
      courses: [0, 1, 5, 6].map((index) => ({
        id: `course_${index}`,
        lessons: [{ id: 'lesson', exercises: 2 }],
      })),
    });
    const { model } = await scan(createMemoryCourseSource(library), {
      ignoredPaths: ['course_0/', 'course_5/'],
    });
    expect(model.courses.map((unit) => unit.manifest.id)).toEqual([
      'course_1',
      'course_6',
    ]);
    expect(
      model.exercises.filter(({ manifest }) =>
        /^course_[05]::/.test(manifest.id),
      ),
    ).toEqual([]);
    expect(model.exercises).toHaveLength(4);
  });
});

describe('пути ассетов в модели (пробы spec §4)', () => {
  const courseWith = async (
    asset: object,
    extraFiles: Record<string, string>,
  ) =>
    scan(
      memoryFiles({
        'c1/course_manifest.json': courseJson('c1', {
          course_material: asset,
        }),
        ...extraFiles,
      }),
    );

  it.each([
    ['относительный путь', 'material.md', 'c1/material.md'],
    ['подкаталог и `.`', './sub/./m.md', 'c1/sub/m.md'],
    ['`..` внутри библиотеки', 'sub/../m.md', 'c1/m.md'],
    ['абсолютный путь — от корня библиотеки', '/top.md', 'top.md'],
  ])('%s: %s -> %s', async (_name, declared, resolved) => {
    const result = await courseWith(
      { MarkdownAsset: { path: declared } },
      { [resolved]: 'text' },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.model.courses[0]?.manifest.course_material).toEqual({
      MarkdownAsset: { path: resolved },
    });
  });

  it('`../../x.md` из курса зажимается к корню: путь `x.md`, но ошибка E_ASSET_ESCAPES_ROOT', async () => {
    const result = await courseWith(
      { MarkdownAsset: { path: '../../x.md' } },
      { 'x.md': 'text' },
    );
    expect(result.diagnostics.map((d) => [d.code, d.path, d.unitId])).toEqual([
      ['E_ASSET_ESCAPES_ROOT', 'c1/course_manifest.json', 'c1'],
    ]);
    expect(result.model.courses[0]?.manifest.course_material).toEqual({
      MarkdownAsset: { path: 'x.md' },
    });
  });

  it('`d/` (завершающий слэш) — E_ASSET_MISSING, путь в модели без слэша', async () => {
    const result = await courseWith(
      { MarkdownAsset: { path: 'd/' } },
      { 'c1/d': 'file' },
    );
    expect(codesOf(result.diagnostics)).toEqual(['E_ASSET_MISSING']);
    expect(result.model.courses[0]?.manifest.course_material).toEqual({
      MarkdownAsset: { path: 'c1/d' },
    });
  });

  it('каталог вместо файла ассета — E_ASSET_MISSING', async () => {
    const result = await courseWith(
      { MarkdownAsset: { path: 'dir.md' } },
      { 'c1/dir.md/inner.txt': 'x' },
    );
    expect(codesOf(result.diagnostics)).toEqual(['E_ASSET_MISSING']);
  });

  it('встроенные ассеты путей не имеют и не проверяются', async () => {
    const result = await courseWith({ InlinedAsset: { content: 'text' } }, {});
    expect(result.diagnostics).toEqual([]);
  });

  it('несуществующий ассет курса — E_ASSET_MISSING на строке ключа', async () => {
    const result = await scan(
      memoryFiles({
        'c1/course_manifest.json':
          '{\n  "id": "c1",\n  "course_instructions": {"MarkdownAsset": {"path": "no.md"}}\n}',
      }),
    );
    expect(
      result.diagnostics.map((d) => [d.code, d.path, d.line, d.unitId]),
    ).toEqual([['E_ASSET_MISSING', 'c1/course_manifest.json', 3, 'c1']]);
  });
});
