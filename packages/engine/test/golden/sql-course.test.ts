/**
 * Мигрированный `sql-course` (engine.exercise вместо `check:`): 0
 * диагностик, три источника `engine`, все файлы проверок на месте, а
 * ожидаемые CSV (написаны вручную) совпадают с результатом эталонных
 * решений на фикстуре `emp.sql` — оракул независим от кода движка.
 */
import { DatabaseSync } from 'node:sqlite';
import type { Library } from '../../src/domain/library.ts';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/authoring/compile.ts';
import { loadDirectory } from '../../src/authoring/load-directory.ts';
import { createNodeFsCourseSource } from '../../src/node/index.ts';
import { LIBRARIES_DIR } from '../helpers/fixtures.ts';

const LIBRARIES = {
  kb: { root: `${LIBRARIES_DIR}/sql-course/lib_kb`, course: 'sql_kb' },
  json: { root: `${LIBRARIES_DIR}/sql-course/lib_json`, course: 'sql_json' },
} as const;

const LESSONS = [
  'aggregate',
  'ddl',
  'join',
  'select',
  'subquery',
  'where',
  'window',
];

const load = async (layout: keyof typeof LIBRARIES) => {
  const source = createNodeFsCourseSource(LIBRARIES[layout].root);
  const { library, diagnostics } = await loadDirectory(source);
  expect(diagnostics).toEqual([]);
  if (library === null) throw new Error('library is not loaded');
  return { source, library };
};

/** Блок `engine.exercise`: `type`, `timeoutMs` и ключи `spec` плоским объектом. */
const verificationOf = (library: Library, id: string) => {
  const block = library.exercises.get(id)?.engine?.exercise;
  if (block === undefined) throw new Error(`no engine.exercise: ${id}`);
  return {
    ...(block.spec as Record<string, unknown>),
    type: block.type,
    timeoutMs: block.timeoutMs,
  } as Record<string, unknown> & { type: string; timeoutMs?: number };
};

describe.each(['kb', 'json'] as const)('sql-course: %s', (layout) => {
  const { course } = LIBRARIES[layout];

  it('компиляция без единой диагностики (в том числе W_UNKNOWN_KEY на `check`)', async () => {
    const result = await compile(
      createNodeFsCourseSource(LIBRARIES[layout].root),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toEqual({ errors: 0, warnings: 0, infos: 0 });
    expect(result.artifact).not.toBeNull();
  });

  it('7 уроков по 3 упражнения; ddl — единственный стартовый урок, сирот нет', async () => {
    const { library } = await load(layout);
    expect([...library.lessons.keys()].sort()).toEqual(
      LESSONS.map((name) => `${course}::${name}`),
    );
    expect(library.exercises.size).toBe(21);
    for (const lesson of library.lessons.keys()) {
      expect(library.graph.getLessonExercises(lesson)?.size, lesson).toBe(3);
    }
    expect([...(library.graph.getStartingLessons(course) ?? [])]).toEqual([
      `${course}::ddl`,
    ]);
  });

  it('курс требует проверок; у каждого упражнения есть engine.exercise вида lms.sql', async () => {
    const { library, source } = await load(layout);
    expect(library.courses.get(course)?.engine?.requiresChecks).toBe(true);
    for (const id of library.exercises.keys()) {
      const verification = verificationOf(library, id);
      expect(verification.type, id).toBe('lms.sql');
      expect(verification.timeoutMs, id).toBe(2000);
      expect(verification['fixture'], id).toBe('fixtures/emp.sql');
      for (const key of ['fixture', 'expected', 'reference'] as const) {
        const path = verification[key];
        expect(typeof path, `${id}.${key}`).toBe('string');
        expect((await source.stat(String(path)))?.kind, `${id}.${key}`).toBe(
          'file',
        );
      }
    }
  });

  it('эталонное решение даёт ожидаемый CSV (оракул — SQLite)', async () => {
    const { library, source } = await load(layout);
    const fixture = await source.readText('fixtures/emp.sql');
    for (const id of library.exercises.keys()) {
      const verification = verificationOf(library, id);
      const db = new DatabaseSync(':memory:');
      db.exec(fixture);
      const reference = (
        await source.readText(String(verification['reference']))
      )
        .trim()
        .replace(/;$/, '');
      const statement = db.prepare(reference);
      statement.setReadBigInts(true);
      const columns = statement.columns().map(({ name }) => name);
      const render = (value: unknown) => {
        if (value === null) return '';
        if (typeof value === 'number') {
          return Number.isInteger(value) ? value.toFixed(1) : String(value);
        }
        return String(value);
      };
      const actual = statement
        .all()
        .map((row) => columns.map((name) => render(row[name])).join(','));
      db.close();

      const expected = (await source.readText(String(verification['expected'])))
        .trimEnd()
        .split('\n');
      expect(expected[0], id).toBe(columns.join(','));
      const rows = expected.slice(1);
      if (verification['orderSensitive'] === true)
        expect(actual, id).toEqual(rows);
      else expect([...actual].sort(), id).toEqual([...rows].sort());
    }
  });
});

describe('sql-course: три источника engine', () => {
  it('KB: frontmatter <ex>.front.md и lesson.engine.json', async () => {
    const { library } = await load('kb');
    // блок в q1.front.md — единственный источник для упражнений KB
    expect(verificationOf(library, 'sql_kb::select::q1')).toMatchObject({
      expected: 'checks/select-order-desc-nulls.csv',
      orderSensitive: true,
    });
    expect(library.exercises.get('sql_kb::join::q3')?.engine).toMatchObject({
      keyPrerequisites: ['sql_kb::where'],
      bloom: 'analyze',
      dok: 3,
    });
    for (const lesson of ['join', 'window']) {
      expect(library.lessons.get(`sql_kb::${lesson}`)?.engine?.tags).toEqual([
        lesson,
      ]);
    }
    expect(library.lessons.get('sql_kb::select')?.engine).toBeUndefined();
  });

  it('JSON: frontmatter MarkdownAsset, ключ engine манифеста упражнения и урока', async () => {
    const { library } = await load('json');
    const q3 = library.exercises.get('sql_json::join::q3');
    // InlinedAsset frontmatter не имеет: engine — только ключом манифеста
    expect(q3?.exercise_asset).toMatchObject({
      BasicAsset: { InlinedAsset: expect.anything() },
    });
    expect(q3?.engine?.exercise?.spec?.expected).toBe(
      'checks/join-self-manager.csv',
    );
    const q1 = library.exercises.get('sql_json::join::q1');
    expect(q1?.exercise_asset).toEqual({
      BasicAsset: { MarkdownAsset: { path: 'sql_json/join/q1/q1.md' } },
    });
    expect(q1?.engine?.exercise?.spec?.expected).toBe(
      'checks/join-inner-alias.csv',
    );
    expect(library.lessons.get('sql_json::window')?.engine?.tags).toEqual([
      'window',
    ]);
  });
});
