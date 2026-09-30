import path from 'node:path';
import { GenerateError, generateExtension } from '../generate.ts';

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const EXIT_OK = 0;
export const EXIT_PROBLEMS = 1;
export const EXIT_USAGE = 2;

const USAGE = `usage: create-lms-extension <dir> [--id <id>] [--local <repoRoot>]

  <dir>              каталог нового проекта (должен быть пуст или отсутствовать)
  --id <id>          id расширения (по умолчанию — kebab-case имени каталога)
  --local <repoRoot> корень репозитория LMS: @lms/extension-sdk и
                     @lms/extension-tools подключаются как link:<repoRoot>/packages/...
  --help             эта справка
`;

type Parsed =
  | { help: true }
  | { usageError: string }
  | { dir: string; id: string | undefined; local: string | undefined };

const parseArgs = (argv: readonly string[]): Parsed => {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const positional: string[] = [];
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--id' || arg === '--local') {
      const value = argv[++i];
      if (value === undefined) return { usageError: `${arg} требует значение` };
      values.set(arg, value);
    } else if (arg.startsWith('-')) {
      return { usageError: `неизвестный флаг: ${arg}` };
    } else positional.push(arg);
  }
  const [dir, ...extra] = positional;
  if (dir === undefined) return { usageError: 'не указан каталог' };
  if (extra.length > 0) {
    return { usageError: `лишние аргументы: ${extra.join(' ')}` };
  }
  return { dir, id: values.get('--id'), local: values.get('--local') };
};

const nextSteps = (dir: string, id: string, isLocal: boolean): string => {
  const steps = [
    `  cd ${dir}`,
    '  pnpm install',
    '  pnpm test',
    `  pnpm dev    # пересборка в dist-ext/${id}`,
    '',
    'Запуск приложения с вашим расширением (из репозитория LMS):',
    `  LMS_DEV_EXTENSIONS=${path.join(dir, 'dist-ext')} pnpm dev`,
  ];
  const note = isLocal
    ? ''
    : '\nЗамечание: @lms/extension-sdk и @lms/extension-tools не опубликованы, ' +
      'версия ^0.0.0 не установится.\nУкажите пути к репозиторию LMS: ' +
      'create-lms-extension <dir> --local <repoRoot>.\n';
  return `\nДальше:\n${steps.join('\n')}\n${note}`;
};

/**
 * `create-lms-extension`; `argv` без `node` и имени скрипта, относительные пути
 * считаются от `cwd`.
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
      ...(parsed.local === undefined
        ? {}
        : { localRoot: path.resolve(cwd, parsed.local) }),
    });
    io.stdout(
      `created ${result.id} in ${result.dir} (${result.files.length} files)\n`,
    );
    io.stdout(nextSteps(result.dir, result.id, result.isLocal));
    return EXIT_OK;
  } catch (error) {
    if (!(error instanceof GenerateError)) throw error;
    io.stderr(`error: ${error.message}\n`);
    return error.code === 'target-not-empty' ? EXIT_PROBLEMS : EXIT_USAGE;
  }
};
