import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeClock } from '@spirula-app/testkit';
import { describe, expect, it } from 'vitest';
import type { LogEntry } from '@spirula-app/engine';
import { importFromTrane } from '@spirula-app/engine/sync';
import {
  openBetterSqliteDatabase,
  openSqliteEventStore,
  readTraneDirectory,
} from '../src/index.ts';
import { useTempDir } from './store-factory.ts';

const temp = useTempDir();
let counter = 0;

/** Схемы — из миграций Trane (`practice_stats.rs`, `blacklist.rs`, `review_list.rs`). */
const createTraneDirectory = (options: { withStats?: boolean } = {}) => {
  const dir = join(temp.dir, `trane-${counter++}`);
  mkdirSync(dir, { recursive: true });
  if (options.withStats ?? true) {
    const stats = openBetterSqliteDatabase({
      path: join(dir, 'practice_stats.db'),
    });
    stats.exec(`
      CREATE TABLE uids(unit_uid INTEGER PRIMARY KEY, unit_id TEXT NOT NULL UNIQUE);
      CREATE TABLE practice_stats(
        id INTEGER PRIMARY KEY,
        unit_uid INTEGER NOT NULL REFERENCES uids(unit_uid),
        score REAL, timestamp INTEGER);
      INSERT INTO uids(unit_uid, unit_id) VALUES (1, 'c::l::e1'), (2, 'c::l::e2');
      INSERT INTO practice_stats(unit_uid, score, timestamp) VALUES
        (1, 3.0, 1700000000), (1, 5.0, 1700000100), (2, 2.0, 1700000050),
        (2, 0.0, 1700000060), (2, NULL, 1700000070), (2, 4.0, NULL);
    `);
    stats.close();
  }
  const blacklist = openBetterSqliteDatabase({
    path: join(dir, 'blacklist.db'),
  });
  blacklist.exec(`
    CREATE TABLE blacklist(unit_id TEXT NOT NULL UNIQUE);
    INSERT INTO blacklist(unit_id) VALUES ('c::l::e2');
  `);
  blacklist.close();
  const review = openBetterSqliteDatabase({
    path: join(dir, 'review_list.db'),
  });
  review.exec(`
    CREATE TABLE review_list(unit_id TEXT NOT NULL UNIQUE);
    INSERT INTO review_list(unit_id) VALUES ('c::l'), ('c::l::e1');
  `);
  review.close();
  return dir;
};

describe('readTraneDirectory + importFromTrane', () => {
  it('imports attempts and flags from real Trane databases, idempotently', async () => {
    const traneDir = createTraneDirectory();
    const store = openSqliteEventStore({
      path: join(temp.dir, `journal-${counter++}.db`),
      deviceId: 'dev-a',
      durability: 'normal',
    });
    const clock = createFakeClock(1_800_000_000_000);
    try {
      const first = await importFromTrane({
        store,
        clock,
        source: readTraneDirectory(traneDir),
      });
      expect(first).toEqual({ attempts: 3, flags: 3, skipped: 3 });
      const entries: LogEntry[] = [];
      for await (const entry of store.readAll()) entries.push(entry);
      const attempts = entries.filter((e) => e.kind === 'attempt');
      expect(
        attempts.map((e) => [e.at, e.kind === 'attempt' && e.grade]),
      ).toEqual([
        [1_700_000_000_000, 3],
        [1_700_000_050_000, 2],
        [1_700_000_100_000, 5],
      ]);
      expect(
        entries.every(
          (e) => e.kind !== 'attempt' || e.source === 'trane-import',
        ),
      ).toBe(true);
      expect(store.vector()).toEqual({ 'dev-a': 6 });

      const again = await importFromTrane({
        store,
        clock,
        source: readTraneDirectory(traneDir),
      });
      expect(again).toEqual({ attempts: 0, flags: 0, skipped: 9 });
      expect(store.entryCount()).toBe(6);
    } finally {
      await store.close();
    }
  });

  it('treats a missing database as empty and a missing directory as NOT_FOUND', () => {
    const partial = createTraneDirectory({ withStats: false });
    const source = readTraneDirectory(partial);
    expect([...source.trials()]).toEqual([]);
    expect([...source.blacklist()]).toEqual(['c::l::e2']);
    expect([...source.reviewList()]).toEqual(['c::l', 'c::l::e1']);
    expect(() =>
      readTraneDirectory(join(temp.dir, 'nothing-here')),
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});
