/**
 * `E_REFERENCE_FAILS` (F2, M5): компилятор прогоняет эталонное решение
 * (`engine.verification.reference`) через внедрённый `Verifier`. Здесь —
 * поведение хука на подставном верификаторе; настоящий SQL-раннер на
 * `sql-course` — в `@lms/engine-sql-runner` (test/process/reference.test.ts)
 * и CLI-тесте `--run-checks`.
 */
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/authoring/compile.ts';
import { createNodeFsCourseSource } from '../../src/node/index.ts';
import type {
  RawVerdict,
  Verifier,
  VerifyRequest,
} from '../../src/ports/index.ts';
import { LIBRARIES_DIR } from '../helpers/fixtures.ts';
import { useTmpDirs, writeFiles } from '../helpers/tmp.ts';

const SQL_KB = `${LIBRARIES_DIR}/sql-course/lib_kb`;
const tmp = useTmpDirs();

const PASSED: RawVerdict = { outcome: 'passed', durationMs: 1 };

interface StubVerifier extends Verifier {
  calls: VerifyRequest[];
  maxParallel: number;
}

const stubVerifier = (
  decide: (request: VerifyRequest) => RawVerdict | Promise<RawVerdict> = () =>
    PASSED,
  runner = 'sql',
): StubVerifier => {
  let running = 0;
  const stub: StubVerifier = {
    runner,
    calls: [],
    maxParallel: 0,
    check: async (request) => {
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
    close: async () => {},
  };
  return stub;
};

const copyKb = async () => {
  const dir = await tmp.copy(SQL_KB, 'reference-check-');
  return { dir, source: createNodeFsCourseSource(dir) };
};

const referenceFailures = (
  diagnostics: ReadonlyArray<{ code: string; unitId?: string }>,
) => diagnostics.filter(({ code }) => code === 'E_REFERENCE_FAILS');

describe('compile: runChecks', () => {
  it('чистая библиотека: все 21 эталона проходят, диагностик нет, артефакт есть', async () => {
    const { source } = await copyKb();
    const verifier = stubVerifier();
    const result = await compile(source, {
      runChecks: { verifiers: [verifier] },
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

  it('раннер получает текст эталона, таймаут проверки и режим автора', async () => {
    const { dir, source } = await copyKb();
    const verifier = stubVerifier();
    await compile(source, { runChecks: { verifiers: [verifier] } });
    const call = verifier.calls.find(
      ({ exercise }) => exercise.id === 'sql_kb::join::q1',
    );
    expect(call).toBeDefined();
    const reference = await readFile(
      join(dir, 'solutions/join-inner-alias.sql'),
      'utf8',
    );
    expect(call?.submission).toEqual({ kind: 'sql', sql: reference.trim() });
    expect(call?.timeoutMs).toBe(2000);
    expect(call?.authorMode).toBe(true);
    expect(call?.exercise.engine?.verification).toMatchObject({
      runner: 'sql',
      reference: 'solutions/join-inner-alias.sql',
    });
  });

  it('эталон не проходит: failed и error дают E_REFERENCE_FAILS с юнитом и местом в файле', async () => {
    const { source } = await copyKb();
    const verifier = stubVerifier(({ exercise }) => {
      if (exercise.id === 'sql_kb::join::q1') {
        return {
          outcome: 'failed',
          reason: 'mismatch',
          durationMs: 1,
          feedback: 'expected 5 row(s), got 6',
          detail: 'sorted row 1: got (1), expected (2)',
        };
      }
      if (exercise.id === 'sql_kb::join::q2') {
        return { outcome: 'error', reason: 'fixture_error', durationMs: 1 };
      }
      return PASSED;
    });
    const result = await compile(source, {
      runChecks: { verifiers: [verifier] },
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
    const verifier = stubVerifier(() => ({
      outcome: 'error',
      reason: 'timeout',
      durationMs: 1,
    }));
    const result = await compile(source, {
      emit: 'always',
      runChecks: { verifiers: [verifier] },
    });
    expect(referenceFailures(result.diagnostics)).toHaveLength(21);
    expect(result.artifact).not.toBeNull();
  });

  it('исключение верификатора — диагностика, а не падение компиляции', async () => {
    const { source } = await copyKb();
    const verifier = stubVerifier(() => {
      throw new Error('pool is dead');
    });
    const result = await compile(source, {
      runChecks: { verifiers: [verifier] },
    });
    const failures = referenceFailures(result.diagnostics);
    expect(failures).toHaveLength(21);
    expect(failures[0]).toMatchObject({ severity: 'error' });
    expect(result.diagnostics[0]?.message).toContain('pool is dead');
  });

  it('нет верификатора для раннера — E_REFERENCE_FAILS на каждый эталон', async () => {
    const { source } = await copyKb();
    const other = stubVerifier(() => PASSED, 'json');
    const result = await compile(source, { runChecks: { verifiers: [other] } });
    expect(referenceFailures(result.diagnostics)).toHaveLength(21);
    expect(result.diagnostics[0]?.message).toContain("runner 'sql'");
    expect(other.calls).toHaveLength(0);
  });

  it('упражнение без reference не проверяется и считается пропущенным', async () => {
    const { dir, source } = await copyKb();
    const path = join(dir, 'sql_kb/join.lesson/q1.front.md');
    const text = await readFile(path, 'utf8');
    await writeFiles(dir, {
      'sql_kb/join.lesson/q1.front.md': text.replace(
        /\n {4}reference: .*\n/u,
        '\n',
      ),
    });
    const verifier = stubVerifier();
    const result = await compile(source, {
      runChecks: { verifiers: [verifier] },
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.referenceChecks).toEqual({
      checked: 20,
      skipped: 1,
      failed: 0,
    });
    expect(verifier.calls).toHaveLength(20);
  });

  it('файл эталона нет или путь ведёт за корень — диагностика, раннер не вызывается', async () => {
    const { dir, source } = await copyKb();
    await rm(join(dir, 'solutions/join-inner-alias.sql'));
    const path = 'sql_kb/join.lesson/q2.front.md';
    const text = await readFile(join(dir, path), 'utf8');
    await writeFiles(dir, {
      [path]: text.replace(/reference: .*\n/u, 'reference: ../outside.sql\n'),
    });
    const verifier = stubVerifier();
    const result = await compile(source, {
      runChecks: { verifiers: [verifier] },
    });
    const failures = result.diagnostics.filter(
      ({ code }) => code === 'E_REFERENCE_FAILS',
    );
    expect(failures.map(({ unitId }) => unitId).sort()).toEqual([
      'sql_kb::join::q1',
      'sql_kb::join::q2',
    ]);
    expect(
      failures.every(({ message }) => message.includes('cannot be read')),
    ).toBe(true);
    expect(verifier.calls).toHaveLength(19);
  });

  it('проверки идут не более чем concurrency одновременно и доходят до него', async () => {
    const { source } = await copyKb();
    // первые два вызова ждут друг друга: параллелизм 2 достигнут, а не предположен
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verifier: StubVerifier = stubVerifier(async () => {
      if (verifier.maxParallel >= 2) release();
      await gate;
      return PASSED;
    });
    await compile(source, {
      runChecks: { verifiers: [verifier], concurrency: 2 },
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
