/**
 * T-38 (M5): `engine-cli validate|compile --run-checks`. Эталонное решение
 * упражнения проходит собственную проверку тем же `SqlVerifier`, что в
 * рантайме, иначе `E_REFERENCE_FAILS`; сломанная фикстура или ожидаемый CSV
 * (`fixture_error`/`expected_error` раннера) тоже даёт этот код; без флага код
 * не выдаётся. Процессные тесты запускают настоящий CLI с настоящим раннером.
 */
import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/run.ts';
import type { CliDeps } from '../../src/cli/run.ts';
import { VerifiersUnavailableError } from '../../src/cli/sql-runner.ts';
import type { RawVerdict, Verifier } from '../../src/ports/index.ts';
import { LIBRARIES_DIR } from '../helpers/fixtures.ts';
import { useTmpDirs } from '../helpers/tmp.ts';

const run = promisify(execFile);
const tmp = useTmpDirs();
const ENGINE_DIR = fileURLToPath(new URL('../../', import.meta.url));
const SQL_KB = `${LIBRARIES_DIR}/sql-course/lib_kb`;
const SQL_JSON = `${LIBRARIES_DIR}/sql-course/lib_json`;
const PROCESS_TIMEOUT_MS = 60_000;

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

const cli = async (argv: string[], deps?: CliDeps): Promise<CliRun> => {
  let stdout = '';
  let stderr = '';
  const code = await runCli(
    argv,
    {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
    deps,
  );
  return { code, stdout, stderr };
};

const PASSED: RawVerdict = { outcome: 'passed', durationMs: 1 };

const stubDeps = (
  decide: () => RawVerdict = () => PASSED,
): { deps: CliDeps; state: { created: number; closed: number } } => {
  const state = { created: 0, closed: 0 };
  const verifier: Verifier = {
    runner: 'sql',
    check: async () => decide(),
    close: async () => {
      state.closed++;
    },
  };
  return {
    state,
    deps: {
      createVerifiers: async () => {
        state.created++;
        return { verifiers: [verifier], close: () => verifier.close() };
      },
    },
  };
};

const cliProcess = async (...args: string[]): Promise<CliRun> => {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', 'src/cli/main.ts', ...args],
      { cwd: ENGINE_DIR },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
};

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe('engine-cli --run-checks: внедрённый верификатор (T-38)', () => {
  it('эталоны прошли: код 0, счётчики в выводе, верификатор закрыт', async () => {
    const dir = await tmp.copy(SQL_KB);
    const { deps, state } = stubDeps();
    const { code, stdout } = await cli(['validate', dir, '--run-checks'], deps);
    expect(code).toBe(0);
    expect(stdout).toContain(
      'reference solutions: 21 checked, 0 failed, 0 skipped',
    );
    expect(state).toEqual({ created: 1, closed: 1 });
  });

  it('эталон не прошёл: код 1, E_REFERENCE_FAILS в тексте и в --json, compile артефакт не пишет', async () => {
    const dir = await tmp.copy(SQL_KB);
    const { deps, state } = stubDeps(() => ({
      outcome: 'failed',
      reason: 'mismatch',
      durationMs: 1,
      feedback: 'expected 5 row(s), got 6',
    }));
    const text = await cli(['compile', dir, '--run-checks'], deps);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain('E_REFERENCE_FAILS');
    expect(text.stdout).toContain('sql_kb::join::q1');
    expect(await exists(join(dir, '.engine/compiled.json'))).toBe(false);
    const json = await cli(['validate', dir, '--run-checks', '--json'], deps);
    expect(json.code).toBe(1);
    const report = JSON.parse(json.stdout) as {
      summary: { errors: number };
      diagnostics: Array<{ code: string }>;
      referenceChecks: { checked: number; failed: number };
    };
    expect(report.summary.errors).toBe(21);
    expect(report.referenceChecks).toEqual({
      checked: 21,
      failed: 21,
      skipped: 0,
    });
    expect(
      report.diagnostics.every(({ code }) => code === 'E_REFERENCE_FAILS'),
    ).toBe(true);
    expect(state.closed).toBe(state.created);
  });

  it('раннер недоступен: код 2 и понятное сообщение', async () => {
    const dir = await tmp.copy(SQL_KB);
    const { code, stderr } = await cli(['validate', dir, '--run-checks'], {
      createVerifiers: async () => {
        throw new VerifiersUnavailableError('--run-checks требует пакет x');
      },
    });
    expect(code).toBe(2);
    expect(stderr).toContain('--run-checks требует пакет x');
  });

  it('без --run-checks верификатор не создаётся и код не выдаётся', async () => {
    const dir = await tmp.copy(SQL_KB);
    const { deps, state } = stubDeps(() => ({
      outcome: 'error',
      reason: 'internal',
      durationMs: 1,
    }));
    const { code, stdout } = await cli(['validate', dir], deps);
    expect(code).toBe(0);
    expect(stdout).not.toContain('E_REFERENCE_FAILS');
    expect(stdout).not.toContain('reference solutions');
    expect(state.created).toBe(0);
  });
});

describe('engine-cli --run-checks: процесс CLI с настоящим SQL-раннером (T-38)', () => {
  it(
    'sql-course (KB и JSON): 21 эталон проходит собственную проверку, код 0',
    async () => {
      for (const source of [SQL_KB, SQL_JSON]) {
        const dir = await tmp.copy(source);
        const { code, stdout, stderr } = await cliProcess(
          'validate',
          dir,
          '--run-checks',
        );
        expect(stderr, stderr).not.toContain('"level":"error"');
        expect(stdout).toContain(
          'reference solutions: 21 checked, 0 failed, 0 skipped',
        );
        expect(code, stdout).toBe(0);
      }
    },
    PROCESS_TIMEOUT_MS,
  );

  it(
    'сломанное эталонное решение находится: E_REFERENCE_FAILS на своём упражнении, код 1, артефакта нет',
    async () => {
      const dir = await tmp.copy(SQL_KB);
      await writeFile(
        join(dir, 'solutions/join-inner-alias.sql'),
        'SELECT e.name, d.name AS dept FROM emp e JOIN dept d ON d.id = e.dept_id WHERE e.id > 1;\n',
      );
      const { code, stdout } = await cliProcess('compile', dir, '--run-checks');
      expect(code).toBe(1);
      const lines = stdout
        .split('\n')
        .filter((line) => line.includes('E_REFERENCE_FAILS'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('sql_kb::join::q1');
      expect(lines[0]).toContain('q1.front.md');
      expect(lines[0]).toContain('failed/mismatch');
      expect(await exists(join(dir, '.engine/compiled.json'))).toBe(false);
    },
    PROCESS_TIMEOUT_MS,
  );

  it(
    'сломанная фикстура и сломанный ожидаемый CSV — тоже E_REFERENCE_FAILS',
    async () => {
      const brokenFixture = await tmp.copy(SQL_KB);
      await writeFile(
        join(brokenFixture, 'fixtures/emp.sql'),
        'CREATE TABL x;',
      );
      const fixture = await cliProcess(
        'validate',
        brokenFixture,
        '--run-checks',
      );
      expect(fixture.code).toBe(1);
      expect(fixture.stdout.match(/E_REFERENCE_FAILS/gu)).toHaveLength(21);
      expect(fixture.stdout).toContain('error/fixture_error');

      const brokenCsv = await tmp.copy(SQL_KB);
      await writeFile(join(brokenCsv, 'checks/where-is-null.csv'), 'a,b\n1\n');
      const csv = await cliProcess('validate', brokenCsv, '--run-checks');
      expect(csv.code).toBe(1);
      expect(csv.stdout).toContain('error/expected_error');
      expect(csv.stdout).toContain('sql_kb::where::q2');
    },
    PROCESS_TIMEOUT_MS,
  );

  it(
    'без --run-checks та же сломанная библиотека даёт код 0 и не упоминает E_REFERENCE_FAILS',
    async () => {
      const dir = await tmp.copy(SQL_KB);
      await writeFile(
        join(dir, 'solutions/join-inner-alias.sql'),
        'SELECT 1;\n',
      );
      const { code, stdout } = await cliProcess('validate', dir);
      expect(code).toBe(0);
      expect(stdout).not.toContain('E_REFERENCE_FAILS');
    },
    PROCESS_TIMEOUT_MS,
  );

  it(
    'compile --run-checks на чистой библиотеке пишет артефакт',
    async () => {
      const dir = await tmp.copy(SQL_KB);
      const { code } = await cliProcess('compile', dir, '--run-checks');
      expect(code).toBe(0);
      const artifact = await readFile(
        join(dir, '.engine/compiled.json'),
        'utf8',
      );
      expect(JSON.parse(artifact)).toHaveProperty('revision');
    },
    PROCESS_TIMEOUT_MS,
  );
});
