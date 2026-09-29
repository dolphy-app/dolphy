import { basename, relative, resolve } from 'node:path';
import type { Diagnostic } from '@lms/engine-contract';
import { encodeArtifact } from '../authoring/artifact.ts';
import { compile } from '../authoring/compile.ts';
import type { CompileResult } from '../authoring/compile.ts';
import type { Logger } from '../ports/index.ts';
import { writeTextAtomic } from '../node/atomic-write.ts';
import { createNodeFsCourseSource } from '../node/fs-course-source.ts';
import {
  loadSqlRunnerVerifiers,
  VerifiersUnavailableError,
} from './sql-runner.ts';
import type { CliVerifiers, CreateVerifiers } from './sql-runner.ts';

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const EXIT_OK = 0;
export const EXIT_LIBRARY_ERRORS = 1;
export const EXIT_USAGE = 2;

const COMMANDS = ['validate', 'compile'] as const;
type Command = (typeof COMMANDS)[number];

const USAGE = `usage: engine-cli validate|compile <dir> [--json] [--verbose] [--run-checks] [--out <file>]

  validate <dir>   проверить библиотеку курсов (код выхода 1 при ошибках)
  compile <dir>    проверить и записать артефакт (<dir>/.engine/compiled.json)

  --json           машиночитаемый вывод
  --verbose        показывать info-диагностики
  --run-checks     прогнать эталонные решения (engine.verification.reference)
                   через раннер; провал — E_REFERENCE_FAILS
  --out <file>     куда записать артефакт (только compile)
`;

interface ParsedArgs {
  command: Command;
  dir: string;
  json: boolean;
  verbose: boolean;
  out: string | undefined;
  runChecks: boolean;
}

/** Внедряемые зависимости CLI: тесты подставляют раннер, по умолчанию — `@lms/engine-sql-runner`. */
export interface CliDeps {
  createVerifiers?: CreateVerifiers;
}

/** Предупреждения и ошибки раннера — в stderr одной JSON-строкой. */
const createStderrLogger = (io: CliIo): Logger => {
  const write = (level: string) => (fields: object, message?: string) => {
    const line = JSON.stringify({ level, ...fields, message }, (_key, value) =>
      value instanceof Error ? value.message : value,
    );
    io.stderr(`${line}\n`);
  };
  const ignore = () => {};
  return {
    debug: ignore,
    info: ignore,
    warn: write('warn'),
    error: write('error'),
  };
};

type ParseOutcome = ParsedArgs | { help: true } | { usageError: string };

const isCommand = (value: string | undefined): value is Command =>
  COMMANDS.some((command) => command === value);

const parseArgs = (argv: readonly string[]): ParseOutcome => {
  const positional: string[] = [];
  let json = false;
  let verbose = false;
  let out: string | undefined;
  let runChecks = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--json') json = true;
    else if (arg === '--verbose') verbose = true;
    else if (arg === '--run-checks') runChecks = true;
    else if (arg === '--out') {
      out = argv[++i];
      if (out === undefined)
        return { usageError: '--out требует путь к файлу' };
    } else if (arg.startsWith('-') && arg !== '-') {
      return { usageError: `неизвестный флаг: ${arg}` };
    } else positional.push(arg);
  }
  const [command, dir, ...extra] = positional;
  if (!isCommand(command)) {
    return {
      usageError:
        command === undefined
          ? 'не указана команда'
          : `неизвестная команда: ${command}`,
    };
  }
  if (dir === undefined) return { usageError: `${command}: не указан каталог` };
  if (extra.length > 0) {
    return { usageError: `лишние аргументы: ${extra.join(' ')}` };
  }
  if (out !== undefined && command !== 'compile') {
    return { usageError: '--out поддерживается только командой compile' };
  }
  return { command, dir, json, verbose, out, runChecks };
};

const location = ({ path, line }: Diagnostic) => {
  if (path === undefined) return '-';
  return line === undefined ? path : `${path}:${line}`;
};

const formatDiagnostic = (d: Diagnostic) =>
  `${d.severity.padEnd(7)} ${d.code.padEnd(26)} ${(d.unitId ?? '-').padEnd(28)} ${location(d)}  ${d.message}\n`;

/**
 * `engine-cli validate|compile <dir>`; `argv` без `node` и имени скрипта.
 * Код выхода: 0 — ошибок нет, 1 — в библиотеке есть `error`, 2 — неверные
 * аргументы или недоступен раннер для `--run-checks`.
 */
export const runCli = async (
  argv: readonly string[],
  io: CliIo,
  deps: CliDeps = {},
): Promise<number> => {
  const parsed = parseArgs(argv);
  if ('help' in parsed) {
    io.stdout(USAGE);
    return EXIT_OK;
  }
  if ('usageError' in parsed) {
    io.stderr(`${parsed.usageError}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const { command, json, verbose, out, runChecks } = parsed;
  const root = resolve(parsed.dir);
  const source = createNodeFsCourseSource(root);
  const rootStat = await source.stat('');
  if (rootStat?.kind !== 'directory') {
    io.stderr(`${command}: не каталог: ${root}\n`);
    return EXIT_USAGE;
  }

  // артефакт внутри библиотеки не должен попадать в её revision
  const excludeFromRevision: string[] = [];
  if (out !== undefined) {
    const rel = relative(root, resolve(out));
    if (!rel.startsWith('..')) excludeFromRevision.push(rel);
  }
  let verifiers: CliVerifiers | null = null;
  if (runChecks) {
    try {
      verifiers = await (deps.createVerifiers ?? loadSqlRunnerVerifiers)(
        source,
        createStderrLogger(io),
      );
    } catch (error) {
      if (!(error instanceof VerifiersUnavailableError)) throw error;
      io.stderr(`${error.message}\n`);
      return EXIT_USAGE;
    }
  }
  const started = performance.now();
  let result: CompileResult;
  try {
    result = await compile(source, {
      excludeFromRevision,
      ...(verifiers === null
        ? {}
        : { runChecks: { verifiers: verifiers.verifiers } }),
    });
  } finally {
    // пул раннера держит дочерние процессы: без close() CLI не завершится
    await verifiers?.close();
  }
  const elapsedMs = performance.now() - started;
  const { summary, artifact, referenceChecks } = result;

  const shown = verbose
    ? result.diagnostics
    : result.diagnostics.filter((d) => d.severity !== 'info');
  if (json) {
    const revision = artifact?.revision ?? null;
    const report = {
      root,
      summary,
      diagnostics: shown,
      revision,
      ...(referenceChecks === undefined ? {} : { referenceChecks }),
    };
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const d of shown) io.stdout(formatDiagnostic(d));
    if (referenceChecks !== undefined) {
      const { checked, skipped, failed } = referenceChecks;
      io.stdout(
        `reference solutions: ${checked} checked, ${failed} failed, ${skipped} skipped (no reference)\n`,
      );
    }
    io.stdout(
      `${basename(root)}: ${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.infos} info; ${elapsedMs.toFixed(0)} ms\n`,
    );
  }

  if (command === 'compile' && summary.errors === 0 && artifact !== null) {
    const text = encodeArtifact(artifact);
    let target: string;
    if (out === undefined) {
      await source.writeArtifact(text);
      target = resolve(root, '.engine/compiled.json');
    } else {
      target = resolve(out);
      await writeTextAtomic(target, text);
    }
    if (!json) {
      io.stdout(
        `wrote ${target} (${Buffer.byteLength(text)} bytes, revision ${artifact.revision.slice(0, 12)})\n`,
      );
    }
  }
  return summary.errors > 0 ? EXIT_LIBRARY_ERRORS : EXIT_OK;
};
