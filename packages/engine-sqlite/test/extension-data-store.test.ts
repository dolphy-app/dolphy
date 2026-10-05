import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeExtensionDataStoreContract } from '../../engine/test/node/extension-data-store.contract.ts';
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  openBetterSqliteDatabase,
  openSqliteStorage,
} from '../src/index.ts';
import { useTempDir } from './store-factory.ts';

const temp = useTempDir();
let counter = 0;
const nextPath = () => join(temp.dir, `extension-data-${counter++}.db`);
const open = (path: string) =>
  openSqliteStorage({ path, deviceId: 'dev-1', durability: 'normal' });

describeExtensionDataStoreContract(
  'sqlite',
  async () => open(nextPath()).extensionData,
);

describe('SQLite extension data store', () => {
  it('данные переживают переоткрытие БД', async () => {
    const path = nextPath();
    const first = open(path);
    await first.extensionData.storage.set('acme.ext', 'streak', { days: 3 });
    await first.extensionData.settings.set('acme.ext', 'goal', 5);
    await first.extensionData.secrets.set('acme.ext', 'token', 'Y2lwaGVy');
    await first.events.close();
    const second = open(path).extensionData;
    expect(await second.storage.get('acme.ext', 'streak')).toEqual({ days: 3 });
    expect(await second.settings.all('acme.ext')).toEqual({ goal: 5 });
    expect(await second.secrets.get('acme.ext', 'token')).toBe('Y2lwaGVy');
  });

  it('БД предыдущей схемы получает таблицу секретов, данные расширений и журнал целы', async () => {
    const path = nextPath();
    const legacy = openBetterSqliteDatabase({ path });
    const previous = 4; // секреты добавляет миграция 5
    for (const sql of MIGRATIONS.slice(0, previous)) legacy.exec(sql);
    legacy.exec(`PRAGMA user_version = ${previous}`);
    legacy
      .prepare("INSERT INTO meta (key, value) VALUES ('device_id', 'dev-1')")
      .run();
    legacy
      .prepare(
        "INSERT INTO extension_storage (extension_id, key, value) VALUES ('acme.ext', 'k', '1')",
      )
      .run();
    legacy
      .prepare(
        "INSERT INTO extension_setting (extension_id, key, value) VALUES ('acme.ext', 'goal', '5')",
      )
      .run();
    legacy.close();

    const { events, extensionData } = open(path);
    expect(events.inspect().userVersion).toBe(SCHEMA_VERSION);
    expect(events.deviceId).toBe('dev-1');
    expect(await extensionData.storage.get('acme.ext', 'k')).toBe(1);
    expect(await extensionData.settings.get('acme.ext', 'goal')).toBe(5);
    expect(await extensionData.secrets.keys('acme.ext')).toEqual([]);
    await extensionData.secrets.set('acme.ext', 'token', 'Y2lwaGVy');
    expect(await extensionData.secrets.usage('acme.ext')).toEqual({
      keys: 1,
      bytes: '"Y2lwaGVy"'.length,
    });
    await extensionData.deleteAllData('acme.ext');
    expect(await extensionData.secrets.keys('acme.ext')).toEqual([]);
    expect(await extensionData.storage.keys('acme.ext')).toEqual([]);
  });

  it('БД схемы 3 получает таблицы, остальные строки целы', async () => {
    const path = nextPath();
    const legacy = openBetterSqliteDatabase({ path });
    for (const sql of MIGRATIONS.slice(0, 3)) legacy.exec(sql);
    legacy.exec('PRAGMA user_version = 3');
    legacy
      .prepare("INSERT INTO meta (key, value) VALUES ('device_id', 'dev-1')")
      .run();
    legacy
      .prepare("INSERT INTO setting (key, value) VALUES ('ui', '{}')")
      .run();
    legacy.close();

    const { events, settings, extensionData } = open(path);
    expect(events.inspect().userVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(4);
    expect(events.deviceId).toBe('dev-1');
    expect(await settings.loadUi()).toEqual({
      theme: 'system',
      locale: 'system',
    });
    expect(await extensionData.storage.keys('acme.ext')).toEqual([]);
    await extensionData.storage.set('acme.ext', 'k', 1);
    expect(await extensionData.storage.get('acme.ext', 'k')).toBe(1);
  });

  it('повреждённое значение — STORE_CORRUPT, а не тихий undefined', async () => {
    const path = nextPath();
    await open(path).events.close();
    const raw = openBetterSqliteDatabase({ path });
    raw
      .prepare(
        "INSERT INTO extension_storage (extension_id, key, value) VALUES ('acme.ext', 'k', '{oops')",
      )
      .run();
    raw.close();
    const reopened = open(path).extensionData;
    await expect(reopened.storage.get('acme.ext', 'k')).rejects.toMatchObject({
      code: 'STORE_CORRUPT',
    });
  });
});
