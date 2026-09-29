// Дочерний процесс = одно устройство: пишет, экспортирует и импортирует в общую папку.
// Запуск: node --experimental-strip-types sync-child.ts <dir> <deviceId> <rounds> <perRound> <seed> <out>
import { writeFileSync } from 'node:fs';
import { createJournalWriter } from '../../src/app/journal-writer.ts';
import type { LogEntry } from '../../src/domain/journal.ts';
import { createFolderSync } from '../../src/node/folder-sync.ts';
import { createMemoryEventStore } from '../../src/node/memory-event-store.ts';
import { createReplica } from '../../src/sync/replica.ts';

const [dir, deviceId, rounds, perRound, seed, out] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
  string,
  string,
];

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

const random = mulberry32(Number(seed));
const clock = { now: () => Date.now() };
let issued = 0;
const ids = { next: () => `${deviceId}-${++issued}` };
const store = createMemoryEventStore({ deviceId });
const writer = createJournalWriter({ clock, ids, eventStore: store });
const replica = createReplica({ store, clock });
const folder = createFolderSync({ dir, store, replica, entriesPerSegment: 7 });
const exercises = ['E1', 'E2', 'E3', 'E4'];

const pick = (items: string[]) => items[Math.floor(random() * items.length)]!;

const build = () => {
  const roll = random();
  if (roll < 0.75) {
    return writer.build({
      kind: 'attempt',
      exerciseId: pick(exercises),
      grade: (1 + Math.floor(random() * 5)) as 1,
      source: 'self',
    });
  }
  if (roll < 0.9) {
    return writer.build({
      kind: 'unit_flag',
      unitId: pick(exercises),
      flag: 'blacklist',
      op: random() < 0.5 ? 'set' : 'unset',
    });
  }
  return writer.build({
    kind: 'progress_reset',
    unitId: pick(['E1', 'L1', 'L2', 'C']),
  });
};

const write = async () => {
  const entry = build();
  await store.append([entry]);
  writer.commit(entry);
};

for (let round = 0; round < Number(rounds); round++) {
  for (let i = 0; i < Number(perRound); i++) await write();
  await folder.export();
  await folder.import();
}

const entries: LogEntry[] = [];
for await (const entry of store.readAll()) entries.push(entry);
writeFileSync(out, JSON.stringify(entries));
