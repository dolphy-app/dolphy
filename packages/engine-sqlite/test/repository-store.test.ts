import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeRepositoryStoreContract } from '../../engine/test/node/repository-store.contract.ts';
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  openBetterSqliteDatabase,
  openSqliteStorage,
} from '../src/index.ts';
import { useTempDir } from './store-factory.ts';

const temp = useTempDir();
let counter = 0;
const nextPath = () => join(temp.dir, `repositories-${counter++}.db`);
const open = (path: string) =>
  openSqliteStorage({ path, deviceId: 'dev-1', durability: 'normal' });

const sample = {
  id: 'r',
  url: 'https://example.com/r.git',
  ref: 'refs/heads/main',
  commit: 'c'.repeat(40),
  fetchedAt: 1,
  courseIds: ['c1'],
};

describeRepositoryStoreContract(
  'sqlite',
  async () => open(nextPath()).repositories,
);

describe('SQLite repository store', () => {
  it('записи переживают переоткрытие БД', async () => {
    const path = nextPath();
    const first = open(path);
    await first.repositories.put(sample);
    await first.events.close();
    expect(await open(path).repositories.list()).toEqual([sample]);
  });

  it('БД прежней схемы получает таблицу, остальные строки целы', async () => {
    const path = nextPath();
    const legacy = openBetterSqliteDatabase({ path });
    for (const sql of MIGRATIONS.slice(0, SCHEMA_VERSION - 1)) legacy.exec(sql);
    legacy.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1}`);
    legacy
      .prepare("INSERT INTO meta (key, value) VALUES ('device_id', 'dev-1')")
      .run();
    legacy
      .prepare("INSERT INTO setting (key, value) VALUES ('ui', '{}')")
      .run();
    legacy.close();

    const { events, settings, repositories } = open(path);
    expect(events.inspect().userVersion).toBe(SCHEMA_VERSION);
    expect(events.deviceId).toBe('dev-1');
    expect(await settings.loadUi()).toEqual({
      theme: 'system',
      locale: 'system',
    });
    expect(await repositories.list()).toEqual([]);
    await repositories.put(sample);
    expect(await repositories.list()).toEqual([sample]);
  });
});
