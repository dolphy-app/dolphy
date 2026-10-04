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

export const CATALOG_HELP = `  catalog check    check the catalog's extension sources; lines
                   «error|warning <id> <RULE-ID> <field>: <message>»,
                   exit code 1 if any error
  catalog build    build versions into <siteDir>/extensions/<id>/<version>/ and
                   update <siteDir>/index.json (published versions are
                   immutable)
  catalog build --reindex
                   only replace revoked and generatedAt in the existing
                   <siteDir>/index.json (--src and --ids are not needed)

  --ids a,b              only these extensions (check: all by default)
  --published-index <p>  index.json of the published catalog (no file —
                         nothing is published)
  --max-app-version <v>  minAppVersion must not be newer
  --skip-github-check    do not verify the author via api.github.com
                         (token — the GITHUB_TOKEN variable)
  --list-rules           print the check rules
  --src <dir>            directory of projects <dir>/<id>
  --out <dir>            site root
  --previous-index <p>   source index (default <out>/index.json)
  --revoked <p>          JSON array {id, versions, reason}
  --source-base <url>    base for the index entry's source field
  --published-at <iso>   publishedAt of new versions (default now);
                         with --reindex — generatedAt
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
      if (value === undefined) return `${arg} requires a value`;
      flags[arg] = value;
    } else if (arg.startsWith('-')) return `unknown flag: ${arg}`;
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
    return { usageError: '--max-app-version: expected semver x.y.z' };
  }
  const listRulesFlag = flags['--list-rules'] === true;
  if (positional.length > 1) {
    return { usageError: `extra arguments: ${positional.slice(1).join(' ')}` };
  }
  if (positional[0] === undefined && !listRulesFlag) {
    return { usageError: 'catalog check: no extensions directory given' };
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
    return {
      usageError: `catalog build --reindex: ${forbidden} is not needed`,
    };
  }
  const out = text(flags, '--out');
  if (out === undefined)
    return { usageError: 'catalog build: --out is required' };
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
    return { usageError: `extra arguments: ${positional.join(' ')}` };
  }
  if (flags['--reindex'] === true) return parseReindex(flags);
  const src = text(flags, '--src');
  const out = text(flags, '--out');
  const ids = idsOf(flags);
  if (src === undefined)
    return { usageError: 'catalog build: --src is required' };
  if (out === undefined)
    return { usageError: 'catalog build: --out is required' };
  if (ids === undefined || ids.length === 0) {
    return { usageError: 'catalog build: --ids is required' };
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
        ? 'catalog: no subcommand given (check|build)'
        : `catalog: unknown subcommand: ${sub}`,
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

/** Exit code: 0, 1 (problems), 2 (arguments/environment). */
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
