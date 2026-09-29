import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import { openSqliteEventStore } from '../src/index.ts';
import type { SqliteEventStore } from '../src/index.ts';

/** Каталог под БД теста: создаётся до всех тестов файла, удаляется после. */
export const useTempDir = () => {
  const state = { dir: '' };
  beforeAll(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'engine-sqlite-'));
  });
  afterAll(() => {
    rmSync(state.dir, { recursive: true, force: true });
  });
  return state;
};

/** Файловое хранилище; `durability: 'normal'` ускоряет тесты (SIGKILL и `PRAGMA` — отдельно). */
export const openTestStore = (
  dir: string,
  slot: string,
  deviceId: string,
): SqliteEventStore =>
  openSqliteEventStore({
    path: join(dir, `${slot}.db`),
    deviceId,
    durability: 'normal',
  });
