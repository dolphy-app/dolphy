import path from 'node:path';
import { CatalogUsageError } from '../errors.ts';
import {
  BuildError,
  buildExtension,
  generateTypes,
  validateExtension,
  watchExtension,
} from '../index.ts';
import type { BuildOptions, BuildResult } from '../index.ts';
import {
  CATALOG_HELP,
  CATALOG_SYNOPSIS,
  parseCatalogArgs,
  runCatalog,
} from '../catalog/cli.ts';
import type { CatalogDeps } from '../catalog/cli.ts';
import {
  formatLintFinding,
  lintHasErrors,
  lintProject,
} from '../lint/index.ts';

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface CliDeps extends CatalogDeps {
  /** Resolves when watch mode should end (by default SIGINT/SIGTERM). */
  waitForExit?: () => Promise<void>;
}

export const EXIT_OK = 0;
export const EXIT_PROBLEMS = 1;
export const EXIT_USAGE = 2;

const USAGE = `usage: dolphy-ext build [dir] [--out <dir>] [--watch]
       dolphy-ext types [dir]
       dolphy-ext validate <dir>
       dolphy-ext lint [dir] [--built <dir>]
${CATALOG_SYNOPSIS}
  build [dir]      build the extension from a project (default: the current
                   directory) into <dir>/dist-ext/<id>; also writes
                   <dir>/.dolphy/ids.d.ts
  types [dir]      write <dir>/.dolphy/ids.d.ts: the ids declared in
                   extension.json as types for the SDK (no code is run)
  validate <dir>   check the directory of a built extension (extension.json,
                   schemas, main and renderer)
  lint [dir]       check the project before a pull request to the catalog:
                   manifest metadata, README.md and the built code (eval,
                   obfuscation, URLs without the network permission, source
                   maps); lines «error|warning <id> <RULE-ID> <field>:
                   <message>», exit code 1 only if README.md is missing
${CATALOG_HELP}
  --built <dir>    lint: check this built extension instead of building the
                   project into a temporary directory
  --out <dir>      output root (the extension goes to <dir>/<id>)
  --watch          rebuild the bundles when the sources change
  --help           this help
`;

type Parsed =
  | { help: true }
  | { usageError: string }
  | { command: 'build'; dir: string; out: string | undefined; watch: boolean }
  | { command: 'types'; dir: string }
  | { command: 'validate'; dir: string }
  | { command: 'lint'; dir: string; built: string | undefined }
  | { command: 'catalog'; args: readonly string[] };

const parseBuild = (args: readonly string[]): Parsed => {
  const positional: string[] = [];
  let out: string | undefined;
  let watch = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === '--watch') watch = true;
    else if (arg === '--out') {
      out = args[++i];
      if (out === undefined) return { usageError: '--out needs a path' };
    } else if (arg.startsWith('-')) {
      return { usageError: `unknown flag: ${arg}` };
    } else positional.push(arg);
  }
  if (positional.length > 1) {
    return { usageError: `extra arguments: ${positional.slice(1).join(' ')}` };
  }
  return { command: 'build', dir: positional[0] ?? '.', out, watch };
};

const parseTypes = (args: readonly string[]): Parsed => {
  const flag = args.find((arg) => arg.startsWith('-'));
  if (flag !== undefined) return { usageError: `unknown flag: ${flag}` };
  if (args.length > 1) {
    return { usageError: `extra arguments: ${args.slice(1).join(' ')}` };
  }
  return { command: 'types', dir: args[0] ?? '.' };
};

const parseValidate = (args: readonly string[]): Parsed => {
  const flag = args.find((arg) => arg.startsWith('-'));
  if (flag !== undefined) return { usageError: `unknown flag: ${flag}` };
  const [dir, ...extra] = args;
  if (dir === undefined) return { usageError: 'validate: no directory given' };
  if (extra.length > 0) {
    return { usageError: `extra arguments: ${extra.join(' ')}` };
  }
  return { command: 'validate', dir };
};

const parseLint = (args: readonly string[]): Parsed => {
  const positional: string[] = [];
  let built: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === '--built') {
      built = args[++i];
      if (built === undefined) return { usageError: '--built needs a path' };
    } else if (arg.startsWith('-')) {
      return { usageError: `unknown flag: ${arg}` };
    } else positional.push(arg);
  }
  if (positional.length > 1) {
    return { usageError: `extra arguments: ${positional.slice(1).join(' ')}` };
  }
  return { command: 'lint', dir: positional[0] ?? '.', built };
};

const parseArgs = (argv: readonly string[]): Parsed => {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const [command, ...rest] = argv;
  if (command === 'build') return parseBuild(rest);
  if (command === 'types') return parseTypes(rest);
  if (command === 'validate') return parseValidate(rest);
  if (command === 'lint') return parseLint(rest);
  if (command === 'catalog') return { command: 'catalog', args: rest };
  return {
    usageError:
      command === undefined
        ? 'no command given'
        : `unknown command: ${command}`,
  };
};

const waitForSignal = (): Promise<void> =>
  new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });

const summary = ({ id, dir, files }: BuildResult): string =>
  `built ${id} -> ${dir} (${files.length} files)\n`;

const reportBuildError = (io: CliIo, error: unknown): number => {
  if (!(error instanceof BuildError)) throw error;
  io.stderr(`error ${error.subject}: ${error.message}\n`);
  return EXIT_PROBLEMS;
};

const runBuild = async (
  parsed: Extract<Parsed, { command: 'build' }>,
  io: CliIo,
  deps: CliDeps,
): Promise<number> => {
  const options: BuildOptions = {
    root: path.resolve(parsed.dir),
    ...(parsed.out === undefined ? {} : { outDir: path.resolve(parsed.out) }),
    logger: {
      info: (message) => io.stdout(`${message}\n`),
      error: (message) => io.stderr(`${message}\n`),
    },
  };
  try {
    if (!parsed.watch) {
      io.stdout(summary(await buildExtension(options)));
      return EXIT_OK;
    }
    const handle = await watchExtension(options);
    io.stdout(summary(handle.result));
    io.stdout('watching for changes...\n');
    try {
      await (deps.waitForExit ?? waitForSignal)();
    } finally {
      await handle.close();
    }
    return EXIT_OK;
  } catch (error) {
    return reportBuildError(io, error);
  }
};

const runValidate = async (dir: string, io: CliIo): Promise<number> => {
  const root = path.resolve(dir);
  const { ok, problems } = await validateExtension(root);
  if (ok) {
    io.stdout(`${root}: ok\n`);
    return EXIT_OK;
  }
  for (const problem of problems) io.stderr(`error ${root}: ${problem}\n`);
  return EXIT_PROBLEMS;
};

const runLint = async (
  parsed: Extract<Parsed, { command: 'lint' }>,
  io: CliIo,
): Promise<number> => {
  try {
    const findings = await lintProject({
      root: parsed.dir,
      ...(parsed.built === undefined ? {} : { built: parsed.built }),
    });
    for (const finding of findings) {
      io.stdout(`${formatLintFinding(finding)}\n`);
    }
    return lintHasErrors(findings) ? EXIT_PROBLEMS : EXIT_OK;
  } catch (error) {
    if (error instanceof CatalogUsageError) {
      io.stderr(`error ${error.subject}: ${error.message}\n`);
      return EXIT_USAGE;
    }
    return reportBuildError(io, error);
  }
};

const runTypes = async (dir: string, io: CliIo): Promise<number> => {
  try {
    const root = path.resolve(dir);
    const { file, changed } = await generateTypes({ root });
    const shown = path.relative(root, file);
    io.stdout(changed ? `wrote ${shown}\n` : `${shown} is up to date\n`);
    return EXIT_OK;
  } catch (error) {
    return reportBuildError(io, error);
  }
};

/** `dolphy-ext build|types|validate|lint|catalog`; `argv` is without `node` and the script name. */
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
  if (parsed.command === 'catalog') {
    const catalog = parseCatalogArgs(parsed.args);
    if ('usageError' in catalog) {
      io.stderr(`${catalog.usageError}\n${USAGE}`);
      return EXIT_USAGE;
    }
    return runCatalog(catalog, io, deps);
  }
  if (parsed.command === 'validate') return runValidate(parsed.dir, io);
  if (parsed.command === 'lint') return runLint(parsed, io);
  if (parsed.command === 'types') return runTypes(parsed.dir, io);
  return runBuild(parsed, io, deps);
};
