import { describe, expect, it } from 'vitest';
import { scan } from '../../../src/authoring/scan.ts';
import type { CourseSource } from '../../../src/ports/index.ts';
import {
  asJson,
  codesOf,
  memoryFiles,
  patchSource,
} from '../../helpers/scan-source.ts';

const COURSE = 'c/course_manifest.json';
const LESSON = 'c/l/lesson_manifest.json';
const EXERCISE = 'c/l/e/exercise_manifest.json';

const skeleton = (overrides: Record<string, string> = {}) => ({
  [COURSE]: asJson({ id: 'c', name: 'C' }),
  [LESSON]: asJson({ id: 'c::l', course_id: 'c', name: 'L' }),
  [EXERCISE]: asJson({
    id: 'c::l::e',
    lesson_id: 'c::l',
    course_id: 'c',
    name: 'E',
    exercise_asset: { FlashcardAsset: { front_path: 'front.md' } },
  }),
  'c/l/e/front.md': 'front',
  ...overrides,
});

const exerciseWith = (asset: object) =>
  asJson({
    id: 'c::l::e',
    lesson_id: 'c::l',
    course_id: 'c',
    name: 'E',
    exercise_asset: asset,
  });

describe('ошибки чтения и разбора манифестов', () => {
  it('корректная библиотека: юниты и src', async () => {
    const { model, diagnostics } = await scan(memoryFiles(skeleton()));
    expect(diagnostics).toEqual([]);
    expect(model.courses[0]?.src).toEqual({ path: COURSE, line: 2 });
    expect(model.lessons[0]?.parentCourseId).toBe('c');
    expect(model.exercises[0]).toMatchObject({
      parentLessonId: 'c::l',
      parentCourseId: 'c',
      dir: 'c/l/e',
    });
    expect(model.exercises[0]?.engineBroken).toBeUndefined();
  });

  it('битый JSON — E_JSON_PARSE с файлом и строкой, юнита нет', async () => {
    const { model, diagnostics } = await scan(
      memoryFiles(skeleton({ [COURSE]: '{\n  "id": "c",\n  "name" 1\n}' })),
    );
    expect(model.courses).toEqual([]);
    // урок и упражнение без курса не читаются
    expect(model.lessons).toEqual([]);
    expect(diagnostics.map((d) => [d.code, d.path, d.line])).toEqual([
      ['E_JSON_PARSE', COURSE, 3],
    ]);
  });

  it('манифест не объект — E_SCHEMA', async () => {
    const { diagnostics } = await scan(
      memoryFiles(skeleton({ [COURSE]: '[]' })),
    );
    expect(diagnostics.map((d) => [d.code, d.path, d.line])).toEqual([
      ['E_SCHEMA', COURSE, 1],
    ]);
  });

  it('ошибка схемы — E_SCHEMA на строке id, юнит не создаётся', async () => {
    const { model, diagnostics } = await scan(
      memoryFiles(
        skeleton({
          [EXERCISE]:
            '{\n  "id": "c::l::e",\n  "lesson_id": "c::l",\n  "course_id": "c",\n  "name": "E",\n  "exercise_type": "Weird",\n  "exercise_asset": {"FlashcardAsset": {"front_path": "front.md"}}\n}',
        }),
      ),
    );
    expect(model.exercises).toEqual([]);
    expect(diagnostics.map((d) => [d.code, d.path, d.line])).toEqual([
      ['E_SCHEMA', EXERCISE, 2],
    ]);
  });

  it('нечитаемый манифест — E_IO с путём', async () => {
    const source = patchSource(memoryFiles(skeleton()), {
      unreadable: [LESSON],
    });
    const { model, diagnostics } = await scan(source);
    expect(model.lessons).toEqual([]);
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['E_IO', LESSON],
    ]);
  });

  it('недоступный корень — E_IO, модель пуста', async () => {
    const source: CourseSource = {
      ...memoryFiles({}),
      list: async () => {
        throw new Error('EACCES: permission denied');
      },
    };
    const { model, diagnostics } = await scan(source);
    expect(model.courses).toEqual([]);
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([['E_IO', '.']]);
  });

  it('неизвестные ключи манифеста — W_UNKNOWN_KEY на своей строке; `engine` известен', async () => {
    const { model, diagnostics } = await scan(
      memoryFiles(
        skeleton({
          [COURSE]:
            '{\n  "id": "c",\n  "name": "C",\n  "weird": 1,\n  "engine": {"tags": ["t"]}\n}',
        }),
      ),
    );
    expect(diagnostics.map((d) => [d.code, d.path, d.line, d.unitId])).toEqual([
      ['W_UNKNOWN_KEY', COURSE, 4, 'c'],
    ]);
    expect(model.courses[0]?.engine).toEqual({ tags: ['t'] });
  });

  it('манифест в модели не содержит ключ engine', async () => {
    const { model } = await scan(
      memoryFiles(
        skeleton({
          [LESSON]: asJson({
            id: 'c::l',
            course_id: 'c',
            engine: { dok: 2 },
          }),
        }),
      ),
    );
    expect(model.lessons[0]?.engine).toEqual({ dok: 2 });
    expect('engine' in (model.lessons[0]?.manifest ?? {})).toBe(false);
  });
});

describe('неподдерживаемые генераторы и ассеты', () => {
  it.each(['Literacy', 'Transcription'])(
    '%s — W_UNSUPPORTED_GENERATOR с файлом и строкой, курс пропущен',
    async (kind) => {
      const config =
        kind === 'Literacy'
          ? {
              Literacy: {
                generate_dictation: false,
                exercise_type: 'Procedural',
              },
            }
          : { Transcription: {} };
      const text = `{\n  "id": "c",\n  "name": "C",\n  "generator_config": ${JSON.stringify(config)}\n}`;
      const { model, diagnostics } = await scan(
        memoryFiles({ [COURSE]: text, 'c/x.lesson/e.front.md': 'x' }),
      );
      expect(model.skippedCourses).toEqual(['c']);
      expect(model.courses.map((u) => u.manifest.id)).toEqual(['c']);
      expect(model.lessons).toEqual([]);
      expect(
        diagnostics.map((d) => [d.code, d.path, d.line, d.unitId]),
      ).toEqual([['W_UNSUPPORTED_GENERATOR', COURSE, 4, 'c']]);
    },
  );

  it.each([
    [
      'LiteracyAsset',
      {
        LiteracyAsset: { lesson_type: 'Reading', examples: [], exceptions: [] },
      },
    ],
    [
      'SoundSliceAsset',
      {
        SoundSliceAsset: { link: 'http://x', description: null, backup: null },
      },
    ],
    [
      'TranscriptionAsset',
      { TranscriptionAsset: { content: 'c', external_link: null } },
    ],
  ])('%s — W_ASSET_KIND_UNSUPPORTED без каскада', async (_name, asset) => {
    const { model, diagnostics } = await scan(
      memoryFiles(skeleton({ [EXERCISE]: exerciseWith(asset) })),
    );
    expect(diagnostics.map((d) => [d.code, d.path, d.unitId])).toEqual([
      ['W_ASSET_KIND_UNSUPPORTED', EXERCISE, 'c::l::e'],
    ]);
    expect(model.exercises[0]?.engineBroken).toBeUndefined();
  });

  it('SoundSliceAsset: путь резервной копии нормализуется', async () => {
    const { model } = await scan(
      memoryFiles(
        skeleton({
          [EXERCISE]: exerciseWith({
            SoundSliceAsset: {
              link: 'http://x',
              description: null,
              backup: 'b/backup.md',
            },
          }),
        }),
      ),
    );
    expect(model.exercises[0]?.manifest.exercise_asset).toEqual({
      SoundSliceAsset: {
        link: 'http://x',
        description: null,
        backup: 'c/l/e/b/backup.md',
      },
    });
  });

  it('встроенная карточка и InlinedAsset не требуют файлов', async () => {
    const { diagnostics, model } = await scan(
      memoryFiles(
        skeleton({
          [EXERCISE]: exerciseWith({
            InlineFlashcardAsset: { front_content: 'f', back_content: null },
          }),
        }),
      ),
    );
    expect(diagnostics).toEqual([]);
    expect(model.exercises).toHaveLength(1);
  });
});

describe('проверка ассетов упражнения', () => {
  const flash = (front: string, back: string | null = null) =>
    exerciseWith({ FlashcardAsset: { front_path: front, back_path: back } });

  it('нет front-файла — E_ASSET_MISSING, engineBroken', async () => {
    const { model, diagnostics } = await scan(
      memoryFiles(skeleton({ [EXERCISE]: flash('absent.md') })),
    );
    expect(codesOf(diagnostics)).toEqual(['E_ASSET_MISSING']);
    expect(model.exercises[0]?.engineBroken).toBe(true);
  });

  it('нет back-файла — E_ASSET_MISSING, но engineBroken не ставится', async () => {
    const { model, diagnostics } = await scan(
      memoryFiles(skeleton({ [EXERCISE]: flash('front.md', 'absent.md') })),
    );
    expect(codesOf(diagnostics)).toEqual(['E_ASSET_MISSING']);
    expect(model.exercises[0]?.engineBroken).toBeUndefined();
  });

  it('не `.md` — E_ASSET_TYPE, файл не читается', async () => {
    const { model, diagnostics, contents } = await scan(
      memoryFiles(
        skeleton({ [EXERCISE]: flash('front.txt'), 'c/l/e/front.txt': 'x' }),
      ),
    );
    expect(codesOf(diagnostics)).toEqual(['E_ASSET_TYPE']);
    expect(model.exercises[0]?.engineBroken).toBe(true);
    expect(contents.has('c/l/e/front.txt')).toBe(false);
  });

  it('BasicAsset.MarkdownAsset упражнения тоже front-файл', async () => {
    const { model, diagnostics } = await scan(
      memoryFiles(
        skeleton({
          [EXERCISE]: exerciseWith({
            BasicAsset: { MarkdownAsset: { path: 'text.md' } },
          }),
          'c/l/e/text.md': '---\nengine:\n  dok: 1\n---\nbody',
        }),
      ),
    );
    expect(diagnostics).toEqual([]);
    expect(model.exercises[0]?.engine).toEqual({ dok: 1 });
    expect(model.exercises[0]?.manifest.exercise_asset).toEqual({
      BasicAsset: { MarkdownAsset: { path: 'c/l/e/text.md' } },
    });
  });

  it('материал урока: несуществующий файл — E_ASSET_MISSING на строке ключа', async () => {
    const { diagnostics } = await scan(
      memoryFiles(
        skeleton({
          [LESSON]:
            '{\n  "id": "c::l",\n  "course_id": "c",\n  "lesson_material": {"MarkdownAsset": {"path": "m.md"}}\n}',
        }),
      ),
    );
    expect(diagnostics.map((d) => [d.code, d.path, d.line, d.unitId])).toEqual([
      ['E_ASSET_MISSING', LESSON, 4, 'c::l'],
    ]);
  });
});
