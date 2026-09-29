// Дочерний процесс T-12: настоящий движок поверх SqliteEventStore пишет попытки
// через фасад, пока его не убьют. Запуск (после SIGKILL БД открывается снова):
//   node --experimental-strip-types crash-engine-child.ts <db> <run>
// Протокол stdout (одна строка — один write(2)): `ACK <requestId>` — после
// возврата `recordAttempt` (запись зафиксирована, проекции применены).
import { writeSync } from 'node:fs';
import { createTestEngine } from '../../../engine/test/helpers/engine.ts';
import { openSqliteEventStore } from '../../src/event-store.ts';
import { CRASH_DEVICE_ID, CRASH_EXERCISES } from './crash-engine-shared.ts';

const [dbPath, run] = process.argv.slice(2);
if (dbPath === undefined || run === undefined) {
  console.error('usage: crash-engine-child.ts <db> <run>');
  process.exit(2);
}

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

const { engine, clock } = await createTestEngine({
  library: 'sql-course',
  eventStore: openSqliteEventStore({
    path: dbPath,
    deviceId: CRASH_DEVICE_ID,
    durability: 'normal',
  }),
});

for (let n = 0; ; n++) {
  const requestId = `r${run}-${n}`;
  clock.advance(1_000);
  await engine.practice.recordAttempt({
    requestId,
    exerciseId: CRASH_EXERCISES[n % CRASH_EXERCISES.length] as string,
    grade: (1 + (n % 5)) as 1,
  });
  out(`ACK ${requestId}`);
}
