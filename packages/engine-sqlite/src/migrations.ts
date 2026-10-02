import { EngineError } from '@dolphy-app/engine/app';
import type { SqlDatabase } from './sql-database.ts';

/**
 * Миграции — обычные `.sql`-строки без драйвер-специфичных возможностей;
 * версия схемы — `PRAGMA user_version` (номер = позиция в массиве + 1).
 * Миграция 1 — схема `engine-ts.md` §5.1; индексы `log_conflict_*` добавлены
 * ради поиска сторон конфликта по `id`, `(device_id, seq)` и хэшу [ВЫВОД].
 * Миграция 2 — настройки ученика (`SettingsStore`): не входят в журнал и не
 * синхронизируются, у каждого устройства свои.
 * Миграция 3 — реестр git-репозиториев (`RepositoryStore`).
 * Миграция 4 — данные расширений (`ExtensionDataStore`): хранилище кода
 * расширения и значения его настроек, по ключу `(extension_id, key)`; значение —
 * JSON-текст. Не входят в журнал и не синхронизируются.
 */
export const MIGRATIONS: readonly string[] = [
  `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE log_entry (
  device_id TEXT NOT NULL, seq INTEGER NOT NULL,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('attempt','unit_flag','progress_reset')),
  at INTEGER NOT NULL, recorded_at INTEGER NOT NULL,
  unit_id TEXT NOT NULL,
  grade INTEGER, source TEXT,
  flag TEXT, op TEXT,
  extra TEXT,
  PRIMARY KEY (device_id, seq),
  CHECK ((kind='attempt' AND grade BETWEEN 1 AND 5 AND source IS NOT NULL)
      OR (kind='unit_flag' AND flag IS NOT NULL AND op IN ('set','unset'))
      OR (kind='progress_reset'))
) STRICT;
CREATE INDEX log_order ON log_entry (at, device_id, seq);
CREATE INDEX log_unit  ON log_entry (unit_id, at, device_id, seq);
CREATE TABLE log_conflict (
  conflict_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('id-content','seq-two-ids','clock-skew')),
  entry_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','kept','discarded')),
  id TEXT NOT NULL, device_id TEXT NOT NULL, seq INTEGER NOT NULL, payload TEXT NOT NULL,
  detected_at INTEGER NOT NULL, PRIMARY KEY (conflict_id, entry_hash)
) STRICT;
CREATE INDEX log_conflict_entry ON log_conflict (id);
CREATE INDEX log_conflict_pair ON log_conflict (device_id, seq);
CREATE INDEX log_conflict_hash ON log_conflict (entry_hash);
CREATE TABLE imported_segment (
  device_id TEXT NOT NULL, name TEXT NOT NULL, sha256 TEXT NOT NULL,
  first_seq INTEGER NOT NULL, last_seq INTEGER NOT NULL, imported_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, name, sha256)
) STRICT;
`,
  `
CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE saved_filter (id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
CREATE TABLE study_session (id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
`,
  `
CREATE TABLE repository (id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
`,
  `
CREATE TABLE extension_storage (
  extension_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (extension_id, key)
) STRICT, WITHOUT ROWID;
CREATE TABLE extension_setting (
  extension_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (extension_id, key)
) STRICT, WITHOUT ROWID;
`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export const readSchemaVersion = (db: SqlDatabase): number =>
  Number(db.pragma('user_version'));

/**
 * Применяет недостающие миграции, каждую — вместе с новой версией в одной
 * транзакции: либо вся миграция и версия, либо ничего.
 */
export const migrate = (db: SqlDatabase) => {
  const current = readSchemaVersion(db);
  if (current > SCHEMA_VERSION) {
    throw new EngineError('STORE_READONLY', {
      message: 'Database schema is newer than this engine',
      details: { userVersion: current, supported: SCHEMA_VERSION },
    });
  }
  for (let version = current + 1; version <= SCHEMA_VERSION; version++) {
    const sql = MIGRATIONS[version - 1]!;
    db.transaction(() => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version}`);
    });
  }
};
