/**
 * T-38: `engine-cli validate --run-checks` с настоящим расширением `lms.sql`:
 * эталоны sql-course проходят собственную проверку (код 0); испорченный
 * `reference` даёт `E_REFERENCE_FAILS` и код 1.
 */
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../engine/src/cli/run.ts';
import type { CreateExerciseTypes } from '../../engine/src/cli/exercise-types.ts';
import {
  createSqlExerciseTypes,
  extensionRoot,
} from './helpers/exercise-types.ts';

const SQL_KB = fileURLToPath(
  new URL(
    '../../engine/test/fixtures/libraries/sql-course/lib_kb',
    import.meta.url,
  ),
);
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const copyLibrary = async (): Promise<string> => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'ext-sql-cli-')));
  dirs.push(dir);
  await cp(SQL_KB, dir, { recursive: true });
  return dir;
};

const cli = async (dir: string) => {
  let stdout = '';
  let stderr = '';
  const createExerciseTypes: CreateExerciseTypes = async () => {
    const exerciseTypes = await createSqlExerciseTypes(dir);
    return { exerciseTypes, close: () => exerciseTypes.close() };
  };
  const code = await runCli(
    ['validate', dir, '--run-checks', '--extensions', await extensionRoot()],
    {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
    { createExerciseTypes },
  );
  return { code, stdout, stderr };
};

describe('engine-cli --run-checks с расширением lms.sql (T-38)', () => {
  it('sql-course: эталоны проходят, код 0', async () => {
    const { code, stdout, stderr } = await cli(await copyLibrary());
    expect(stderr, stderr).not.toContain('"level":"error"');
    expect(stdout).toContain(
      'reference solutions: 21 checked, 0 failed, 0 skipped',
    );
    expect(code, stdout).toBe(0);
  });

  it('испорченный reference: E_REFERENCE_FAILS на своём упражнении, код 1', async () => {
    const dir = await copyLibrary();
    const solutions = join(dir, 'solutions');
    const file = (await readdir(solutions)).find((name) =>
      name.startsWith('join-inner-alias'),
    );
    expect(file).toBeDefined();
    await writeFile(join(solutions, file!), 'SELECT 1 AS wrong;\n');
    const { code, stdout } = await cli(dir);
    expect(code).toBe(1);
    expect(stdout).toContain('E_REFERENCE_FAILS');
    expect(stdout).toContain('sql_kb::join::q1');
    expect(await readFile(join(solutions, file!), 'utf8')).toContain('wrong');
  });
});
