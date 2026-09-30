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

const USAGE = `usage: create-dolphy-extension <dir> [--id <id>] [--local <repoRoot>]

  <dir>              каталог нового проекта (должен быть пуст или отсутствовать)
  --id <id>          id расширения (по умолчанию — kebab-case имени каталога)
  --local <repoRoot> корень репозитория Dolphy: @dolphy-app/extension-sdk и
                     @dolphy-app/extension-tools подключаются как link:<repoRoot>/packages/...
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

const TOKEN_NOTE =
  '\nПакеты @dolphy-app/* лежат в GitHub Packages: перед установкой добавьте в ' +
  '~/.npmrc\nтокен (classic, право read:packages), см. README проекта, ' +
  '«Установка зависимостей».\n';

const PLACEHOLDER_NOTE =
  '\nЗамечание: @dolphy-app/extension-sdk и @dolphy-app/extension-tools не опубликованы, ' +
  'версия ^0.0.0 не установится.\nУкажите пути к репозиторию Dolphy: ' +
  'create-dolphy-extension <dir> --local <repoRoot>.\n';

const installNote = ({
  isLocal,
  isPublished,
}: Pick<GenerateResult, 'isLocal' | 'isPublished'>): string => {
  if (isLocal) return '';
  return isPublished ? TOKEN_NOTE : PLACEHOLDER_NOTE;
};

const nextSteps = (
  result: Pick<GenerateResult, 'dir' | 'id' | 'isLocal' | 'isPublished'>,
): string => {
  const { dir, id } = result;
  const steps = [
    `  cd ${dir}`,
    '  pnpm install',
    '  pnpm test',
    `  pnpm dev    # пересборка в dist-ext/${id}`,
    '',
    'Запуск приложения с вашим расширением (из репозитория Dolphy):',
    `  DOLPHY_DEV_EXTENSIONS=${path.join(dir, 'dist-ext')} pnpm dev`,
  ];
  return `\nДальше:\n${steps.join('\n')}\n${installNote(result)}`;
};

/**
 * `create-dolphy-extension`; `argv` без `node` и имени скрипта, относительные пути
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
    io.stdout(nextSteps(result));
    return EXIT_OK;
  } catch (error) {
    if (!(error instanceof GenerateError)) throw error;
    io.stderr(`error: ${error.message}\n`);
    return error.code === 'target-not-empty' ? EXIT_PROBLEMS : EXIT_USAGE;
  }
};
