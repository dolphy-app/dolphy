/**
 * T-38 (M5): `engine-cli validate|compile --run-checks --extensions <dir>`.
 * Эталонное решение упражнения проходит собственную проверку тем же видом
 * задания, что в рантайме, иначе `E_REFERENCE_FAILS`; без флага код не
 * выдаётся. Здесь — CLI на подставном каталоге видов; настоящий SQL-раннер
 * запускается в `@spirula/ext-sql` (test/cli-run-checks.test.ts, T-38).
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createFakeExerciseTypes } from '@spirula/testkit';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/run.ts';
import type { CliDeps } from '../../src/cli/run.ts';
import { ExerciseTypesUnavailableError } from '../../src/cli/exercise-types.ts';
import type { RawVerdict } from '../../src/ports/index.ts';
import { LIBRARIES_DIR } from '../helpers/fixtures.ts';
import { useTmpDirs } from '../helpers/tmp.ts';

const tmp = useTmpDirs();
const SQL_KB = `${LIBRARIES_DIR}/sql-course/lib_kb`;

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
  specErrors: string[] = [],
): { deps: CliDeps; state: { created: number; closed: number } } => {
  const state = { created: 0, closed: 0 };
  return {
    state,
    deps: {
      createExerciseTypes: async () => {
        state.created++;
        const exerciseTypes = createFakeExerciseTypes({
          types: { 'spirula.sql': { reference: 'select 1', specErrors } },
        });
        exerciseTypes.grade = async () => decide();
        return {
          exerciseTypes,
          close: async () => {
            state.closed++;
          },
        };
      },
    },
  };
};

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe('engine-cli --run-checks: внедрённый каталог видов (T-38)', () => {
  it('эталоны прошли: код 0, счётчики в выводе, каталог видов закрыт', async () => {
    const dir = await tmp.copy(SQL_KB);
    const { deps, state } = stubDeps();
    const { code, stdout } = await cli(
      ['validate', dir, '--run-checks', '--extensions', dir],
      deps,
    );
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
    const text = await cli(
      ['compile', dir, '--run-checks', '--extensions', dir],
      deps,
    );
    expect(text.code).toBe(1);
    expect(text.stdout).toContain('E_REFERENCE_FAILS');
    expect(text.stdout).toContain('sql_kb::join::q1');
    expect(await exists(join(dir, '.engine/compiled.json'))).toBe(false);
    const json = await cli(
      ['validate', dir, '--run-checks', '--extensions', dir, '--json'],
      deps,
    );
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

  it('расширения недоступны: код 2 и понятное сообщение', async () => {
    const dir = await tmp.copy(SQL_KB);
    const { code, stderr } = await cli(
      ['validate', dir, '--run-checks', '--extensions', dir],
      {
        createExerciseTypes: async () => {
          throw new ExerciseTypesUnavailableError(
            '--extensions требует пакет x',
          );
        },
      },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('--extensions требует пакет x');
  });

  it('--run-checks без --extensions: код 2, каталог видов не создаётся', async () => {
    const dir = await tmp.copy(SQL_KB);
    const { deps, state } = stubDeps();
    const { code, stderr } = await cli(['validate', dir, '--run-checks'], deps);
    expect(code).toBe(2);
    expect(stderr).toContain('--extensions');
    expect(state.created).toBe(0);
  });

  it('--extensions без --run-checks проверяет spec: E_EXERCISE_SPEC, код 1', async () => {
    const dir = await tmp.copy(SQL_KB);
    const { deps, state } = stubDeps(undefined, ['/fixture must be string']);
    const { code, stdout } = await cli(
      ['validate', dir, '--extensions', dir],
      deps,
    );
    expect(code).toBe(1);
    expect(stdout).toContain('E_EXERCISE_SPEC');
    expect(stdout).not.toContain('reference solutions');
    expect(state).toEqual({ created: 1, closed: 1 });
  });

  it('без --extensions каталог видов не создаётся и код не выдаётся', async () => {
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
