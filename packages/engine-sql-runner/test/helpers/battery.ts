/**
 * Батарея угроз (30 случаев, спайк sql-runner `battery.ts`): каждый случай
 * исполняется в песочнице в заданном профиле; исход — `B` (заблокировано),
 * `A` (выполнено, вреда не наблюдено), `X` (эффект: запись в БД, файл на
 * диске, чтение чужого файла или скрытой таблицы).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadBetterSqlite3, loadNodeSqlite } from '../../src/drivers.ts';
import { prefilter } from '../../src/prefilter.ts';
import { openSandbox } from '../../src/sandbox.ts';
import type { DriverId, HardeningOptions } from '../../src/types.ts';
import { MAX_SQL_CHARS, FULL_HARDENING } from '../../src/types.ts';

export type Outcome = 'B' | 'A' | 'X';

const FIXTURE = `
create table t(id integer primary key, v text);
insert into t values (1,'a'),(2,'b'),(3,'c');
create table _hidden_answers(q text, a text);
insert into _hidden_answers values ('q1','SECRET');
`;

const HIDDEN = ['_hidden_answers'];

export const PROFILES = {
  /** Все механизмы и префильтр (рабочая конфигурация раннера). */
  full: { ...FULL_HARDENING, hiddenTables: HIDDEN },
  /** Те же механизмы без префильтра: что держит драйвер сам. */
  noPrefilter: { ...FULL_HARDENING, prefilter: false, hiddenTables: HIDDEN },
} as const satisfies Record<string, HardeningOptions>;

export type ProfileName = keyof typeof PROFILES;

interface Probe {
  scalar(sql: string): unknown;
}

interface Threat {
  id: string;
  /** Операторы по порядку в одной песочнице; отказ прерывает последовательность. */
  steps: (dir: string) => string[];
  /** Непустая строка — наблюдён эффект (проверяется после шагов). */
  effect?: (probe: Probe, dir: string) => string | null;
}

const rowCountChanged = (probe: Probe) =>
  probe.scalar('SELECT count(*) FROM t') !== 3 ? 'row count changed' : null;
const tableExists = (name: string) => (probe: Probe) =>
  probe.scalar(`SELECT count(*) FROM sqlite_master WHERE name='${name}'`)
    ? `table ${name} exists`
    : null;
const fileExists = (name: string) => (_probe: Probe, dir: string) =>
  existsSync(join(dir, name)) ? `file ${name} exists` : null;

export const THREATS: readonly Threat[] = [
  {
    id: 'attach-passwd',
    steps: () => [
      "ATTACH DATABASE '/etc/passwd' AS p",
      'SELECT count(*) FROM p.sqlite_master',
    ],
  },
  { id: 'attach-mem', steps: () => ["ATTACH DATABASE ':memory:' AS m"] },
  {
    id: 'attach-read-other-db',
    steps: (dir) => [
      `ATTACH DATABASE '${dir}/secret.db' AS s`,
      'SELECT v FROM s.secret',
    ],
  },
  {
    id: 'attach-create-file',
    steps: (dir) => [
      `ATTACH DATABASE '${dir}/created.db' AS c`,
      'CREATE TABLE c.x(a)',
    ],
    effect: fileExists('created.db'),
  },
  {
    id: 'load_extension',
    steps: () => ["SELECT load_extension('/tmp/x.dylib')"],
  },
  {
    id: 'writable_schema',
    steps: () => [
      'PRAGMA writable_schema=1',
      "UPDATE sqlite_master SET name='zz' WHERE name='t'",
    ],
    effect: tableExists('zz'),
  },
  {
    id: 'vacuum-into',
    steps: (dir) => [`VACUUM INTO '${dir}/vac.db'`],
    effect: fileExists('vac.db'),
  },
  {
    id: 'create-table',
    steps: () => ['CREATE TABLE evil(a)'],
    effect: tableExists('evil'),
  },
  {
    id: 'create-temp-table',
    steps: () => ['CREATE TEMP TABLE tt AS SELECT * FROM t'],
    effect: (probe) =>
      probe.scalar("SELECT count(*) FROM sqlite_temp_master WHERE name='tt'")
        ? 'temp table created'
        : null,
  },
  {
    id: 'drop-table',
    steps: () => ['DROP TABLE t'],
    effect: (probe) =>
      probe.scalar("SELECT count(*) FROM sqlite_master WHERE name='t'") === 0
        ? 'table t dropped'
        : null,
  },
  {
    id: 'insert',
    steps: () => ["INSERT INTO t VALUES (9,'z')"],
    effect: rowCountChanged,
  },
  {
    id: 'update',
    steps: () => ["UPDATE t SET v='q'"],
    effect: (probe) =>
      probe.scalar("SELECT count(*) FROM t WHERE v='q'")
        ? 'rows updated'
        : null,
  },
  { id: 'delete', steps: () => ['DELETE FROM t'], effect: rowCountChanged },
  {
    id: 'with-delete',
    steps: () => ['WITH c AS (SELECT 1) DELETE FROM t'],
    effect: rowCountChanged,
  },
  {
    id: 'multi-stmt',
    steps: () => ['SELECT 1; DROP TABLE t'],
    effect: (probe) =>
      probe.scalar("SELECT count(*) FROM sqlite_master WHERE name='t'") === 0
        ? 'table t dropped'
        : null,
  },
  {
    id: 'pragma-query_only-off',
    steps: () => ['PRAGMA query_only=OFF', "INSERT INTO t VALUES (9,'z')"],
    effect: rowCountChanged,
  },
  {
    id: 'pragma-fn-side-effect',
    steps: () => [
      'SELECT * FROM pragma_query_only(0)',
      "INSERT INTO t VALUES (9,'z')",
    ],
    effect: rowCountChanged,
  },
  { id: 'pragma-database_list', steps: () => ['PRAGMA database_list'] },
  {
    id: 'pragma-fn-database_list',
    steps: () => ['SELECT * FROM pragma_database_list'],
  },
  {
    id: 'pragma-compile_options',
    steps: () => ['SELECT count(*) FROM pragma_compile_options'],
  },
  { id: 'readfile', steps: () => ["SELECT readfile('/etc/passwd')"] },
  {
    id: 'writefile',
    steps: (dir) => [`SELECT writefile('${dir}/w.txt','x')`],
    effect: fileExists('w.txt'),
  },
  {
    id: 'fts3_tokenizer',
    steps: () => ["SELECT fts3_tokenizer('simple')"],
  },
  {
    id: 'fts5-vtab',
    steps: () => ['CREATE VIRTUAL TABLE f USING fts5(a)'],
    effect: tableExists('f'),
  },
  { id: 'dbstat', steps: () => ['SELECT count(*) FROM dbstat'] },
  {
    id: 'hidden-table',
    steps: () => ['SELECT a FROM _hidden_answers'],
  },
  { id: 'sqlite_master', steps: () => ['SELECT name FROM sqlite_master'] },
  {
    id: 'trigger-view',
    steps: () => ['CREATE TEMP VIEW vv AS SELECT * FROM t'],
  },
  { id: 'savepoint', steps: () => ['SAVEPOINT a'] },
  { id: 'reindex-analyze', steps: () => ['ANALYZE'] },
];

/** Внешняя БД с «чужими» данными: ATTACH не должен её прочесть. */
export const createSecretDb = (dir: string): void => {
  const path = join(dir, 'secret.db');
  const script =
    "create table secret(v); insert into secret values ('TOPSECRET')";
  const Better = loadBetterSqlite3();
  if (Better !== null) {
    const db = new Better(path);
    db.exec(script);
    db.close();
    return;
  }
  const sqlite = loadNodeSqlite();
  if (sqlite === null) throw new Error('no driver to create secret.db');
  const db = new sqlite.DatabaseSync(path);
  db.exec(script);
  db.close();
};

interface RawHandle {
  prepare(sql: string): { all(): unknown[] };
  setAuthorizer?(callback: null): void;
}

const runStep = (driver: DriverId, raw: RawHandle, sql: string): string => {
  const statement = raw.prepare(sql) as {
    all(): unknown[];
    run?(): unknown;
    reader?: boolean;
  };
  if (driver === 'better-sqlite3' && statement.reader !== true) {
    statement.run?.();
    return 'ok';
  }
  const rows = statement.all();
  return JSON.stringify(rows, (_key, value: unknown) =>
    typeof value === 'bigint' ? Number(value) : value,
  ).slice(0, 80);
};

/** Исход угрозы: исполняет шаги, затем ищет эффект через тот же хэндл без ограничений. */
export const runThreat = (
  driver: DriverId,
  profile: ProfileName,
  threat: Threat,
  dir: string,
): Outcome => {
  const hardening: HardeningOptions = PROFILES[profile];
  let sandbox;
  try {
    sandbox = openSandbox(driver, FIXTURE, hardening);
  } catch {
    return 'B';
  }
  try {
    const notes: string[] = [];
    let blocked = false;
    for (const step of threat.steps(dir)) {
      if (hardening.prefilter) {
        const outcome = prefilter(step, MAX_SQL_CHARS);
        if (!outcome.ok) {
          blocked = true;
          break;
        }
      }
      try {
        notes.push(runStep(driver, sandbox.raw as RawHandle, step));
      } catch {
        blocked = true;
        break;
      }
    }
    let effect: string | null = null;
    if (threat.effect !== undefined) {
      const raw = sandbox.raw as RawHandle;
      // проверка эффекта не должна упираться в authorizer
      raw.setAuthorizer?.(null);
      const probe: Probe = {
        scalar: (sql) => {
          const row = raw.prepare(sql).all()[0] as
            Record<string, unknown> | undefined;
          const value = row === undefined ? null : Object.values(row)[0];
          return typeof value === 'bigint' ? Number(value) : value;
        },
      };
      effect = threat.effect(probe, dir);
    }
    if (effect !== null || notes.join(' ').includes('SECRET')) return 'X';
    if (blocked) return 'B';
    return 'A';
  } finally {
    sandbox.close();
  }
};
