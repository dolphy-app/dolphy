import { describe, expect, it } from 'vitest';
import { parseEngine } from '../../../src/authoring/engine-schema.ts';
import { scan } from '../../../src/authoring/scan.ts';
import { asJson, memoryFiles } from '../../helpers/scan-source.ts';

const FRONT = 'c/l/e/front.md';
const EXERCISE = 'c/l/e/exercise_manifest.json';

const exerciseManifest = (extra: object = {}) =>
  asJson({
    id: 'c::l::e',
    lesson_id: 'c::l',
    course_id: 'c',
    name: 'E',
    exercise_asset: { FlashcardAsset: { front_path: 'front.md' } },
    ...extra,
  });

const library = (front: string, manifestExtra: object = {}) =>
  memoryFiles({
    'c/course_manifest.json': asJson({ id: 'c' }),
    'c/l/lesson_manifest.json': asJson({ id: 'c::l', course_id: 'c' }),
    [EXERCISE]: exerciseManifest(manifestExtra),
    [FRONT]: front,
  });

const scanFront = async (front: string, manifestExtra: object = {}) => {
  const result = await scan(library(front, manifestExtra));
  return { ...result, unit: result.model.exercises[0] };
};

describe('engine из frontmatter front-файла', () => {
  it('блок engine платформы: значения и строка блока', async () => {
    const { unit, diagnostics } = await scanFront(
      [
        '---',
        'engine:',
        '  exercise:',
        '    type: lms.sql',
        '    timeoutMs: 2000',
        '    spec:',
        '      fixture: fixtures/a.sql',
        '  keyPrerequisites: [c::l2]',
        '  tags: [x, y]',
        '  bloom: apply',
        '  dok: 2',
        '---',
        'Question',
      ].join('\n'),
    );
    expect(diagnostics).toEqual([]);
    expect(unit?.engine).toEqual({
      exercise: {
        type: 'lms.sql',
        timeoutMs: 2000,
        spec: { fixture: 'fixtures/a.sql' },
      },
      keyPrerequisites: ['c::l2'],
      tags: ['x', 'y'],
      bloom: 'apply',
      dok: 2,
    });
    expect(unit?.engineSrc).toEqual({ path: FRONT, line: 2 });
    expect(unit?.engineBroken).toBeUndefined();
  });

  it('CRLF, BOM и закрытие `...`', async () => {
    const { unit, diagnostics } = await scanFront(
      '\ufeff---\r\nengine:\r\n  dok: 3\r\n...\r\nBody',
    );
    expect(diagnostics).toEqual([]);
    expect(unit?.engine).toEqual({ dok: 3 });
  });

  it('файл без frontmatter и thematic break — не блок', async () => {
    for (const text of ['Just text', '---\nJust a rule\n---\nText']) {
      const { unit, diagnostics } = await scanFront(text);
      expect(diagnostics).toEqual([]);
      expect(unit?.engine).toBeUndefined();
      expect(unit?.engineBroken).toBeUndefined();
    }
  });

  it('пустой блок и блок без engine — без диагностик', async () => {
    const { diagnostics, unit } = await scanFront('---\n---\nBody');
    expect(diagnostics).toEqual([]);
    expect(unit?.engine).toBeUndefined();
  });

  it('лишний ключ frontmatter — W_UNKNOWN_KEY на своей строке', async () => {
    const { diagnostics, unit } = await scanFront(
      '---\nengine:\n  dok: 1\nfoo: bar\n---\nBody',
    );
    expect(diagnostics.map((d) => [d.code, d.path, d.line, d.unitId])).toEqual([
      ['W_UNKNOWN_KEY', FRONT, 4, 'c::l::e'],
    ]);
    expect(unit?.engine).toEqual({ dok: 1 });
    expect(unit?.engineBroken).toBeUndefined();
  });

  it('неизвестный ключ engine — W_ENGINE_UNKNOWN_KEY на своей строке; в значение не входит', async () => {
    const { diagnostics, unit } = await scanFront(
      '---\nengine:\n  exercise:\n    type: lms.sql\n  frobnicate: 1\n---\nBody',
    );
    expect(diagnostics.map((d) => [d.code, d.path, d.line])).toEqual([
      ['W_ENGINE_UNKNOWN_KEY', FRONT, 5],
    ]);
    expect(unit?.engine).toEqual({ exercise: { type: 'lms.sql' } });
    expect(unit?.engineBroken).toBeUndefined();
  });

  it('ключ engine, допустимый только для другого вида, — предупреждение', async () => {
    const { diagnostics, unit } = await scanFront(
      '---\nengine:\n  requiresChecks: true\n  dok: 1\n---\nBody',
    );
    expect(diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['W_ENGINE_UNKNOWN_KEY', 3],
    ]);
    expect(unit?.engine).toEqual({ dok: 1 });
  });

  it.each([
    ['bloom: nonsense', 3],
    ['dok: 9', 3],
    ['tags: 5', 3],
    ['exercise: {type: "", timeoutMs: 100}', 3],
  ])(
    'ошибка схемы `%s` — E_ENGINE_SCHEMA на строке ключа, каскад подавлен',
    async (line, at) => {
      const { diagnostics, unit } = await scanFront(
        `---\nengine:\n  ${line}\n---\nBody`,
      );
      expect(
        diagnostics.map((d) => [d.code, d.path, d.line, d.unitId]),
      ).toEqual([['E_ENGINE_SCHEMA', FRONT, at, 'c::l::e']]);
      expect(unit?.engine).toBeUndefined();
      expect(unit?.engineBroken).toBe(true);
    },
  );

  it('`engine` не объект — E_ENGINE_SCHEMA', async () => {
    const { diagnostics, unit } = await scanFront('---\nengine: 5\n---\nBody');
    expect(diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['E_ENGINE_SCHEMA', 2],
    ]);
    expect(unit?.engineBroken).toBe(true);
  });

  it('YAML не разбирается — E_FRONTMATTER_PARSE со строкой файла', async () => {
    const { diagnostics, unit } = await scanFront(
      '---\nengine:\n  dok: 1\n  dok: 2\n---\nBody',
    );
    expect(diagnostics.map((d) => [d.code, d.path, d.line])).toEqual([
      ['E_FRONTMATTER_PARSE', FRONT, 4],
    ]);
    expect(unit?.engineBroken).toBe(true);
  });

  it('псевдонимы YAML отвергаются', async () => {
    const { diagnostics } = await scanFront(
      '---\nengine:\n  tags: &t [a]\n  x: *t\n---\nBody',
    );
    expect(diagnostics.map((d) => d.code)).toEqual(['E_FRONTMATTER_PARSE']);
  });

  it('открытый и не закрытый блок — E_FRONTMATTER_UNTERMINATED на первой строке', async () => {
    const { diagnostics, unit } = await scanFront(
      '---\nengine:\n  dok: 1\nText',
    );
    expect(diagnostics.map((d) => [d.code, d.path, d.line, d.unitId])).toEqual([
      ['E_FRONTMATTER_UNTERMINATED', FRONT, 1, 'c::l::e'],
    ]);
    expect(unit?.engineBroken).toBe(true);
    expect(unit?.engine).toBeUndefined();
  });

  it('пустой front-файл не ломает разбор', async () => {
    const { diagnostics, unit } = await scanFront('');
    expect(diagnostics).toEqual([]);
    expect(unit?.engineBroken).toBeUndefined();
  });
});

describe('engine из манифеста и дубликаты', () => {
  it('ключ engine манифеста упражнения: значение и строка', async () => {
    const { unit, diagnostics } = await scanFront('body', {
      engine: { exercise: { type: 'lms.sql' } },
    });
    expect(diagnostics).toEqual([]);
    expect(unit?.engine).toEqual({ exercise: { type: 'lms.sql' } });
    expect(unit?.engineSrc?.path).toBe(EXERCISE);
  });

  it('engine и в манифесте, и в frontmatter — E_ENGINE_DUPLICATE, engineBroken', async () => {
    const { diagnostics, unit } = await scanFront(
      '---\nengine:\n  dok: 1\n---\nBody',
      { engine: { dok: 2 } },
    );
    expect(diagnostics.map((d) => [d.code, d.path, d.line, d.unitId])).toEqual([
      ['E_ENGINE_DUPLICATE', FRONT, 2, 'c::l::e'],
    ]);
    expect(unit?.engineBroken).toBe(true);
    // побеждает манифест: второй источник не подмешивается
    expect(unit?.engine).toEqual({ dok: 2 });
  });

  it('сломанный engine манифеста — E_ENGINE_SCHEMA, engineBroken', async () => {
    const { diagnostics, unit } = await scanFront('body', {
      engine: { dok: 7 },
    });
    expect(diagnostics.map((d) => d.code)).toEqual(['E_ENGINE_SCHEMA']);
    expect(unit?.engine).toBeUndefined();
    expect(unit?.engineBroken).toBe(true);
  });

  it('engine курса и урока: допустимые ключи по видам', async () => {
    const { model, diagnostics } = await scan(
      memoryFiles({
        'c/course_manifest.json': asJson({
          id: 'c',
          engine: {
            requiresChecks: true,
            tags: ['t'],
            granularity: { min: 2, max: 5 },
            bloom: 'apply',
          },
        }),
        'c/l/lesson_manifest.json': asJson({
          id: 'c::l',
          course_id: 'c',
          engine: {
            nonAncestor: ['x'],
            keyPrerequisites: ['c::k'],
            requiresChecks: true,
          },
        }),
      }),
    );
    expect(model.courses[0]?.engine).toEqual({
      requiresChecks: true,
      tags: ['t'],
      granularity: { min: 2, max: 5 },
    });
    expect(model.lessons[0]?.engine).toEqual({
      nonAncestor: ['x'],
      keyPrerequisites: ['c::k'],
    });
    expect(diagnostics.map((d) => [d.code, d.path, d.unitId]).sort()).toEqual([
      ['W_ENGINE_UNKNOWN_KEY', 'c/course_manifest.json', 'c'],
      ['W_ENGINE_UNKNOWN_KEY', 'c/l/lesson_manifest.json', 'c::l'],
    ]);
  });
});

describe('схема engine (parseEngine)', () => {
  const ok = (raw: unknown, kind: 'course' | 'lesson' | 'exercise') => {
    const result = parseEngine(raw, kind);
    return result.ok ? result.value : result.issues;
  };

  it('exercise сохраняет spec как есть', () => {
    expect(
      ok(
        {
          exercise: {
            type: 'lms.sql',
            timeoutMs: 1000,
            spec: { fixture: 'f', n: [1] },
          },
        },
        'exercise',
      ),
    ).toEqual({
      exercise: {
        type: 'lms.sql',
        timeoutMs: 1000,
        spec: { fixture: 'f', n: [1] },
      },
    });
  });

  it('exercise: лишний ключ блока — ошибка', () => {
    expect(
      parseEngine({ exercise: { type: 'a', runner: 'sql' } }, 'exercise').ok,
    ).toBe(false);
  });

  it.each([
    ['type пуст', { exercise: { type: '' } }],
    ['type отсутствует', { exercise: {} }],
    ['spec не объект', { exercise: { type: 'a', spec: 'x' } }],
    ['timeoutMs = 0', { exercise: { type: 'a', timeoutMs: 0 } }],
    ['timeoutMs дробный', { exercise: { type: 'a', timeoutMs: 1.5 } }],
    ['timeoutMs отрицателен', { exercise: { type: 'a', timeoutMs: -1 } }],
    ['dok = 0', { dok: 0 }],
    ['dok = 5', { dok: 5 }],
    ['dok строкой', { dok: '2' }],
    ['bloom вне списка', { bloom: 'know' }],
    ['keyPrerequisites с пустым id', { keyPrerequisites: [''] }],
    ['tags не массив', { tags: 'a' }],
  ])('exercise: %s — ошибка', (_name, raw) => {
    const result = parseEngine(raw, 'exercise');
    expect(result.ok).toBe(false);
  });

  it.each([1, 2, 3, 4])('dok = %i допустим', (dok) => {
    expect(ok({ dok }, 'exercise')).toEqual({ dok });
  });

  it.each(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'])(
    'bloom = %s допустим',
    (bloom) => {
      expect(ok({ bloom }, 'lesson')).toEqual({ bloom });
    },
  );

  it('nonAncestor: boolean или список id', () => {
    expect(ok({ nonAncestor: true }, 'lesson')).toEqual({ nonAncestor: true });
    expect(ok({ nonAncestor: ['a', 'b'] }, 'lesson')).toEqual({
      nonAncestor: ['a', 'b'],
    });
    expect(parseEngine({ nonAncestor: 'a' }, 'lesson').ok).toBe(false);
  });

  it.each([
    [{ min: 1 }, true],
    [{ max: 12 }, true],
    [{ min: 3, max: 3 }, true],
    [{ min: 3, max: 12 }, true],
    [{}, true],
    [{ min: 0 }, false],
    [{ max: 0 }, false],
    [{ min: 1.5 }, false],
    [{ min: 5, max: 4 }, false],
  ])('granularity %j допустима: %s', (granularity, valid) => {
    expect(parseEngine({ granularity }, 'course').ok).toBe(valid);
  });

  it('ключи, чужие для вида, не валидируются и в значение не входят', () => {
    const result = parseEngine({ tags: ['a'], dok: 99, frob: 1 }, 'course');
    expect(result).toEqual({
      ok: true,
      value: { tags: ['a'] },
      unknownKeys: ['dok', 'frob'],
    });
  });

  it('не объект — ошибка на самом блоке', () => {
    for (const raw of [null, 5, 'x', [1]]) {
      const result = parseEngine(raw, 'course');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues[0]?.key).toBe('');
    }
  });
});
