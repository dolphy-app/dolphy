import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAttempt, buildRetract } from '@dolphy-app/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import type { LogEntry } from '@dolphy-app/engine';
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  openBetterSqliteDatabase,
  openSqliteEventStore,
} from '../src/index.ts';
import type { SqliteEventStore } from '../src/index.ts';
import { useTempDir } from './store-factory.ts';

const temp = useTempDir();
let counter = 0;
const opened: SqliteEventStore[] = [];
const pathOf = () => join(temp.dir, `store-${counter++}.db`);
const open = (
  path: string,
  options: Partial<Parameters<typeof openSqliteEventStore>[0]> = {},
) => {
  const store = openSqliteEventStore({ path, deviceId: 'dev-a', ...options });
  opened.push(store);
  return store;
};
afterEach(async () => {
  for (const store of opened.splice(0)) await store.close();
});

const attempt = (seq: number, at = 1_000 + seq): LogEntry =>
  buildAttempt({ deviceId: 'dev-a', seq, at, exerciseId: 'c::l::e' });

describe('openSqliteEventStore settings', () => {
  it('uses WAL, foreign keys and the current schema version', () => {
    const store = open(pathOf());
    expect(store.inspect()).toMatchObject({
      journalMode: 'wal',
      foreignKeys: true,
      userVersion: SCHEMA_VERSION,
    });
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });

  it('defaults to synchronous=FULL, with fullfsync=ON on macOS only', () => {
    const inspected = open(pathOf()).inspect();
    expect(inspected.synchronous).toBe('full');
    expect(inspected.fullfsync).toBe(process.platform === 'darwin');
  });

  it("durability 'normal' selects synchronous=NORMAL without fullfsync", () => {
    const inspected = open(pathOf(), { durability: 'normal' }).inspect();
    expect(inspected.synchronous).toBe('normal');
    expect(inspected.fullfsync).toBe(false);
  });

  it('fullfsync can be forced on explicitly', () => {
    const inspected = open(pathOf(), {
      durability: 'normal',
      fullfsync: true,
    }).inspect();
    expect(inspected).toMatchObject({ synchronous: 'normal', fullfsync: true });
  });

  it('keeps the device id from meta over the option on reopen', async () => {
    const path = pathOf();
    const first = open(path, { deviceId: 'first' });
    expect(first.deviceId).toBe('first');
    await first.close();
    expect(open(path, { deviceId: 'second' }).deviceId).toBe('first');
  });

  it('keeps a rotated device id across reopen', async () => {
    const path = pathOf();
    const first = open(path);
    await first.rotateDeviceId('dev-a-2');
    await first.close();
    expect(open(path).deviceId).toBe('dev-a-2');
  });

  it('generates a device id when none is given and validates a given one', () => {
    const generated = openSqliteEventStore({ path: pathOf() });
    opened.push(generated);
    expect(generated.deviceId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(() =>
      openSqliteEventStore({ path: pathOf(), deviceId: 'bad id' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe('openSqliteEventStore failures', () => {
  it('reports SQLITE_BUSY from a second writer as retryable STORE_BUSY', async () => {
    const path = pathOf();
    const store = open(path, { busyTimeoutMs: 30 });
    const rival = openBetterSqliteDatabase({ path });
    rival.exec('BEGIN IMMEDIATE');
    const failure = await store.append([attempt(1)]).catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: 'STORE_BUSY', retryable: true });
    expect(store.entryCount()).toBe(0);
    rival.exec('ROLLBACK');
    rival.close();
    await store.append([attempt(1)]);
    expect(store.entryCount()).toBe(1);
  });

  it('reports a write to a read-only store as STORE_READONLY and still reads', async () => {
    const path = pathOf();
    const writable = open(path, { durability: 'normal' });
    await writable.append([attempt(1), attempt(2)]);
    await writable.close();
    const readOnly = open(path, { readOnly: true });
    const found: LogEntry[] = [];
    for await (const entry of readOnly.readAll()) found.push(entry);
    expect(found).toHaveLength(2);
    const failure = await readOnly
      .append([attempt(3)])
      .catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: 'STORE_READONLY', retryable: false });
  });

  it('refuses to open a fresh database read-only', () => {
    expect(() =>
      openSqliteEventStore({ path: pathOf(), readOnly: true }),
    ).toThrow();
  });

  it('reports a file that is not a database as STORE_CORRUPT', () => {
    const path = pathOf();
    writeFileSync(path, randomBytes(4_096));
    expect(() => openSqliteEventStore({ path })).toThrowError(
      expect.objectContaining({ code: 'STORE_CORRUPT', retryable: false }),
    );
  });

  it('refuses a schema newer than the engine knows', async () => {
    const path = pathOf();
    const first = open(path);
    await first.close();
    const raw = openBetterSqliteDatabase({ path });
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    raw.close();
    expect(() => openSqliteEventStore({ path })).toThrowError(
      expect.objectContaining({ code: 'STORE_READONLY' }),
    );
  });
});

describe('SqliteEventStore storage', () => {
  it('enforces the entry CHECK at the SQL level too', () => {
    const path = pathOf();
    open(path);
    const raw = openBetterSqliteDatabase({ path });
    const insert = raw.prepare(
      `INSERT INTO log_entry (device_id, seq, id, kind, at, recorded_at, unit_id, grade, source)
       VALUES ('d', 1, 'x', 'attempt', 1, 1, 'u', 9, 'self')`,
    );
    expect(() => insert.run()).toThrow(/CHECK/);
    raw.close();
  });

  it('streams more than one page in (at, device_id, seq) order', async () => {
    const store = open(pathOf(), { durability: 'normal' });
    const entries: LogEntry[] = [];
    for (let seq = 1; seq <= 12_345; seq++) {
      entries.push(attempt(seq, 5_000 - (seq % 97)));
    }
    await store.append(entries);
    let count = 0;
    let previous: LogEntry | null = null;
    for await (const entry of store.readAll()) {
      if (previous) {
        const ordered =
          previous.at < entry.at ||
          (previous.at === entry.at && previous.seq < entry.seq);
        expect(ordered).toBe(true);
      }
      previous = entry;
      count++;
    }
    expect(count).toBe(12_345);
  });

  it('rolls back a failed migration together with its version', async () => {
    const path = pathOf();
    const raw = openBetterSqliteDatabase({ path });
    raw.exec('CREATE TABLE meta (key TEXT)'); // мешает миграции 1
    raw.close();
    expect(() => openSqliteEventStore({ path })).toThrow();
    const check = openBetterSqliteDatabase({ path });
    expect(Number(check.pragma('user_version'))).toBe(0);
    expect(
      check
        .prepare<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE name = 'log_entry'",
        )
        .get(),
    ).toBeUndefined();
    check.close();
  });

  it('migration 6 keeps existing rows and their order and accepts retract entries', async () => {
    const path = pathOf();
    const legacy = openBetterSqliteDatabase({ path });
    for (const sql of MIGRATIONS.slice(0, 5)) legacy.exec(sql);
    legacy.exec('PRAGMA user_version = 5');
    legacy
      .prepare("INSERT INTO meta (key, value) VALUES ('device_id', 'dev-a')")
      .run();
    const insert = legacy.prepare(
      `INSERT INTO log_entry (device_id, seq, id, kind, at, recorded_at, unit_id, grade, source, flag, op, extra)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      'dev-a',
      1,
      'a1',
      'attempt',
      10,
      10,
      'c::l::e',
      4,
      'self',
      null,
      null,
      null,
    );
    insert.run(
      'dev-a',
      2,
      'f1',
      'unit_flag',
      9,
      9,
      'c::l',
      null,
      null,
      'review',
      'set',
      null,
    );
    insert.run(
      'dev-a',
      3,
      'r1',
      'progress_reset',
      11,
      11,
      'c',
      null,
      null,
      null,
      null,
      '{"libraryRevision":"rev"}',
    );
    legacy.close();

    const store = open(path);
    expect(store.inspect().userVersion).toBe(SCHEMA_VERSION);
    await store.append([
      buildRetract({ deviceId: 'dev-a', seq: 4, at: 12, targetId: 'a1' }),
    ]);
    const found: LogEntry[] = [];
    for await (const entry of store.readAll()) found.push(entry);
    expect(found.map(({ id, kind }) => [id, kind])).toEqual([
      ['f1', 'unit_flag'],
      ['a1', 'attempt'],
      ['r1', 'progress_reset'],
      [expect.any(String), 'retract'],
    ]);
    expect(found[2]).toMatchObject({ libraryRevision: 'rev' });
    await store.close();

    const raw = openBetterSqliteDatabase({ path });
    expect(
      raw
        .prepare<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'log_entry' AND name LIKE 'log_%' ORDER BY name",
        )
        .all()
        .map(({ name }) => name),
    ).toEqual(['log_order', 'log_unit']);
    const bad = raw.prepare(
      `INSERT INTO log_entry (device_id, seq, id, kind, at, recorded_at, unit_id, op)
       VALUES ('d', 9, 'x', 'retract', 1, 1, 'u', 'maybe')`,
    );
    expect(() => bad.run()).toThrow(/CHECK/);
    raw.close();
  });
});
