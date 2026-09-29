// Дочерний процесс SIGKILL-теста: пишет батчи в общую БД, пока его не убьют.
// Запуск: node --experimental-strip-types crash-child.ts <db> <NORMAL|FULL> <deviceId> <seed> [default|manual|big] [bigRows]
// Протокол stdout (одна строка — один write(2)):
//   BEGIN <firstSeq> <size>  перед транзакцией батча
//   ACK <lastSeq>            после фиксации (append вернулся)
//   BIGSTART / BIGDONE <ms>  только режим big
// Батч помечен в `exerciseId`: `<batch>~<size>`; частично применённый батч виден по счёту.
import { writeSync } from 'node:fs';
import { createSqliteEventStore } from '../../src/event-store.ts';
import { openBetterSqliteDatabase } from '../../src/sql-database.ts';
import type { LogEntry } from '@lms/engine';

const [dbPath, syncArg, deviceId, seedArg, modeArg, bigRowsArg] =
  process.argv.slice(2);
if (
  dbPath === undefined ||
  (syncArg !== 'NORMAL' && syncArg !== 'FULL') ||
  deviceId === undefined ||
  seedArg === undefined
) {
  console.error(
    'usage: crash-child.ts <db> <NORMAL|FULL> <deviceId> <seed> [default|manual|big] [bigRows]',
  );
  process.exit(2);
}
const mode = modeArg ?? 'default';
const device: string = deviceId;
const seed = Number(seedArg);

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
const random = mulberry32(seed);

const out = (line: string) => {
  const bytes = Buffer.from(`${line}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    try {
      offset += writeSync(1, bytes, offset);
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      if (code !== 'EAGAIN') throw error; // канал полон: драйвер читает, повторяем
    }
  }
};

const db = openBetterSqliteDatabase({ path: dbPath });
if (mode === 'manual') db.pragma('wal_autocheckpoint = 0');
const store = createSqliteEventStore(db, {
  deviceId: 'crash-owner',
  durability: syncArg === 'FULL' ? 'full' : 'normal',
  fullfsync: false,
});

let nextSeq = store.maxSeq(device) + 1;

const makeBatch = (batch: string, size: number): LogEntry[] => {
  const entries: LogEntry[] = [];
  for (let index = 0; index < size; index++) {
    const now = Date.now();
    entries.push({
      kind: 'attempt',
      id: `${batch}-${index}`,
      deviceId: device,
      seq: nextSeq++,
      at: now,
      recordedAt: now,
      exerciseId: `${batch}~${size}`,
      grade: (1 + Math.floor(random() * 5)) as 1,
      source: 'self',
    });
  }
  return entries;
};

if (mode === 'big') {
  const bigRows = Number(bigRowsArg ?? 200_000);
  out(`BEGIN ${nextSeq} 5`);
  await store.append(makeBatch(`${device}-${seed}-warm`, 5));
  out(`ACK ${nextSeq - 1}`);
  const batch = makeBatch(`big-${seed}`, bigRows);
  out('BIGSTART');
  const started = performance.now();
  await store.append(batch);
  out(`BIGDONE ${(performance.now() - started).toFixed(1)}`);
  await store.close();
  process.exit(0);
}

for (let batchNo = 0; ; batchNo++) {
  const size = 1 + Math.floor(random() * 50);
  const first = nextSeq;
  const entries = makeBatch(`${device}-${seed}-${batchNo}`, size);
  out(`BEGIN ${first} ${size}`);
  await store.append(entries);
  out(`ACK ${nextSeq - 1}`);
  if (mode === 'manual' && random() < 0.2) {
    const kind = ['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE'][
      Math.floor(random() * 4)
    ];
    db.pragma(`wal_checkpoint(${kind})`);
  }
  // притормаживаем писателя: БД растёт медленно, сотни итераций остаются проверяемыми
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)),
    0,
    0,
    Math.floor(random() * 9),
  );
}
