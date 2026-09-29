import { describe, expect, it } from 'vitest';
import {
  MAX_MANIFEST_BYTES,
  MAX_TEXT_BYTES,
} from '../../../src/authoring/file-reader.ts';
import { scan } from '../../../src/authoring/scan.ts';
import {
  asJson,
  codesOf,
  memoryFiles,
  patchSource,
} from '../../helpers/scan-source.ts';

const COURSE = 'c/course_manifest.json';
const LESSON = 'c/l/lesson_manifest.json';
const EXERCISE = 'c/l/e/exercise_manifest.json';

const exercise = (asset: object) =>
  asJson({
    id: 'c::l::e',
    lesson_id: 'c::l',
    course_id: 'c',
    name: 'E',
    exercise_asset: asset,
  });

const flashcard = (frontPath: string) =>
  exercise({ FlashcardAsset: { front_path: frontPath, back_path: null } });

const base = (files: Record<string, string> = {}) => ({
  [COURSE]: asJson({ id: 'c' }),
  [LESSON]: asJson({ id: 'c::l', course_id: 'c' }),
  [EXERCISE]: flashcard('front.md'),
  'c/l/e/front.md': 'front',
  ...files,
});

/** Текст манифеста курса ровно из `bytes` байт (ASCII). */
const courseOfSize = (bytes: number) => {
  const head = '{"id":"c","description":"';
  const tail = '"}';
  return head + 'a'.repeat(bytes - head.length - tail.length) + tail;
};

describe('безопасность путей (T-15, часть сканера)', () => {
  it('`..` выше корня — E_ASSET_ESCAPES_ROOT, целевой файл не читается', async () => {
    const source = memoryFiles(
      base({
        [EXERCISE]: flashcard('../../../../etc/hosts.md'),
        // цель зажима существует, но читать её нельзя
        'etc/hosts.md': 'secret',
      }),
    );
    const { model, diagnostics, contents } = await scan(source);
    expect(diagnostics.map((d) => [d.code, d.path, d.unitId])).toEqual([
      ['E_ASSET_ESCAPES_ROOT', EXERCISE, 'c::l::e'],
    ]);
    expect(contents.has('etc/hosts.md')).toBe(false);
    expect(model.exercises[0]?.engineBroken).toBe(true);
  });

  it('абсолютный путь считается от корня библиотеки: `/etc/hosts` — E_ASSET_MISSING', async () => {
    const { diagnostics, contents } = await scan(
      memoryFiles(base({ [EXERCISE]: flashcard('/etc/hosts') })),
    );
    expect(codesOf(diagnostics)).toContain('E_ASSET_MISSING');
    expect(codesOf(diagnostics)).not.toContain('E_ASSET_ESCAPES_ROOT');
    expect(contents.has('etc/hosts')).toBe(false);
  });

  it('абсолютный путь к файлу внутри библиотеки допустим', async () => {
    const { model, diagnostics, contents } = await scan(
      memoryFiles(
        base({
          [EXERCISE]: flashcard('/shared/front.md'),
          'shared/front.md': 'x',
        }),
      ),
    );
    expect(diagnostics).toEqual([]);
    expect(contents.has('shared/front.md')).toBe(true);
    expect(model.exercises[0]?.manifest.exercise_asset).toEqual({
      FlashcardAsset: { front_path: 'shared/front.md', back_path: null },
    });
  });

  it('симлинк файла ассета наружу (outsideRoot) — E_ASSET_ESCAPES_ROOT, файл не читается', async () => {
    const source = patchSource(memoryFiles(base()), {
      symlinks: ['c/l/e/front.md'],
      stats: {
        'c/l/e/front.md': { outsideRoot: true, realPath: '/etc/passwd' },
      },
    });
    const { model, diagnostics, contents } = await scan(source);
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['E_ASSET_ESCAPES_ROOT', EXERCISE],
    ]);
    expect(contents.has('c/l/e/front.md')).toBe(false);
    expect(model.exercises[0]?.engineBroken).toBe(true);
  });

  it('симлинк ассета внутри корня допустим', async () => {
    const source = patchSource(memoryFiles(base()), {
      symlinks: ['c/l/e/front.md'],
      stats: { 'c/l/e/front.md': { realPath: '/lib/shared/front.md' } },
    });
    const { diagnostics } = await scan(source);
    expect(diagnostics).toEqual([]);
  });

  it('симлинк манифеста наружу не читается', async () => {
    const source = patchSource(memoryFiles(base()), {
      symlinks: [LESSON],
      stats: { [LESSON]: { outsideRoot: true } },
    });
    const { model, diagnostics, contents } = await scan(source);
    expect(model.lessons).toEqual([]);
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['E_ASSET_ESCAPES_ROOT', LESSON],
    ]);
    expect(contents.has(LESSON)).toBe(false);
  });

  it('каталог-симлинк наружу не обходится', async () => {
    const source = patchSource(
      memoryFiles({
        'ext/course_manifest.json': asJson({ id: 'ext' }),
        'ok/course_manifest.json': asJson({ id: 'ok' }),
      }),
      { symlinks: ['ext'], stats: { ext: { outsideRoot: true } } },
    );
    const { model, diagnostics } = await scan(source);
    expect(model.courses.map((u) => u.manifest.id)).toEqual(['ok']);
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['E_ASSET_ESCAPES_ROOT', 'ext'],
    ]);
  });

  it('каталог-симлинк внутри корня обходится', async () => {
    const source = patchSource(
      memoryFiles({ 'link/course_manifest.json': asJson({ id: 'via-link' }) }),
      { symlinks: ['link'], stats: { link: { realPath: '/lib/target' } } },
    );
    const { model, diagnostics } = await scan(source);
    expect(model.courses.map((u) => u.manifest.id)).toEqual(['via-link']);
    expect(diagnostics).toEqual([]);
  });

  it('петля симлинков (тот же realPath на пути обхода) — E_IO, обход останавливается', async () => {
    const source = patchSource(
      memoryFiles({
        'a/b/c/course_manifest.json': asJson({ id: 'deep' }),
        'a/b/c/d/x.txt': 'x',
      }),
      {
        symlinks: ['a/b', 'a/b/c'],
        stats: {
          'a/b': { realPath: '/lib/loop' },
          'a/b/c': { realPath: '/lib/loop' },
        },
      },
    );
    const { model, diagnostics } = await scan(source);
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['E_IO', 'a/b/c'],
    ]);
    expect(model.courses).toEqual([]);
  });

  it('висячий симлинк каталога (stat = null) молча пропускается', async () => {
    const source = patchSource(
      memoryFiles({
        'ghost/x.txt': 'x',
        'ok/course_manifest.json': asJson({ id: 'ok' }),
      }),
      { symlinks: ['ghost'] },
    );
    const real = source.stat;
    const { model, diagnostics } = await scan({
      ...source,
      stat: async (path) => (path === 'ghost' ? null : real(path)),
    });
    expect(model.courses).toHaveLength(1);
    expect(diagnostics).toEqual([]);
  });

  it('KB: симлинк каталога урока наружу не обходится, back-симлинк наружу — ошибка', async () => {
    const files = {
      'c/course_manifest.json': asJson({
        id: 'c',
        generator_config: { KnowledgeBase: {} },
      }),
      'c/out.lesson/e.front.md': 'x',
      'c/in.lesson/e.front.md': 'x',
      'c/in.lesson/e.back.md': 'x',
    };
    const source = patchSource(memoryFiles(files), {
      symlinks: ['c/out.lesson', 'c/in.lesson/e.back.md'],
      stats: {
        'c/out.lesson': { outsideRoot: true },
        'c/in.lesson/e.back.md': { outsideRoot: true },
      },
    });
    const { model, diagnostics } = await scan(source);
    expect(model.lessons.map((u) => u.manifest.id)).toEqual(['c::in']);
    expect(diagnostics.map((d) => [d.code, d.path]).sort()).toEqual([
      ['E_ASSET_ESCAPES_ROOT', 'c/in.lesson/e.back.md'],
      ['E_ASSET_ESCAPES_ROOT', 'c/out.lesson'],
    ]);
  });

  it('KB: front-симлинк наружу не читается, engineBroken', async () => {
    const source = patchSource(
      memoryFiles({
        'c/course_manifest.json': asJson({
          id: 'c',
          generator_config: { KnowledgeBase: {} },
        }),
        'c/l.lesson/e.front.md': 'secret',
      }),
      {
        symlinks: ['c/l.lesson/e.front.md'],
        stats: { 'c/l.lesson/e.front.md': { outsideRoot: true } },
      },
    );
    const { model, diagnostics, contents } = await scan(source);
    expect(model.exercises[0]?.engineBroken).toBe(true);
    expect(codesOf(diagnostics)).toEqual(['E_ASSET_ESCAPES_ROOT']);
    expect(contents.has('c/l.lesson/e.front.md')).toBe(false);
  });
});

describe('лимиты размера (T-15)', () => {
  it('манифест ровно в 1 МБ читается', async () => {
    const { model, diagnostics } = await scan(
      memoryFiles({ [COURSE]: courseOfSize(MAX_MANIFEST_BYTES) }),
    );
    expect(diagnostics).toEqual([]);
    expect(model.courses).toHaveLength(1);
  });

  it('манифест больше 1 МБ — E_IO, юнит не создаётся', async () => {
    const { model, diagnostics } = await scan(
      memoryFiles(base({ [COURSE]: courseOfSize(MAX_MANIFEST_BYTES + 1) })),
    );
    expect(model.courses).toEqual([]);
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['E_IO', COURSE],
    ]);
  });

  it('размер берётся и из фактических байт, если stat занижает его', async () => {
    const source = patchSource(
      memoryFiles({ [COURSE]: courseOfSize(MAX_MANIFEST_BYTES + 1) }),
      { stats: { [COURSE]: { bytes: 10 } } },
    );
    const { diagnostics } = await scan(source);
    expect(codesOf(diagnostics)).toEqual(['E_IO']);
  });

  it('front-файл ровно в 2 МБ читается, больше — E_IO и engineBroken', async () => {
    const text = (bytes: number) => 'a'.repeat(bytes);
    const fine = await scan(
      memoryFiles(base({ 'c/l/e/front.md': text(MAX_TEXT_BYTES) })),
    );
    expect(fine.diagnostics).toEqual([]);
    expect(fine.model.exercises[0]?.engineBroken).toBeUndefined();

    const big = await scan(
      memoryFiles(base({ 'c/l/e/front.md': text(MAX_TEXT_BYTES + 1) })),
    );
    expect(big.diagnostics.map((d) => [d.code, d.path, d.unitId])).toEqual([
      ['E_IO', 'c/l/e/front.md', 'c::l::e'],
    ]);
    expect(big.model.exercises[0]?.engineBroken).toBe(true);
    expect(big.contents.has('c/l/e/front.md')).toBe(false);
  });

  it('ассет, который сканер не читает (материал курса), лимитом не проверяется', async () => {
    const { diagnostics } = await scan(
      memoryFiles({
        [COURSE]: asJson({
          id: 'c',
          course_material: { MarkdownAsset: { path: 'm.md' } },
        }),
        'c/m.md': 'a'.repeat(MAX_TEXT_BYTES + 1),
      }),
    );
    expect(diagnostics).toEqual([]);
  });
});

describe('ScanResult.contents и статистика', () => {
  it('содержит байты прочитанных файлов; ассеты, не читаемые сканером, — нет', async () => {
    const { contents, stats } = await scan(
      memoryFiles(
        base({
          [COURSE]: asJson({
            id: 'c',
            course_material: { MarkdownAsset: { path: 'm.md' } },
          }),
          'c/m.md': 'material',
        }),
      ),
    );
    expect([...contents.keys()].sort()).toEqual([
      COURSE,
      EXERCISE,
      'c/l/e/front.md',
      LESSON,
    ]);
    expect(new TextDecoder().decode(contents.get('c/l/e/front.md'))).toBe(
      'front',
    );
    expect(stats.files).toBe(4);
    expect(stats.bytes).toBe(
      [...contents.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0),
    );
    expect(stats.frontFiles).toBe(0);
  });
});

describe('общий front-файл нескольких упражнений', () => {
  it('нечитаемый файл сообщается один раз, оба упражнения — engineBroken', async () => {
    const { model, diagnostics } = await scan(
      memoryFiles({
        [COURSE]: asJson({ id: 'c' }),
        [LESSON]: asJson({ id: 'c::l', course_id: 'c' }),
        'c/l/a/exercise_manifest.json': exercise({
          FlashcardAsset: { front_path: '/shared.md', back_path: null },
        }).replace('c::l::e', 'c::l::a'),
        'c/l/b/exercise_manifest.json': exercise({
          FlashcardAsset: { front_path: '/shared.md', back_path: null },
        }).replace('c::l::e', 'c::l::b'),
        'shared.md': 'x'.repeat(MAX_TEXT_BYTES + 1),
      }),
    );
    expect(codesOf(diagnostics)).toEqual(['E_IO']);
    expect(model.exercises.map((unit) => unit.engineBroken)).toEqual([
      true,
      true,
    ]);
  });
});
