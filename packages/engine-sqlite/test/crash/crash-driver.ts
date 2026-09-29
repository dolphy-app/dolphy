// Драйвер SIGKILL-теста (T-30). Одна БД переиспользуется во всех итерациях
// (WAL копится); проверка идёт на копии db + wal без -shm, чтобы драйвер не
// чекпойнтил и не удалял WAL настоящей БД.
//   node --experimental-strip-types crash-driver.ts <NORMAL|FULL> [iterations=300] [seed=1] [bigIterations=10] [bigRows=200000]
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

export type SyncMode = 'NORMAL' | 'FULL';
type ChildMode = 'default' | 'manual' | 'big';

const CHILD = join(import.meta.dirname, 'crash-child.ts');

const mulberry32 = (start: number) => {
  let state = start >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface ChildOutcome {
  lastAck: number;
  ackCount: number;
  /** BEGIN без парного ACK: убит внутри или сразу после транзакции. */
  inflight: { first: number; size: number } | null;
  bigDoneMs: number | null;
  exitSignal: NodeJS.Signals | null;
  exitCode: number | null;
  stderr: string;
}

export interface KillOptions {
  dbPath: string;
  sync: SyncMode;
  deviceId: string;
  seed: number;
  mode: ChildMode;
  bigRows?: number;
  /** Задержка до SIGKILL от первого BEGIN (в big — от BIGSTART); null — не убивать. */
  killAfterMs: number | null;
}

export const runChild = (options: KillOptions): Promise<ChildOutcome> =>
  new Promise((resolve, reject) => {
    const args = [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      CHILD,
      options.dbPath,
      options.sync,
      options.deviceId,
      String(options.seed),
      options.mode,
    ];
    if (options.bigRows !== undefined) args.push(String(options.bigRows));
    const child = spawn(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const outcome: ChildOutcome = {
      lastAck: 0,
      ackCount: 0,
      inflight: null,
      bigDoneMs: null,
      exitSignal: null,
      exitCode: null,
      stderr: '',
    };
    let buffer = '';
    let armed = false;
    let timer: NodeJS.Timeout | undefined;
    const arm = () => {
      if (options.killAfterMs === null || armed) return;
      armed = true;
      timer = setTimeout(() => child.kill('SIGKILL'), options.killAfterMs);
    };
    const watchdog = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const [tag, first, second] = buffer.slice(0, newline).split(' ');
        buffer = buffer.slice(newline + 1);
        if (tag === 'BEGIN') {
          outcome.inflight = { first: Number(first), size: Number(second) };
          if (options.mode !== 'big') arm();
        } else if (tag === 'ACK') {
          outcome.lastAck = Number(first);
          outcome.ackCount++;
          outcome.inflight = null;
        } else if (tag === 'BIGSTART') {
          arm();
        } else if (tag === 'BIGDONE') {
          outcome.bigDoneMs = Number(first);
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      outcome.stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(watchdog);
      outcome.exitCode = code;
      outcome.exitSignal = signal;
      resolve(outcome);
    });
  });

export interface Verdict {
  integrityMessage: string;
  foreignKeyViolations: number;
  partialBatches: number;
  duplicateIds: number;
  seqGapDevices: number;
  seqOrderViolations: number;
  ackMissing: boolean;
  totalRows: number;
}

/** Проверка файла БД свежим соединением; `acked` — наибольший ACK по устройствам. */
export const verifyDb = (
  path: string,
  acked: ReadonlyMap<string, number>,
): Verdict => {
  const db = new Database(path);
  try {
    const integrity = db.pragma('integrity_check') as {
      integrity_check: string;
    }[];
    const foreignKeys = db.pragma('foreign_key_check') as unknown[];
    const one = (sql: string) =>
      db.prepare<[], { n: number }>(sql).get()?.n ?? 0;
    const maxSeq = db.prepare<[string], { top: number | null }>(
      'SELECT max(seq) AS top FROM log_entry WHERE device_id = ?',
    );
    let ackMissing = false;
    for (const [device, seq] of acked) {
      if ((maxSeq.get(device)?.top ?? 0) < seq) ackMissing = true;
    }
    return {
      integrityMessage: integrity.map((row) => row.integrity_check).join('; '),
      foreignKeyViolations: foreignKeys.length,
      partialBatches: one(
        `SELECT count(*) AS n FROM (SELECT unit_id, count(*) AS c FROM log_entry
           GROUP BY unit_id
           HAVING c != CAST(substr(unit_id, instr(unit_id, '~') + 1) AS INTEGER))`,
      ),
      duplicateIds: one(
        'SELECT count(*) - count(DISTINCT id) AS n FROM log_entry',
      ),
      seqGapDevices: one(
        `SELECT count(*) AS n FROM (SELECT device_id FROM log_entry
           GROUP BY device_id HAVING min(seq) != 1 OR max(seq) != count(*))`,
      ),
      seqOrderViolations: one(
        `SELECT count(*) AS n FROM (
           SELECT seq, lag(seq) OVER (PARTITION BY device_id ORDER BY rowid) AS p
           FROM log_entry)
         WHERE (p IS NULL AND seq != 1) OR (p IS NOT NULL AND seq != p + 1)`,
      ),
      ackMissing,
      totalRows: one('SELECT count(*) AS n FROM log_entry'),
    };
  } finally {
    db.close();
  }
};

export const copyForCheck = (dbPath: string, directory: string): string => {
  const copy = join(directory, 'check.db');
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(copy + suffix, { force: true });
  }
  copyFileSync(dbPath, copy);
  if (existsSync(`${dbPath}-wal`)) copyFileSync(`${dbPath}-wal`, `${copy}-wal`);
  return copy;
};

export const countBatch = (path: string, batch: string): number => {
  const db = new Database(path);
  try {
    const row = db
      .prepare<[string], { n: number }>(
        `SELECT count(*) AS n FROM log_entry WHERE unit_id LIKE ? || '~%'`,
      )
      .get(batch);
    return row?.n ?? 0;
  } finally {
    db.close();
  }
};

export interface CrashSummary {
  sync: SyncMode;
  iterations: number;
  killedBySigkill: number;
  killedInFlight: number;
  inFlightDurable: number;
  inFlightAbsent: number;
  ackedBatches: number;
  totalRows: number;
  /** Все нарушения по итерациям (должно быть 0). */
  violations: string[];
  big: {
    rows: number;
    iterations: number;
    killedMidTransaction: number;
    finishedBeforeKill: number;
    rowsLeftByKilled: number;
    violations: string[];
  };
  elapsedSec: number;
}

export interface CampaignOptions {
  sync: SyncMode;
  iterations: number;
  seed: number;
  bigIterations: number;
  bigRows: number;
  log?: (message: string) => void;
}

export const runCrashCampaign = async ({
  sync,
  iterations,
  seed,
  bigIterations,
  bigRows,
  log = () => {},
}: CampaignOptions): Promise<CrashSummary> => {
  const started = performance.now();
  const dir = mkdtempSync(join(tmpdir(), `crash-${sync}-`));
  const random = mulberry32(seed);
  const dbPath = join(dir, 'main.db');
  const checkDir = join(dir, 'chk');
  mkdirSync(checkDir);
  const acked = new Map<string, number>();
  const summary: CrashSummary = {
    sync,
    iterations,
    killedBySigkill: 0,
    killedInFlight: 0,
    inFlightDurable: 0,
    inFlightAbsent: 0,
    ackedBatches: 0,
    totalRows: 0,
    violations: [],
    big: {
      rows: bigRows,
      iterations: bigIterations,
      killedMidTransaction: 0,
      finishedBeforeKill: 0,
      rowsLeftByKilled: 0,
      violations: [],
    },
    elapsedSec: 0,
  };

  const check = (verdict: Verdict, label: string, into: string[]) => {
    if (verdict.integrityMessage !== 'ok') {
      into.push(
        `${label}: integrity ${verdict.integrityMessage.slice(0, 200)}`,
      );
    }
    if (verdict.foreignKeyViolations > 0) into.push(`${label}: foreign keys`);
    if (verdict.partialBatches > 0) into.push(`${label}: partial batch`);
    if (verdict.duplicateIds > 0) into.push(`${label}: duplicate ids`);
    if (verdict.seqGapDevices > 0) into.push(`${label}: seq gap`);
    if (verdict.seqOrderViolations > 0) into.push(`${label}: seq order`);
    if (verdict.ackMissing) into.push(`${label}: ACKed batch lost`);
  };

  try {
    for (let index = 0; index < iterations; index++) {
      const deviceId = `dev${index % 3}`;
      const mode: ChildMode = index % 5 === 4 ? 'manual' : 'default';
      const delay = 20 + Math.floor(random() * 381);
      const outcome = await runChild({
        dbPath,
        sync,
        deviceId,
        seed: seed * 100_000 + index,
        mode,
        killAfterMs: delay,
      });
      if (outcome.exitSignal === 'SIGKILL') summary.killedBySigkill++;
      else {
        summary.violations.push(
          `iteration ${index}: child exit ${outcome.exitCode} ${outcome.stderr.slice(0, 300)}`,
        );
      }
      if (outcome.stderr !== '' && outcome.exitSignal === 'SIGKILL') {
        summary.violations.push(`iteration ${index}: stderr ${outcome.stderr}`);
      }
      summary.ackedBatches += outcome.ackCount;
      if (outcome.lastAck > (acked.get(deviceId) ?? 0)) {
        acked.set(deviceId, outcome.lastAck);
      }
      const copy = copyForCheck(dbPath, checkDir);
      const verdict = verifyDb(copy, acked);
      if (outcome.inflight !== null) {
        summary.killedInFlight++;
        const db = new Database(copy, { readonly: true });
        const top =
          db
            .prepare<[string], { top: number | null }>(
              'SELECT max(seq) AS top FROM log_entry WHERE device_id = ?',
            )
            .get(deviceId)?.top ?? 0;
        db.close();
        const last = outcome.inflight.first + outcome.inflight.size - 1;
        if (top >= last) summary.inFlightDurable++;
        else summary.inFlightAbsent++;
      }
      summary.totalRows = verdict.totalRows;
      check(verdict, `iteration ${index}`, summary.violations);
      if (index % 50 === 49) log(`${sync}: ${index + 1}/${iterations}`);
    }
    check(verifyDb(dbPath, acked), 'final', summary.violations);

    for (let index = 0; index < bigIterations; index++) {
      const calibrationDb = join(dir, `calibration-${index}.db`);
      const calibration = await runChild({
        dbPath: calibrationDb,
        sync,
        deviceId: 'big',
        seed: 424_242,
        mode: 'big',
        bigRows,
        killAfterMs: null,
      });
      if (countBatch(calibrationDb, 'big-424242') !== bigRows) {
        summary.big.violations.push('calibration run wrote a wrong row count');
      }
      const bigDb = join(dir, `big${index}.db`);
      const bigSeed = 7_000 + index;
      const killAfterMs = (calibration.bigDoneMs ?? 0) * (0.1 + 0.8 * random());
      const outcome = await runChild({
        dbPath: bigDb,
        sync,
        deviceId: 'big',
        seed: bigSeed,
        mode: 'big',
        bigRows,
        killAfterMs,
      });
      const copy = copyForCheck(bigDb, checkDir);
      const rows = countBatch(copy, `big-${bigSeed}`);
      if (outcome.bigDoneMs !== null) {
        summary.big.finishedBeforeKill++;
        if (rows !== bigRows)
          summary.big.violations.push('finished batch is partial');
      } else {
        summary.big.killedMidTransaction++;
        summary.big.rowsLeftByKilled += rows;
        if (rows !== 0)
          summary.big.violations.push(`killed batch left ${rows} rows`);
      }
      check(
        verifyDb(copy, new Map([['big', outcome.lastAck]])),
        `big ${index}`,
        summary.big.violations,
      );
      for (const path of [calibrationDb, bigDb]) {
        for (const suffix of ['', '-wal', '-shm']) {
          rmSync(path + suffix, { force: true });
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  summary.elapsedSec = Math.round(performance.now() - started) / 1000;
  return summary;
};

if (import.meta.filename === process.argv[1]) {
  const [syncArg, iterationsArg, seedArg, bigArg, bigRowsArg] =
    process.argv.slice(2);
  if (syncArg !== 'NORMAL' && syncArg !== 'FULL') {
    console.error(
      'usage: crash-driver.ts <NORMAL|FULL> [iterations=300] [seed=1] [bigIterations=10] [bigRows=200000]',
    );
    process.exit(2);
  }
  const summary = await runCrashCampaign({
    sync: syncArg,
    iterations: Number(iterationsArg ?? 300),
    seed: Number(seedArg ?? 1),
    bigIterations: Number(bigArg ?? 10),
    bigRows: Number(bigRowsArg ?? 200_000),
    log: (message) => console.error(message),
  });
  console.log(JSON.stringify(summary, null, 2));
  process.exit(
    summary.violations.length + summary.big.violations.length === 0 ? 0 : 1,
  );
}
