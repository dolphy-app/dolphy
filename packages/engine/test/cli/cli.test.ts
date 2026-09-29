/**
 * T-38: `engine-cli validate|compile <dir>` — коды выхода, артефакт только
 * на чистой библиотеке, `--json`, `--verbose`, `--out`, `--run-checks`.
 */
import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { decodeArtifact, loadCompiled } from '../../src/authoring/artifact.ts';
import { runCli } from '../../src/cli/run.ts';
import { generateLibrary } from '../helpers/gen.ts';
import { LIBRARIES_DIR, TRANE_LIBRARIES } from '../helpers/fixtures.ts';
import { useTmpDirs } from '../helpers/tmp.ts';

const run = promisify(execFile);
const tmp = useTmpDirs();
const ENGINE_DIR = fileURLToPath(new URL('../../', import.meta.url));
const SQL_KB = `${LIBRARIES_DIR}/sql-course/lib_kb`;

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

const cli = async (...argv: string[]): Promise<CliRun> => {
  let stdout = '';
  let stderr = '';
  const code = await runCli(argv, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { code, stdout, stderr };
};

interface ExecFailure {
  code: number;
  stdout: string;
  stderr: string;
}

/** Ожидает ненулевой код выхода процесса; `execFile` отклоняется объектом с `code`. */
const failure = async (pending: Promise<unknown>): Promise<ExecFailure> => {
  try {
    await pending;
  } catch (error) {
    const failed = error as ExecFailure; // тип ошибки `execFile` в @types/node не выписан
    return failed;
  }
  throw new Error('process exited with code 0');
};

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Небольшая KB-библиотека с двумя дефектами: битый JSON (error) и лишний ключ (warning). */
const defectiveLibrary = async () => {
  const dir = await tmp.make('engine-cli-bad-');
  generateLibrary({
    out: dir,
    lessons: 100,
    exercises: 4,
    courses: 2,
    layout: 'kb',
    seed: 7,
  });
  await writeFile(join(dir, 'c00/l00003.lesson/lesson.name.json'), '{oops');
  const manifestPath = join(dir, 'c01/course_manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as object;
  await writeFile(manifestPath, JSON.stringify({ ...manifest, weird: 1 }));
  return dir;
};

describe('engine-cli: дефектная библиотека', () => {
  it('validate: код 1, диагностики в человекочитаемом виде и сводка', async () => {
    const dir = await defectiveLibrary();
    const { code, stdout, stderr } = await cli('validate', dir);
    expect(code).toBe(1);
    expect(stderr).toBe('');
    const errorLine = stdout
      .split('\n')
      .find((line) => line.startsWith('error'));
    expect(errorLine).toMatch(/E_JSON_PARSE/);
    expect(errorLine).toContain('c00/l00003.lesson/lesson.name.json');
    expect(stdout).toMatch(
      /warning\s+W_UNKNOWN_KEY\s+.*c01\/course_manifest\.json/,
    );
    expect(stdout).toMatch(/1 error\(s\), 1 warning\(s\)/);
  });

  it('compile: код 1 и артефакта нет', async () => {
    const dir = await defectiveLibrary();
    const { code, stdout } = await cli('compile', dir);
    expect(code).toBe(1);
    expect(stdout).not.toContain('wrote ');
    expect(await exists(join(dir, '.engine/compiled.json'))).toBe(false);
  });

  it('compile --out на дефектной: файла нет', async () => {
    const dir = await defectiveLibrary();
    const out = join(await tmp.make(), 'artifact.json');
    const { code } = await cli('compile', dir, '--out', out);
    expect(code).toBe(1);
    expect(await exists(out)).toBe(false);
  });

  it('--json: машиночитаемая сводка и диагностики, revision = null', async () => {
    const dir = await defectiveLibrary();
    const { code, stdout } = await cli('validate', dir, '--json');
    expect(code).toBe(1);
    const report = JSON.parse(stdout) as {
      root: string;
      summary: { errors: number; warnings: number; infos: number };
      diagnostics: Array<{ code: string; severity: string; path?: string }>;
      revision: string | null;
    };
    expect(report.root).toBe(dir);
    expect(report.summary).toMatchObject({ errors: 1, warnings: 1 });
    expect(report.revision).toBeNull();
    expect(
      report.diagnostics.find(({ code: c }) => c === 'E_JSON_PARSE')?.path,
    ).toBe('c00/l00003.lesson/lesson.name.json');
  });
});

describe('engine-cli: чистые библиотеки', () => {
  it('validate trane-embedded: код 0, артефакт не пишется', async () => {
    const dir = await tmp.copy(TRANE_LIBRARIES.embedded);
    const { code, stdout } = await cli('validate', dir);
    expect(code).toBe(0);
    expect(stdout).toMatch(/0 error\(s\), 0 warning\(s\)/);
    expect(await exists(join(dir, '.engine/compiled.json'))).toBe(false);
  });

  it('compile trane-embedded: артефакт записан и загружается', async () => {
    const dir = await tmp.copy(TRANE_LIBRARIES.embedded);
    const { code, stdout } = await cli('compile', dir);
    expect(code).toBe(0);
    expect(stdout).toContain(`wrote ${join(dir, '.engine/compiled.json')}`);
    const library = loadCompiled(
      decodeArtifact(
        await readFile(join(dir, '.engine/compiled.json'), 'utf8'),
      ),
    );
    expect([
      library.courses.size,
      library.lessons.size,
      library.exercises.size,
    ]).toEqual([1, 1, 1]);
  });

  it('compile sql-course: 0 диагностик, в артефакте 7 уроков и 21 упражнение', async () => {
    const dir = await tmp.copy(SQL_KB);
    const { code, stdout } = await cli('compile', dir);
    expect(code).toBe(0);
    expect(stdout).toMatch(/0 error\(s\), 0 warning\(s\), 0 info/);
    const library = loadCompiled(
      decodeArtifact(
        await readFile(join(dir, '.engine/compiled.json'), 'utf8'),
      ),
    );
    expect(library.lessons.size).toBe(7);
    expect(library.exercises.size).toBe(21);
  });

  it('--json на compile: revision из артефакта, вывод без строки «wrote»', async () => {
    const dir = await tmp.copy(SQL_KB);
    const { code, stdout } = await cli('compile', dir, '--json');
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as {
      revision: string;
      diagnostics: unknown[];
    };
    const artifact = decodeArtifact(
      await readFile(join(dir, '.engine/compiled.json'), 'utf8'),
    );
    expect(report.revision).toBe(artifact.revision);
    expect(report.diagnostics).toEqual([]);
  });

  it('--verbose показывает info-диагностики, без него они скрыты, но учтены в сводке', async () => {
    const dir = await tmp.copy(TRANE_LIBRARIES.embedded);
    const quiet = JSON.parse((await cli('validate', dir, '--json')).stdout) as {
      summary: { infos: number };
      diagnostics: Array<{ severity: string }>;
    };
    const loud = JSON.parse(
      (await cli('validate', dir, '--json', '--verbose')).stdout,
    ) as typeof quiet;
    expect(quiet.summary.infos).toBeGreaterThan(0);
    expect(quiet.diagnostics.filter((d) => d.severity === 'info')).toEqual([]);
    expect(loud.diagnostics.filter((d) => d.severity === 'info')).toHaveLength(
      loud.summary.infos,
    );
    const text = (await cli('validate', dir, '--verbose')).stdout;
    expect(text).toMatch(/^info\s/m);
    expect((await cli('validate', dir)).stdout).not.toMatch(/^info\s/m);
  });

  it('--out: артефакт по указанному пути, каталог библиотеки не тронут', async () => {
    const dir = await tmp.copy(SQL_KB);
    const out = join(await tmp.make(), 'nested-not-created.json');
    const { code } = await cli('compile', dir, '--out', out);
    expect(code).toBe(0);
    expect(decodeArtifact(await readFile(out, 'utf8')).revision).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(await exists(join(dir, '.engine'))).toBe(false);
  });

  it('--out внутри библиотеки не входит в её revision', async () => {
    const dir = await tmp.copy(SQL_KB);
    const out = join(dir, 'build/artifact.json');
    expect((await cli('compile', dir, '--out', out)).code).toBe(0);
    const first = decodeArtifact(await readFile(out, 'utf8')).revision;
    expect((await cli('compile', dir, '--out', out)).code).toBe(0);
    expect(decodeArtifact(await readFile(out, 'utf8')).revision).toBe(first);
  });

  it('повторная компиляция без правок даёт тот же revision, правка — другой', async () => {
    const dir = await tmp.copy(SQL_KB);
    const revision = async () =>
      (
        JSON.parse((await cli('compile', dir, '--json')).stdout) as {
          revision: string;
        }
      ).revision;
    const first = await revision();
    expect(await revision()).toBe(first);
    const question = join(dir, 'sql_kb/select.lesson/q1.front.md');
    await writeFile(
      question,
      `${await readFile(question, 'utf8')}Extra line.\n`,
    );
    expect(await revision()).not.toBe(first);
  });
});

describe('engine-cli: неверные аргументы → код 2', () => {
  const cases: Array<[string, string[]]> = [
    ['нет команды', []],
    ['validate без каталога', ['validate']],
    ['compile без каталога', ['compile']],
    ['неизвестная команда', ['lint', '.']],
    ['неизвестный флаг', ['validate', '.', '--nope']],
    ['--out без значения', ['compile', '.', '--out']],
    ['--out у validate', ['validate', '.', '--out', 'x.json']],
    ['лишний аргумент', ['validate', '.', 'extra']],
  ];
  it.each(cases)('%s', async (_name, argv) => {
    const { code, stdout, stderr } = await cli(...argv);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/usage: engine-cli/);
  });

  it('каталога нет или это файл', async () => {
    const dir = await tmp.make();
    const missing = await cli('validate', join(dir, 'nope'));
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('nope');
    await writeFile(join(dir, 'file.txt'), 'x');
    expect((await cli('validate', join(dir, 'file.txt'))).code).toBe(2);
  });

  it('--help: справка и код 0', async () => {
    const { code, stdout } = await cli('--help');
    expect(code).toBe(0);
    expect(stdout).toMatch(/usage: engine-cli/);
  });
});

describe('engine-cli: процесс (нативный Node снимает типы)', () => {
  const main = (...args: string[]) =>
    run(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', 'src/cli/main.ts', ...args],
      { cwd: ENGINE_DIR },
    );

  it('validate чистой библиотеки: код 0 и сводка в stdout', async () => {
    const dir = await tmp.copy(TRANE_LIBRARIES.embedded);
    const { stdout, stderr } = await main('validate', dir);
    expect(stdout).toMatch(/0 error\(s\), 0 warning\(s\)/);
    expect(stderr).toBe('');
  });

  it('validate дефектной библиотеки: код 1', async () => {
    const dir = await defectiveLibrary();
    const failed = await failure(main('validate', dir));
    expect(failed.code).toBe(1);
    expect(failed.stdout).toContain('E_JSON_PARSE');
  });

  it('без аргументов: код 2 и справка в stderr', async () => {
    const failed = await failure(main());
    expect(failed.code).toBe(2);
    expect(failed.stderr).toMatch(/usage: engine-cli/);
  });
});
