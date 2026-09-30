import path from 'node:path';
import { isSemver } from '@dolphy-app/extension-catalog';
import { BuildError, CatalogUsageError } from '../errors.ts';
import {
  buildCatalog,
  formatPublishResult,
  formatReindexResult,
  reindexCatalog,
} from './build.ts';
import { checkCatalog, formatFinding, hasErrors, listRules } from './check.ts';

export interface CatalogIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface CatalogDeps {
  fetch?: typeof fetch;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
}

export const CATALOG_SYNOPSIS = `       dolphy-ext catalog check <extensionsDir> [--ids a,b]
                   [--published-index <path>] [--max-app-version <x.y.z>]
                   [--skip-github-check] [--list-rules]
       dolphy-ext catalog build --src <extensionsDir> --ids a,b --out <siteDir>
                   [--previous-index <path>] [--revoked <path>]
                   [--source-base <url>] [--published-at <iso>]
       dolphy-ext catalog build --reindex --out <siteDir>
                   [--previous-index <path>] [--revoked <path>]
                   [--published-at <iso>]
`;

export const CATALOG_HELP = `  catalog check    проверить исходники расширений каталога; строки
                   «error|warning <id> <RULE-ID> <поле>: <сообщение>»,
                   код 1 при наличии error
  catalog build    собрать версии в <siteDir>/extensions/<id>/<version>/ и
                   обновить <siteDir>/index.json (опубликованные версии
                   неизменны)
  catalog build --reindex
                   только заменить revoked и generatedAt в существующем
                   <siteDir>/index.json (--src и --ids не нужны)

  --ids a,b              только эти расширения (check: по умолчанию все)
  --published-index <p>  index.json опубликованного каталога (нет файла —
                         ничего не опубликовано)
  --max-app-version <v>  minAppVersion не должен быть новее
  --skip-github-check    не проверять автора через api.github.com
                         (токен — переменная GITHUB_TOKEN)
  --list-rules           вывести правила check
  --src <dir>            каталог с проектами <dir>/<id>
  --out <dir>            корень сайта
  --previous-index <p>   исходный индекс (по умолчанию <out>/index.json)
  --revoked <p>          JSON-массив {id, versions, reason}
  --source-base <url>    основа поля source записи индекса
  --published-at <iso>   publishedAt новых версий (по умолчанию сейчас);
                         с --reindex — generatedAt
`;

type Flags = Record<string, string | true>;

const VALUE_FLAGS = {
  check: ['--ids', '--published-index', '--max-app-version'],
  build: [
    '--src',
    '--ids',
    '--out',
    '--previous-index',
    '--revoked',
    '--source-base',
    '--published-at',
  ],
} as const;
const SWITCHES = {
  check: ['--skip-github-check', '--list-rules'],
  build: ['--reindex'],
} as const;

export type CatalogParsed =
  | { usageError: string }
  | {
      command: 'check';
      dir: string | null;
      ids: string[] | undefined;
      publishedIndex: string | undefined;
      maxAppVersion: string | undefined;
      skipGithubCheck: boolean;
      listRules: boolean;
    }
  | {
      command: 'build';
      src: string;
      ids: string[];
      out: string;
      previousIndex: string | undefined;
      revoked: string | undefined;
      sourceBase: string | undefined;
      publishedAt: string | undefined;
    }
  | {
      command: 'reindex';
      out: string;
      previousIndex: string | undefined;
      revoked: string | undefined;
      publishedAt: string | undefined;
    };

const readFlags = (
  mode: 'check' | 'build',
  args: readonly string[],
): { flags: Flags; positional: string[] } | string => {
  const flags: Flags = {};
  const positional: string[] = [];
  const valued: readonly string[] = VALUE_FLAGS[mode];
  const switches: readonly string[] = SWITCHES[mode];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (switches.includes(arg)) flags[arg] = true;
    else if (valued.includes(arg)) {
      const value = args[++i];
      if (value === undefined) return `${arg} требует значение`;
      flags[arg] = value;
    } else if (arg.startsWith('-')) return `неизвестный флаг: ${arg}`;
    else positional.push(arg);
  }
  return { flags, positional };
};

const text = (flags: Flags, name: string): string | undefined => {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
};

const idsOf = (flags: Flags): string[] | undefined => {
  const value = text(flags, '--ids');
  if (value === undefined) return value;
  return [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
};

const parseCheck = (args: readonly string[]): CatalogParsed => {
  const read = readFlags('check', args);
  if (typeof read === 'string') return { usageError: read };
  const { flags, positional } = read;
  const maxAppVersion = text(flags, '--max-app-version');
  if (maxAppVersion !== undefined && !isSemver(maxAppVersion)) {
    return { usageError: '--max-app-version: нужен semver x.y.z' };
  }
  const listRulesFlag = flags['--list-rules'] === true;
  if (positional.length > 1) {
    return { usageError: `лишние аргументы: ${positional.slice(1).join(' ')}` };
  }
  if (positional[0] === undefined && !listRulesFlag) {
    return { usageError: 'catalog check: не указан каталог расширений' };
  }
  return {
    command: 'check',
    dir: positional[0] ?? null,
    ids: idsOf(flags),
    publishedIndex: text(flags, '--published-index'),
    maxAppVersion,
    skipGithubCheck: flags['--skip-github-check'] === true,
    listRules: listRulesFlag,
  };
};

const REINDEX_FORBIDDEN = ['--src', '--ids', '--source-base'];

const parseReindex = (flags: Flags): CatalogParsed => {
  const forbidden = REINDEX_FORBIDDEN.find((name) => name in flags);
  if (forbidden !== undefined) {
    return { usageError: `catalog build --reindex: ${forbidden} не нужен` };
  }
  const out = text(flags, '--out');
  if (out === undefined) return { usageError: 'catalog build: нужен --out' };
  return {
    command: 'reindex',
    out,
    previousIndex: text(flags, '--previous-index'),
    revoked: text(flags, '--revoked'),
    publishedAt: text(flags, '--published-at'),
  };
};

const parseBuild = (args: readonly string[]): CatalogParsed => {
  const read = readFlags('build', args);
  if (typeof read === 'string') return { usageError: read };
  const { flags, positional } = read;
  if (positional.length > 0) {
    return { usageError: `лишние аргументы: ${positional.join(' ')}` };
  }
  if (flags['--reindex'] === true) return parseReindex(flags);
  const src = text(flags, '--src');
  const out = text(flags, '--out');
  const ids = idsOf(flags);
  if (src === undefined) return { usageError: 'catalog build: нужен --src' };
  if (out === undefined) return { usageError: 'catalog build: нужен --out' };
  if (ids === undefined || ids.length === 0) {
    return { usageError: 'catalog build: нужен --ids' };
  }
  return {
    command: 'build',
    src,
    ids,
    out,
    previousIndex: text(flags, '--previous-index'),
    revoked: text(flags, '--revoked'),
    sourceBase: text(flags, '--source-base'),
    publishedAt: text(flags, '--published-at'),
  };
};

export const parseCatalogArgs = (args: readonly string[]): CatalogParsed => {
  const [sub, ...rest] = args;
  if (sub === 'check') return parseCheck(rest);
  if (sub === 'build') return parseBuild(rest);
  return {
    usageError:
      sub === undefined
        ? 'catalog: не указана подкоманда (check|build)'
        : `catalog: неизвестная подкоманда: ${sub}`,
  };
};

const runCheck = async (
  parsed: Extract<CatalogParsed, { command: 'check' }>,
  io: CatalogIo,
  deps: CatalogDeps,
): Promise<number> => {
  if (parsed.listRules) {
    for (const line of listRules()) io.stdout(`${line}\n`);
    return 0;
  }
  const findings = await checkCatalog({
    extensionsDir: path.resolve(parsed.dir as string),
    ...(parsed.ids === undefined ? {} : { ids: parsed.ids }),
    ...(parsed.publishedIndex === undefined
      ? {}
      : { publishedIndex: path.resolve(parsed.publishedIndex) }),
    ...(parsed.maxAppVersion === undefined
      ? {}
      : { maxAppVersion: parsed.maxAppVersion }),
    skipGithubCheck: parsed.skipGithubCheck,
    githubToken: deps.env?.GITHUB_TOKEN,
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  });
  for (const finding of findings) io.stdout(`${formatFinding(finding)}\n`);
  return hasErrors(findings) ? 1 : 0;
};

const runReindex = async (
  parsed: Extract<CatalogParsed, { command: 'reindex' }>,
  io: CatalogIo,
  deps: CatalogDeps,
): Promise<number> => {
  const result = await reindexCatalog({
    out: parsed.out,
    ...(parsed.previousIndex === undefined
      ? {}
      : { previousIndex: parsed.previousIndex }),
    ...(parsed.revoked === undefined ? {} : { revoked: parsed.revoked }),
    ...(parsed.publishedAt === undefined
      ? {}
      : { publishedAt: parsed.publishedAt }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  io.stdout(`${formatReindexResult(result)}\n`);
  return 0;
};

const runBuild = async (
  parsed: Extract<CatalogParsed, { command: 'build' }>,
  io: CatalogIo,
  deps: CatalogDeps,
): Promise<number> => {
  const results = await buildCatalog({
    src: parsed.src,
    ids: parsed.ids,
    out: parsed.out,
    ...(parsed.previousIndex === undefined
      ? {}
      : { previousIndex: parsed.previousIndex }),
    ...(parsed.revoked === undefined ? {} : { revoked: parsed.revoked }),
    ...(parsed.sourceBase === undefined
      ? {}
      : { sourceBase: parsed.sourceBase }),
    ...(parsed.publishedAt === undefined
      ? {}
      : { publishedAt: parsed.publishedAt }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  for (const result of results) io.stdout(`${formatPublishResult(result)}\n`);
  return 0;
};

/** Код выхода: 0, 1 (проблемы), 2 (аргументы/окружение). */
export const runCatalog = async (
  parsed: Exclude<CatalogParsed, { usageError: string }>,
  io: CatalogIo,
  deps: CatalogDeps = {},
): Promise<number> => {
  try {
    if (parsed.command === 'check') return await runCheck(parsed, io, deps);
    if (parsed.command === 'reindex') return await runReindex(parsed, io, deps);
    return await runBuild(parsed, io, deps);
  } catch (error) {
    if (!(error instanceof BuildError)) throw error;
    io.stderr(`error ${error.subject}: ${error.message}\n`);
    return error instanceof CatalogUsageError ? 2 : 1;
  }
};
