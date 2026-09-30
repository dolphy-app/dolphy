/**
 * `E_REFERENCE_FAILS` на настоящем расширении `lms.sql`: компилятор ядра
 * получает каталог видов заданий и прогоняет эталоны `sql-course` (KB и JSON
 * раскладки) тем же кодом, что работает в рантайме.
 */
import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@lms/engine/authoring';
import { createNodeFsCourseSource } from '@lms/engine/node';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqlExerciseTypes } from './helpers/exercise-types.ts';

const LIBRARIES = fileURLToPath(
  new URL('../../engine/test/fixtures/libraries/sql-course/', import.meta.url),
);
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const copyLibrary = async (name: 'lib_kb' | 'lib_json') => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sql-ref-')));
  dirs.push(dir);
  await cp(join(LIBRARIES, name), dir, { recursive: true });
  return dir;
};

const compileWithRunner = async (dir: string) => {
  const source = createNodeFsCourseSource(dir);
  const exerciseTypes = await createSqlExerciseTypes(dir);
  try {
    return await compile(source, {
      checks: { exerciseTypes },
      runChecks: { exerciseTypes },
    });
  } finally {
    await exerciseTypes.close();
  }
};

describe('E_REFERENCE_FAILS на sql-course', () => {
  it.each(['lib_kb', 'lib_json'] as const)(
    '%s: 21 эталон проходит собственную проверку, диагностик нет',
    async (name) => {
      const result = await compileWithRunner(await copyLibrary(name));
      expect(result.diagnostics).toEqual([]);
      expect(result.referenceChecks).toEqual({
        checked: 21,
        skipped: 0,
        failed: 0,
      });
      expect(result.artifact).not.toBeNull();
    },
  );

  it('сломанное эталонное решение находится и называет упражнение', async () => {
    const dir = await copyLibrary('lib_kb');
    await writeFile(
      join(dir, 'solutions/where-is-null.sql'),
      'SELECT name FROM emp WHERE salary IS NOT NULL;\n',
    );
    const result = await compileWithRunner(dir);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'E_REFERENCE_FAILS',
      severity: 'error',
      unitId: 'sql_kb::where::q2',
      path: 'sql_kb/where.lesson/q2.front.md',
    });
    expect(result.diagnostics[0]?.message).toContain('failed/mismatch');
    // режим автора: в сообщении видны ожидаемые строки
    expect(result.diagnostics[0]?.message).toContain('expected');
    expect(result.artifact).toBeNull();
  });

  it('эталон с ошибкой SQL: текст SQLite виден автору', async () => {
    const dir = await copyLibrary('lib_json');
    await writeFile(join(dir, 'solutions/agg-having.sql'), 'SELECT FROM;\n');
    const result = await compileWithRunner(dir);
    const [only] = result.diagnostics;
    expect(result.diagnostics).toHaveLength(1);
    expect(only).toMatchObject({ code: 'E_REFERENCE_FAILS' });
    expect(only?.message).toContain('failed/sql_error');
    expect(only?.message).toMatch(/syntax error/u);
  });

  it('сломанная фикстура и битый ожидаемый CSV — E_REFERENCE_FAILS (error, не вина ученика)', async () => {
    const fixture = await copyLibrary('lib_kb');
    await writeFile(join(fixture, 'fixtures/emp.sql'), 'CREATE TABL x;');
    const brokenFixture = await compileWithRunner(fixture);
    expect(brokenFixture.summary.errors).toBe(21);
    expect(brokenFixture.diagnostics[0]?.message).toContain(
      'error/fixture_error',
    );
    const csv = await copyLibrary('lib_kb');
    await writeFile(join(csv, 'checks/agg-having.csv'), 'a,b\n1\n');
    const brokenCsv = await compileWithRunner(csv);
    expect(brokenCsv.diagnostics).toHaveLength(1);
    expect(brokenCsv.diagnostics[0]?.message).toContain('error/expected_error');
  });

  it('без runChecks E_REFERENCE_FAILS не выдаётся даже на сломанной библиотеке', async () => {
    const dir = await copyLibrary('lib_kb');
    await writeFile(join(dir, 'solutions/where-is-null.sql'), 'SELECT 1;\n');
    const exerciseTypes = await createSqlExerciseTypes(dir);
    try {
      const result = await compile(createNodeFsCourseSource(dir), {
        checks: { exerciseTypes },
      });
      expect(result.diagnostics).toEqual([]);
    } finally {
      await exerciseTypes.close();
    }
  });
});
