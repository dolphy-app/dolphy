/**
 * Загрузка драйверов и проба возможностей. Возможности определяются
 * пробой (`typeof db.setAuthorizer`, `db.limits`), а не номером версии Node
 * (engine-ts-testing.md: `skip` только через capability-пробу).
 */
import { createRequire } from 'node:module';
import type { Cell, DriverId, DriverPreference, Profile } from './types.ts';

const require = createRequire(import.meta.url);

/** Обратный вызов authorizer: код операции и до четырёх аргументов. */
export type AuthorizerCallback = (
  code: number,
  arg1: string | null,
  arg2: string | null,
  arg3: string | null,
  arg4: string | null,
) => number;

export interface NodeSqliteStatement {
  setReadBigInts(enabled: boolean): void;
  setReturnArrays(enabled: boolean): void;
  columns(): Array<{ name: string }>;
  iterate(): IterableIterator<unknown>;
}

/** Часть `DatabaseSync`, нужная раннеру; `limits`/`setAuthorizer`/`enableDefensive` — Node ≥ 24.x. */
export interface NodeSqliteDb {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
  limits?: Record<string, number>;
  setAuthorizer?(callback: AuthorizerCallback | null): void;
  enableDefensive?(enabled: boolean): void;
}

export interface NodeSqliteModule {
  DatabaseSync: new (path: string, options?: object) => NodeSqliteDb;
  constants: Record<string, number>;
}

export interface BetterStatement {
  reader: boolean;
  safeIntegers(enabled: boolean): unknown;
  raw(enabled: boolean): unknown;
  columns(): Array<{ name: string }>;
  iterate(): IterableIterator<Cell[]>;
}

export interface BetterDb {
  exec(sql: string): unknown;
  prepare(sql: string): BetterStatement;
  serialize(): Buffer;
  close(): void;
}

export type BetterConstructor = new (
  source: string | Buffer,
  options?: { readonly?: boolean },
) => BetterDb;

const loadOptional = <T>(specifier: string): T | null => {
  try {
    return require(specifier) as T;
  } catch {
    return null;
  }
};

let nodeSqliteCache: NodeSqliteModule | null | undefined;
let betterCache: BetterConstructor | null | undefined;

export const loadNodeSqlite = (): NodeSqliteModule | null => {
  if (nodeSqliteCache === undefined) {
    nodeSqliteCache = loadOptional<NodeSqliteModule>('node:sqlite');
  }
  return nodeSqliteCache;
};

export const loadBetterSqlite3 = (): BetterConstructor | null => {
  if (betterCache === undefined) {
    betterCache = loadOptional<BetterConstructor>('better-sqlite3');
  }
  return betterCache;
};

export interface DriverCapabilities {
  nodeSqlite: {
    available: boolean;
    authorizer: boolean;
    limits: boolean;
    defensive: boolean;
  };
  betterSqlite3: boolean;
}

const probeNodeSqlite = (): DriverCapabilities['nodeSqlite'] => {
  const absent = {
    available: false,
    authorizer: false,
    limits: false,
    defensive: false,
  };
  const sqlite = loadNodeSqlite();
  if (sqlite === null) return absent;
  const db = new sqlite.DatabaseSync(':memory:');
  try {
    return {
      available: true,
      authorizer: typeof db.setAuthorizer === 'function',
      limits: typeof db.limits === 'object' && 'length' in db.limits,
      defensive: typeof db.enableDefensive === 'function',
    };
  } finally {
    db.close();
  }
};

let capabilitiesCache: DriverCapabilities | undefined;

export const probeCapabilities = (): DriverCapabilities => {
  capabilitiesCache ??= {
    nodeSqlite: probeNodeSqlite(),
    betterSqlite3: loadBetterSqlite3() !== null,
  };
  return capabilitiesCache;
};

/** `full` — только `node:sqlite` с authorizer и `db.limits`. */
export const profileOf = (
  driver: DriverId,
  capabilities: DriverCapabilities = probeCapabilities(),
): Profile => {
  const { nodeSqlite } = capabilities;
  return driver === 'node-sqlite' && nodeSqlite.authorizer && nodeSqlite.limits
    ? 'full'
    : 'fallback';
};

/**
 * `auto`: `node:sqlite` при authorizer и limits (профиль `full`); иначе
 * better-sqlite3 (запасной профиль); иначе `node:sqlite` без них.
 */
export const resolveDriver = (
  preference: DriverPreference = 'auto',
  capabilities: DriverCapabilities = probeCapabilities(),
): DriverId => {
  const { nodeSqlite, betterSqlite3 } = capabilities;
  if (preference === 'node-sqlite' && !nodeSqlite.available) {
    throw new Error('node:sqlite is not available in this runtime');
  }
  if (preference === 'better-sqlite3' && !betterSqlite3) {
    throw new Error('better-sqlite3 is not installed');
  }
  if (preference !== 'auto') return preference;
  if (profileOf('node-sqlite', capabilities) === 'full') return 'node-sqlite';
  if (betterSqlite3) return 'better-sqlite3';
  if (nodeSqlite.available) return 'node-sqlite';
  throw new Error('no SQLite driver is available');
};
