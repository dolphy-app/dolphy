import path from 'node:path';
import { GenerateError, generateExtension } from '../generate.ts';
import type { GenerateResult } from '../generate.ts';

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const EXIT_OK = 0;
export const EXIT_PROBLEMS = 1;
export const EXIT_USAGE = 2;

const USAGE = `usage: create-dolphy-extension <dir> [--id <id>] [--template <name>] [--local <repoRoot>]

  <dir>              new project directory (must be empty or not exist)
  --id <id>          extension id (default: kebab-case of the directory name)
  --template <name>  project kind: exercise (default), theme, command-panel,
                     react-panel, events or blank
  --local <repoRoot> Dolphy repository root: @dolphy-app/extension-sdk and
                     @dolphy-app/extension-tools are linked as link:<repoRoot>/packages/...
  --help             show this help
`;

type Parsed =
  | { help: true }
  | { usageError: string }
  | {
      dir: string;
      id: string | undefined;
      local: string | undefined;
      template: string | undefined;
    };

const parseArgs = (argv: readonly string[]): Parsed => {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const positional: string[] = [];
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--id' || arg === '--local' || arg === '--template') {
      const value = argv[++i];
      if (value === undefined) return { usageError: `${arg} requires a value` };
      values.set(arg, value);
    } else if (arg.startsWith('-')) {
      return { usageError: `unknown flag: ${arg}` };
    } else positional.push(arg);
  }
  const [dir, ...extra] = positional;
  if (dir === undefined) return { usageError: 'no directory given' };
  if (extra.length > 0) {
    return { usageError: `unexpected arguments: ${extra.join(' ')}` };
  }
  return {
    dir,
    id: values.get('--id'),
    local: values.get('--local'),
    template: values.get('--template'),
  };
};

const PLACEHOLDER_NOTE =
  '\nNote: @dolphy-app/extension-sdk and @dolphy-app/extension-tools are not published, ' +
  'version ^0.0.0 cannot be installed.\nPoint to the Dolphy repository: ' +
  'create-dolphy-extension <dir> --local <repoRoot>.\n';

const installNote = ({
  isLocal,
  isPublished,
}: Pick<GenerateResult, 'isLocal' | 'isPublished'>): string => {
  if (isLocal) return '';
  return isPublished ? '' : PLACEHOLDER_NOTE;
};

const nextSteps = (
  result: Pick<GenerateResult, 'dir' | 'id' | 'isLocal' | 'isPublished'>,
): string => {
  const { dir, id } = result;
  const steps = [
    `  cd ${dir}`,
    '  pnpm install',
    '  pnpm test',
    `  pnpm dev    # rebuilds into dist-ext/${id}`,
    '',
    'Run the app with your extension (from the Dolphy repository):',
    `  DOLPHY_DEV_EXTENSIONS=${path.join(dir, 'dist-ext')} pnpm dev`,
  ];
  return `\nNext steps:\n${steps.join('\n')}\n${installNote(result)}`;
};

/**
 * `create-dolphy-extension`; `argv` without `node` and the script name; relative paths
 * are resolved against `cwd`.
 */
export const runCli = async (
  argv: readonly string[],
  io: CliIo,
  cwd: string = process.cwd(),
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
  try {
    const result = await generateExtension({
      dir: path.resolve(cwd, parsed.dir),
      ...(parsed.id === undefined ? {} : { id: parsed.id }),
      ...(parsed.template === undefined ? {} : { template: parsed.template }),
      ...(parsed.local === undefined
        ? {}
        : { localRoot: path.resolve(cwd, parsed.local) }),
    });
    io.stdout(
      `created ${result.id} in ${result.dir} (${result.files.length} files)\n`,
    );
    io.stdout(nextSteps(result));
    return EXIT_OK;
  } catch (error) {
    if (!(error instanceof GenerateError)) throw error;
    io.stderr(`error: ${error.message}\n`);
    return error.code === 'target-not-empty' ? EXIT_PROBLEMS : EXIT_USAGE;
  }
};
