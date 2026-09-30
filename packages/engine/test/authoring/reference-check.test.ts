/**
 * `E_REFERENCE_FAILS` (F2, M5): компилятор прогоняет эталонное решение
 * (`referenceAnswer` вида задания) через внедрённый порт `ExerciseTypes`. Здесь —
 * поведение хука на подставном каталоге видов; настоящий SQL-раннер на
 * `sql-course` — в `@dolphy-app/ext-sql` (test/reference.test.ts) и CLI-тесте
 * `--run-checks`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/authoring/compile.ts';
import { createNodeFsCourseSource } from '../../src/node/index.ts';
import { ExerciseTypeError } from '../../src/ports/exercise-types.ts';
import type { ExerciseTypes } from '../../src/ports/exercise-types.ts';
import type { RawVerdict } from '../../src/ports/index.ts';
import { createFakeExerciseTypes } from '@dolphy-app/testkit';
import { LIBRARIES_DIR } from '../helpers/fixtures.ts';
import { useTmpDirs, writeFiles } from '../helpers/tmp.ts';

const SQL_KB = `${LIBRARIES_DIR}/sql-course/lib_kb`;
const tmp = useTmpDirs();

const PASSED: RawVerdict = { outcome: 'passed', durationMs: 1 };

interface GradeCall {
  type: string;
  exerciseId: string;
  spec: unknown;
  answer: unknown;
  timeoutMs: number;
  authorMode: boolean;
}

interface StubTypes extends ExerciseTypes {
  calls: GradeCall[];
  maxParallel: number;
}

/** Вид `dolphy.sql`: эталон — `ref:<spec.reference>`, есть только у упражнений с `spec.reference`. */
const stubTypes = (
  decide: (request: GradeCall) => RawVerdict | Promise<RawVerdict> = () =>
    PASSED,
  type = 'dolphy.sql',
): StubTypes => {
  let running = 0;
  const base = createFakeExerciseTypes({ types: { [type]: {} } });
  const stub: StubTypes = {
    ...base,
    calls: [],
    maxParallel: 0,
    referenceAnswer: async ({ spec }) => {
      const reference = (spec as { reference?: unknown }).reference;
      return typeof reference === 'string'
        ? { found: true, answer: `ref:${reference}` }
        : { found: false };
    },
    grade: async (request) => {
      stub.calls.push(request);
      running++;
      stub.maxParallel = Math.max(stub.maxParallel, running);
      try {
        await Promise.resolve();
        return await decide(request);
      } finally {
        running--;
      }
    },
  };
  return stub;
};

const copyKb = async () => {
  const dir = await tmp.copy(SQL_KB, 'reference-check-');
  return { dir, source: createNodeFsCourseSource(dir) };
};

const referenceFailures = (
  diagnostics: ReadonlyArray<{
    code: string;
    unitId?: string;
    message: string;
  }>,
) => diagnostics.filter(({ code }) => code === 'E_REFERENCE_FAILS');

describe('compile: runChecks', () => {
  it('чистая библиотека: все 21 эталона проходят, диагностик нет, артефакт есть', async () => {
    const { source } = await copyKb();
    const verifier = stubTypes();
    const result = await compile(source, {
      runChecks: { exerciseTypes: verifier },
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.artifact).not.toBeNull();
    expect(result.referenceChecks).toEqual({
      checked: 21,
      skipped: 0,
      failed: 0,
    });
    expect(verifier.calls).toHaveLength(21);
  });

  it('вид получает эталон, spec, таймаут проверки и режим автора', async () => {
    const { source } = await copyKb();
    const verifier = stubTypes();
    await compile(source, { runChecks: { exerciseTypes: verifier } });
    const call = verifier.calls.find(
      ({ exerciseId }) => exerciseId === 'sql_kb::join::q1',
    );
    expect(call).toBeDefined();
    expect(call?.type).toBe('dolphy.sql');
    expect(call?.answer).toBe('ref:solutions/join-inner-alias.sql');
    expect(call?.timeoutMs).toBe(2000);
    expect(call?.authorMode).toBe(true);
    expect(call?.spec).toMatchObject({
      reference: 'solutions/join-inner-alias.sql',
    });
  });

  it('эталон не проходит: failed и error дают E_REFERENCE_FAILS с юнитом и местом в файле', async () => {
    const { source } = await copyKb();
    const verifier = stubTypes(({ exerciseId }) => {
      if (exerciseId === 'sql_kb::join::q1') {
        return {
          outcome: 'failed',
          reason: 'mismatch',
          durationMs: 1,
          feedback: 'expected 5 row(s), got 6',
          detail: 'sorted row 1: got (1), expected (2)',
        };
      }
      if (exerciseId === 'sql_kb::join::q2') {
        return { outcome: 'error', reason: 'fixture_error', durationMs: 1 };
      }
      return PASSED;
    });
    const result = await compile(source, {
      runChecks: { exerciseTypes: verifier },
    });
    const failures = referenceFailures(result.diagnostics);
    expect(failures.map(({ unitId }) => unitId).sort()).toEqual([
      'sql_kb::join::q1',
      'sql_kb::join::q2',
    ]);
    const mismatch = result.diagnostics.find(
      ({ unitId }) => unitId === 'sql_kb::join::q1',
    );
    expect(mismatch).toMatchObject({
      severity: 'error',
      code: 'E_REFERENCE_FAILS',
      path: 'sql_kb/join.lesson/q1.front.md',
    });
    expect(mismatch?.line).toBeGreaterThan(0);
    expect(mismatch?.message).toContain('failed/mismatch');
    expect(mismatch?.message).toContain('expected 5 row(s), got 6');
    expect(mismatch?.message).toContain('expected (2)');
    expect(
      result.diagnostics.find(({ unitId }) => unitId === 'sql_kb::join::q2')
        ?.message,
    ).toContain('error/fixture_error');
    expect(result.summary.errors).toBe(2);
    expect(result.artifact).toBeNull();
    expect(result.referenceChecks).toMatchObject({ checked: 21, failed: 2 });
  });

  it('emit always: артефакт остаётся, ошибки видны', async () => {
    const { source } = await copyKb();
    const verifier = stubTypes(() => ({
      outcome: 'error',
      reason: 'timeout',
      durationMs: 1,
    }));
    const result = await compile(source, {
      emit: 'always',
      runChecks: { exerciseTypes: verifier },
    });
    expect(referenceFailures(result.diagnostics)).toHaveLength(21);
    expect(result.artifact).not.toBeNull();
  });

  it('исключение вида задания — диагностика, а не падение компиляции', async () => {
    const { source } = await copyKb();
    const verifier = stubTypes(() => {
      throw new Error('pool is dead');
    });
    const result = await compile(source, {
      runChecks: { exerciseTypes: verifier },
    });
    const failures = referenceFailures(result.diagnostics);
    expect(failures).toHaveLength(21);
    expect(failures[0]).toMatchObject({ severity: 'error' });
    expect(result.diagnostics[0]?.message).toContain('pool is dead');
  });

  it('вид не установлен — упражнения пропускаются без диагностик', async () => {
    const { source } = await copyKb();
    const other = stubTypes(() => PASSED, 'other.type');
    const result = await compile(source, {
      runChecks: { exerciseTypes: other },
    });
    expect(referenceFailures(result.diagnostics)).toEqual([]);
    expect(result.referenceChecks).toEqual({
      checked: 0,
      skipped: 21,
      failed: 0,
    });
    expect(other.calls).toHaveLength(0);
  });

  it('упражнение без reference не проверяется и считается пропущенным', async () => {
    const { dir, source } = await copyKb();
    const path = join(dir, 'sql_kb/join.lesson/q1.front.md');
    const text = await readFile(path, 'utf8');
    await writeFiles(dir, {
      'sql_kb/join.lesson/q1.front.md': text.replace(
        /\n {6}reference: .*\n/u,
        '\n',
      ),
    });
    const verifier = stubTypes();
    const result = await compile(source, {
      runChecks: { exerciseTypes: verifier },
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.referenceChecks).toEqual({
      checked: 20,
      skipped: 1,
      failed: 0,
    });
    expect(verifier.calls).toHaveLength(20);
  });

  it('referenceAnswer бросил — диагностика, grade не вызывается', async () => {
    const { source } = await copyKb();
    const verifier = stubTypes();
    verifier.referenceAnswer = async ({ type, exerciseId }) => {
      if (exerciseId === 'sql_kb::join::q1') {
        throw new ExerciseTypeError('handler-failed', type, 'cannot be read');
      }
      return { found: true, answer: 'ok' };
    };
    const result = await compile(source, {
      runChecks: { exerciseTypes: verifier },
    });
    const failures = referenceFailures(result.diagnostics);
    expect(failures.map(({ unitId }) => unitId)).toEqual(['sql_kb::join::q1']);
    expect(failures[0]?.message).toContain('cannot be read');
    expect(verifier.calls).toHaveLength(20);
  });

  it('проверки идут не более чем concurrency одновременно и доходят до него', async () => {
    const { source } = await copyKb();
    // первые два вызова ждут друг друга: параллелизм 2 достигнут, а не предположен
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verifier: StubTypes = stubTypes(async () => {
      if (verifier.maxParallel >= 2) release();
      await gate;
      return PASSED;
    });
    await compile(source, {
      runChecks: { exerciseTypes: verifier, concurrency: 2 },
    });
    expect(verifier.maxParallel).toBe(2);
    expect(verifier.calls).toHaveLength(21);
  });

  it('без runChecks код E_REFERENCE_FAILS не выдаётся и раннер не вызывается', async () => {
    const { source } = await copyKb();
    const result = await compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.referenceChecks).toBeUndefined();
    expect(result.timings).not.toHaveProperty('referenceMs');
  });
});
