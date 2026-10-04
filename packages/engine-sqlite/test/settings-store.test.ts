import { join } from 'node:path';
import {
  createJsonSettingsStore,
  createMemorySettingsStore,
} from '@dolphy-app/engine/node';
import type {
  SavedFilterDto,
  StudySessionWire,
} from '@dolphy-app/engine-contract';
import { describe, expect, it } from 'vitest';
import { describeSettingsStoreContract } from '../../engine/test/node/settings-store.contract.ts';
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  openBetterSqliteDatabase,
  openSqliteStorage,
} from '../src/index.ts';
import { useTempDir } from './store-factory.ts';

const temp = useTempDir();
let counter = 0;
const nextPath = () => join(temp.dir, `settings-${counter++}.db`);
const open = (path: string) =>
  openSqliteStorage({ path, deviceId: 'dev-1', durability: 'normal' });

describeSettingsStoreContract('sqlite', async () => open(nextPath()).settings);

describe('SQLite settings store', () => {
  it('настройки переживают переоткрытие БД', async () => {
    const path = nextPath();
    const first = open(path);
    await first.settings.savePreferences({
      scheduler: { batch_size: 12 },
      ignored_paths: ['a/b'],
      transcription: null,
    });
    await first.settings.saveFilter({
      id: 'f',
      description: 'd',
      filter: { Dependencies: { unit_ids: ['u'], depth: 2 } },
    });
    await first.settings.saveSchedulerOverrides({ batchSize: 7 });
    await first.settings.saveUi({ theme: 'dark', locale: 'en' });
    await first.events.close();

    const { settings } = open(path);
    expect(await settings.loadPreferences()).toMatchObject({
      scheduler: { batch_size: 12 },
      ignored_paths: ['a/b'],
    });
    expect((await settings.listFilters()).map(({ id }) => id)).toEqual(['f']);
    expect(await settings.loadSchedulerOverrides()).toEqual({ batchSize: 7 });
    expect(await settings.loadUi()).toEqual({ theme: 'dark', locale: 'en' });
  });

  it('БД старой схемы получает таблицы настроек, журнал цел', async () => {
    const path = nextPath();
    const legacy = openBetterSqliteDatabase({ path });
    legacy.exec(MIGRATIONS[0]!);
    legacy.exec('PRAGMA user_version = 1');
    legacy
      .prepare("INSERT INTO meta (key, value) VALUES ('device_id', 'dev-1')")
      .run();
    legacy.close();

    const { events, settings } = open(path);
    expect(events.inspect().userVersion).toBe(SCHEMA_VERSION);
    expect(events.deviceId).toBe('dev-1');
    await settings.saveUi({ theme: 'light', locale: 'ru' });
    expect(await settings.loadUi()).toEqual({ theme: 'light', locale: 'ru' });
  });

  it('запись расширений прежней формы (без checkUpdates) — проверка включена', async () => {
    const path = nextPath();
    const { events } = open(path);
    await events.close();
    const raw = openBetterSqliteDatabase({ path });
    raw
      .prepare("INSERT INTO setting (key, value) VALUES ('extensions', ?)")
      .run('{"disabled":["acme.a"],"trusted":["acme.b"]}');
    raw.close();

    expect(await open(path).settings.loadExtensions()).toEqual({
      disabled: ['acme.a'],
      trusted: ['acme.b'],
      checkUpdates: true,
      safeMode: false,
    });
  });

  it('повреждённая запись — STORE_CORRUPT, а не тихие умолчания', async () => {
    const path = nextPath();
    const { events } = open(path);
    await events.close();
    const raw = openBetterSqliteDatabase({ path });
    raw
      .prepare(
        "INSERT INTO setting (key, value) VALUES ('user_preferences', ?)",
      )
      .run('{ not json');
    raw
      .prepare("INSERT INTO saved_filter (id, body) VALUES ('bad', ?)")
      .run('{"id":"bad"}');
    raw.close();

    const { settings } = open(path);
    await expect(settings.loadPreferences()).rejects.toMatchObject({
      code: 'STORE_CORRUPT',
    });
    await expect(settings.listFilters()).rejects.toMatchObject({
      code: 'STORE_CORRUPT',
    });
  });

  it('запись старой версии (без языка) и неверные поля читаются с умолчаниями', async () => {
    const path = nextPath();
    const { events } = open(path);
    await events.close();
    const raw = openBetterSqliteDatabase({ path });
    raw
      .prepare("INSERT INTO setting (key, value) VALUES ('ui', ?)")
      .run('{"theme":"dark"}');
    raw.close();
    expect(await open(path).settings.loadUi()).toEqual({
      theme: 'dark',
      locale: 'system',
    });

    const broken = openBetterSqliteDatabase({ path });
    broken
      .prepare("UPDATE setting SET value = ? WHERE key = 'ui'")
      .run('{"theme":"Sepia!","locale":"de"}');
    broken.close();
    expect(await open(path).settings.loadUi()).toEqual({
      theme: 'system',
      locale: 'system',
    });
  });
});

describe('настройки расширений', () => {
  it('неверная сохранённая форма читается как пустые списки', async () => {
    const path = nextPath();
    const { events } = open(path);
    await events.close();
    const raw = openBetterSqliteDatabase({ path });
    raw
      .prepare("INSERT INTO setting (key, value) VALUES ('extensions', ?)")
      .run('{"disabled":["Bad Id"],"trusted":[]}');
    raw.close();
    expect(await open(path).settings.loadExtensions()).toEqual({
      disabled: [],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
    });
  });
});

const filter = (id: string, description: string): SavedFilterDto => ({
  id,
  description,
  filter: { Dependencies: { unit_ids: ['u'], depth: 2 } },
});
const session = (id: string): StudySessionWire => ({
  id,
  description: 'd',
  parts: [{ NoFilter: { duration: 10 } }],
});
const legacyPreferences = {
  scheduler: { batch_size: 12 },
  ignored_paths: ['drafts'],
  transcription: null,
};

describe('одноразовый импорт прежних настроек (JSON) в БД', () => {
  it('переносит предпочтения, фильтры и сессии, повтор ничего не делает', async () => {
    const path = nextPath();
    const legacy = createMemorySettingsStore({
      preferences: legacyPreferences,
      filters: [filter('f', 'from json')],
      sessions: [session('s')],
    });
    const first = open(path);
    expect(await first.settings.importLegacySettings(legacy)).toEqual({
      imported: true,
      preferences: true,
      filters: 1,
      sessions: 1,
      skipped: 0,
    });
    expect(await first.settings.loadPreferences()).toMatchObject(
      legacyPreferences,
    );
    expect((await first.settings.listFilters())[0]?.description).toBe(
      'from json',
    );
    expect((await first.settings.listSessions()).map(({ id }) => id)).toEqual([
      's',
    ]);
    await first.events.close();

    // после переоткрытия старое хранилище уже не читается
    await legacy.saveFilter(filter('new', 'late'));
    const again = await open(path).settings.importLegacySettings(legacy);
    expect(again.imported).toBe(false);
    expect(
      (await open(path).settings.listFilters()).map(({ id }) => id),
    ).toEqual(['f']);
  });

  it('данные, уже лежащие в БД, побеждают', async () => {
    const { settings } = open(nextPath());
    await settings.savePreferences({
      scheduler: null,
      ignored_paths: ['db'],
      transcription: null,
    });
    await settings.saveFilter(filter('f', 'from db'));
    const legacy = createMemorySettingsStore({
      preferences: legacyPreferences,
      filters: [filter('f', 'from json'), filter('g', 'only json')],
    });
    expect(await settings.importLegacySettings(legacy)).toEqual({
      imported: true,
      preferences: false,
      filters: 1,
      sessions: 0,
      skipped: 1,
    });
    expect((await settings.loadPreferences()).ignored_paths).toEqual(['db']);
    expect(
      (await settings.listFilters()).map(({ id, description }) => [
        id,
        description,
      ]),
    ).toEqual([
      ['f', 'from db'],
      ['g', 'only json'],
    ]);
  });

  it('пустое прежнее хранилище: отметка ставится, предпочтения не создаются', async () => {
    const { settings } = open(nextPath());
    expect(
      await settings.importLegacySettings(createMemorySettingsStore()),
    ).toEqual({
      imported: true,
      preferences: false,
      filters: 0,
      sessions: 0,
      skipped: 0,
    });
    const late = createMemorySettingsStore({ filters: [filter('f', 'x')] });
    expect((await settings.importLegacySettings(late)).imported).toBe(false);
    expect(await settings.listFilters()).toEqual([]);
  });

  it('отказ чтения не оставляет частичного переноса и не ставит отметку', async () => {
    const { settings } = open(nextPath());
    const broken = {
      ...createMemorySettingsStore({
        preferences: legacyPreferences,
        filters: [filter('f', 'x')],
      }),
      listSessions: async () => {
        throw new Error('unreadable study_sessions');
      },
    };
    await expect(settings.importLegacySettings(broken)).rejects.toThrow(
      'unreadable study_sessions',
    );
    expect(await settings.listFilters()).toEqual([]);
    expect((await settings.loadPreferences()).ignored_paths).toEqual([]);

    const healthy = createMemorySettingsStore({ filters: [filter('f', 'x')] });
    expect((await settings.importLegacySettings(healthy)).filters).toBe(1);
  });

  it('читает настоящие файлы JSON-хранилища', async () => {
    const dir = join(temp.dir, `legacy-${counter++}`);
    const files = createJsonSettingsStore({ dir });
    await files.savePreferences(legacyPreferences);
    await files.saveFilter(filter('f/1', 'file'));
    await files.saveSession(session('s'));

    const { settings } = open(nextPath());
    const report = await settings.importLegacySettings(
      createJsonSettingsStore({ dir }),
    );
    expect(report).toMatchObject({ imported: true, filters: 1, sessions: 1 });
    expect((await settings.listFilters())[0]).toMatchObject({
      id: 'f/1',
      description: 'file',
    });
    expect((await settings.loadPreferences()).scheduler).toEqual({
      batch_size: 12,
    });
  });
});
