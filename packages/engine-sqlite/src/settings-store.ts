import type {
  DeepPartial,
  SavedFilterDto,
  ExtensionSettingsDto,
  LearningSettingsDto,
  SchedulerOptionsDto,
  StudySessionWire,
  UiSettingsDto,
} from '@dolphy-app/engine-contract';
import {
  decodeExtensionSettings,
  decodeLearningSettings,
  decodeUiSettings,
  decodeUpdateCheckedAt,
  encodeUserPreferences,
  parseUserPreferences,
  stringifyManifest,
} from '@dolphy-app/engine';
import type {
  ParseResult,
  SettingsStore,
  UserPreferences,
} from '@dolphy-app/engine';
import { EngineError } from '@dolphy-app/engine/app';
import { createDefaultPreferences } from '@dolphy-app/engine/node';
import {
  decodeSchedulerOverrides,
  encodeSavedFilter,
  encodeStudySession,
  parseSavedFilter,
  parseStudySession,
} from '@dolphy-app/engine/scheduler';
import { guard } from './errors.ts';
import type { SqlDatabase } from './sql-database.ts';

const PREFERENCES_KEY = 'user_preferences';
const SCHEDULER_OVERRIDES_KEY = 'scheduler_overrides';
const UI_KEY = 'ui';
const LEARNING_KEY = 'learning';
const EXTENSIONS_KEY = 'extensions';
const UPDATE_CHECK_KEY = 'extensions_update_checked_at';
const LEGACY_IMPORT_KEY = 'legacy_settings_imported';

/** Итог `importLegacySettings`. */
export interface LegacyImportReport {
  /** `false` — импорт уже выполнялся раньше, ничего не тронуто. */
  imported: boolean;
  /** Предпочтения перенесены (в старом хранилище они отличались от умолчаний). */
  preferences: boolean;
  filters: number;
  sessions: number;
  /** Записи, чей `id` уже есть в БД: в БД остаётся её версия. */
  skipped: number;
}

export interface SqliteSettingsStore extends SettingsStore {
  /**
   * Одноразовый перенос настроек из прежнего файлового хранилища
   * (`user_preferences.json`, `filters/`, `study_sessions/`). Старое
   * читается целиком до записи, запись — одной транзакцией: битый файл — отказ
   * без частичного переноса и без отметки «выполнено», так что после
   * исправления импорт можно повторить. То, что уже есть в БД, не
   * перезаписывается. Файлы не удаляются.
   */
  importLegacySettings(legacy: SettingsStore): Promise<LegacyImportReport>;
}

interface Collection<T extends { id: string }> {
  table: 'saved_filter' | 'study_session';
  parse: (raw: unknown) => ParseResult<T>;
  encode: (value: T) => T;
}

interface Repository<T> {
  list(): Promise<T[]>;
  save(value: T): Promise<void>;
  remove(id: string): Promise<boolean>;
  /** Синхронная запись: для транзакции импорта. */
  put(value: T): void;
  has(id: string): boolean;
}

const corrupt = (subject: string, reason: string) =>
  new EngineError('STORE_CORRUPT', {
    message: `Invalid stored settings (${subject}): ${reason}`,
    details: { subject, reason },
  });

const parseJson = (subject: string, text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw corrupt(subject, error instanceof Error ? error.message : 'JSON');
  }
};

const parseBody = <T>(
  subject: string,
  text: string,
  parse: (raw: unknown) => ParseResult<T>,
): T => {
  const result = parse(parseJson(subject, text));
  if (result.ok) return result.value;
  throw corrupt(
    subject,
    result.issues.map(({ path, message }) => `${path}: ${message}`).join('; '),
  );
};

const encodePreferences = (preferences: UserPreferences) =>
  stringifyManifest(encodeUserPreferences(preferences));

/**
 * Настройки ученика в `engine.db`: значения — JSON в `setting`, фильтры и
 * сессии — по строке на запись. Порядок списков — по `id` в кодовых точках
 * (BINARY-сортировка TEXT совпадает с байтовым порядком UTF-8). Использует
 * соединение хранилища журнала и не закрывает его.
 */
export const createSqliteSettingsStore = (
  db: SqlDatabase,
): SqliteSettingsStore => {
  const readSetting = db.prepare<{ value: string }>(
    'SELECT value FROM setting WHERE key = ?',
  );
  const writeSetting = db.prepare(
    `INSERT INTO setting (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );

  const getSetting = (key: string): unknown => {
    const row = guard(() => readSetting.get(key));
    return row === undefined ? undefined : parseJson(key, row.value);
  };
  const putSetting = (key: string, text: string) =>
    guard(() => void writeSetting.run(key, text));

  const collection = <T extends { id: string }>(
    definition: Collection<T>,
  ): Repository<T> => {
    const { table, parse, encode } = definition;
    const selectAll = db.prepare<{ id: string; body: string }>(
      `SELECT id, body FROM ${table} ORDER BY id`,
    );
    const selectId = db.prepare(`SELECT 1 AS found FROM ${table} WHERE id = ?`);
    const upsert = db.prepare(
      `INSERT INTO ${table} (id, body) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET body = excluded.body`,
    );
    const deleteById = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
    const put = (value: T) => {
      if (value.id === '') {
        throw new EngineError('INVALID_ARGUMENT', {
          message: 'id must not be empty',
          details: { table },
        });
      }
      const body = stringifyManifest(encode(value));
      guard(() => void upsert.run(value.id, body));
    };
    return {
      list: async () =>
        guard(() =>
          selectAll
            .all()
            .map(({ id, body }) => parseBody(`${table}:${id}`, body, parse)),
        ),
      save: async (value) => put(value),
      remove: async (id) => guard(() => deleteById.run(id).changes > 0),
      put,
      has: (id) => guard(() => selectId.get(id) !== undefined),
    };
  };

  const filters = collection<SavedFilterDto>({
    table: 'saved_filter',
    parse: parseSavedFilter,
    encode: encodeSavedFilter,
  });
  const sessions = collection<StudySessionWire>({
    table: 'study_session',
    parse: parseStudySession,
    encode: encodeStudySession,
  });

  const importLegacySettings = async (
    legacy: SettingsStore,
  ): Promise<LegacyImportReport> => {
    const alreadyImported =
      guard(() => readSetting.get(LEGACY_IMPORT_KEY)) !== undefined;
    if (alreadyImported) {
      return {
        imported: false,
        preferences: false,
        filters: 0,
        sessions: 0,
        skipped: 0,
      };
    }
    const preferences = await legacy.loadPreferences();
    const legacyFilters = await legacy.listFilters();
    const legacySessions = await legacy.listSessions();

    return guard(() =>
      db.transaction(() => {
        const encodedPreferences = encodePreferences(preferences);
        const carriesPreferences =
          encodedPreferences !== encodePreferences(createDefaultPreferences());
        const hasPreferences = readSetting.get(PREFERENCES_KEY) !== undefined;
        const importPreferences = carriesPreferences && !hasPreferences;
        if (importPreferences) putSetting(PREFERENCES_KEY, encodedPreferences);

        const report: LegacyImportReport = {
          imported: true,
          preferences: importPreferences,
          filters: 0,
          sessions: 0,
          skipped: 0,
        };
        for (const filter of legacyFilters) {
          if (filters.has(filter.id)) report.skipped++;
          else {
            filters.put(filter);
            report.filters++;
          }
        }
        for (const session of legacySessions) {
          if (sessions.has(session.id)) report.skipped++;
          else {
            sessions.put(session);
            report.sessions++;
          }
        }
        putSetting(LEGACY_IMPORT_KEY, JSON.stringify(report));
        return report;
      }),
    );
  };

  return {
    loadPreferences: async (): Promise<UserPreferences> => {
      const row = guard(() => readSetting.get(PREFERENCES_KEY));
      return row === undefined
        ? createDefaultPreferences()
        : parseBody(PREFERENCES_KEY, row.value, parseUserPreferences);
    },
    savePreferences: async (preferences) =>
      putSetting(PREFERENCES_KEY, encodePreferences(preferences)),
    listFilters: filters.list,
    saveFilter: filters.save,
    deleteFilter: filters.remove,
    listSessions: sessions.list,
    saveSession: sessions.save,
    deleteSession: sessions.remove,
    loadSchedulerOverrides: async (): Promise<
      DeepPartial<SchedulerOptionsDto>
    > => decodeSchedulerOverrides(getSetting(SCHEDULER_OVERRIDES_KEY)),
    saveSchedulerOverrides: async (overrides) =>
      putSetting(SCHEDULER_OVERRIDES_KEY, JSON.stringify(overrides)),
    loadUi: async (): Promise<UiSettingsDto> =>
      decodeUiSettings(getSetting(UI_KEY)),
    saveUi: async (ui) => putSetting(UI_KEY, JSON.stringify(ui)),
    loadLearning: async (): Promise<LearningSettingsDto> =>
      decodeLearningSettings(getSetting(LEARNING_KEY)),
    saveLearning: async (learning) =>
      putSetting(LEARNING_KEY, JSON.stringify(learning)),
    loadExtensions: async (): Promise<ExtensionSettingsDto> =>
      decodeExtensionSettings(getSetting(EXTENSIONS_KEY)),
    saveExtensions: async (extensions) =>
      putSetting(EXTENSIONS_KEY, JSON.stringify(extensions)),
    loadUpdateCheckedAt: async () =>
      decodeUpdateCheckedAt(getSetting(UPDATE_CHECK_KEY)),
    saveUpdateCheckedAt: async (at) =>
      putSetting(UPDATE_CHECK_KEY, JSON.stringify(at)),
    importLegacySettings,
  };
};
