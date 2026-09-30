/**
 * Настройки ученика на диске (`dataDir/settings`): `user_preferences.json`,
 * `filters/*.json`, `study_sessions/*.json` — wire Trane, JSON с двумя
 * пробелами и `\n` в конце, запись атомарная (engine-ts.md §5.3); свои
 * файлы движка — `scheduler_overrides.json`, `ui.json`, `learning.json` и `extensions.json`.
 *
 * Отличия от `LocalFilterManager`/`LocalStudySessionManager` Trane, где
 * читается каждая запись каталога (`.DS_Store` ломает открытие): здесь
 * читаются только регулярные файлы `*.json` без ведущей точки; подкаталоги,
 * скрытые и `*.tmp` игнорируются. Идентификатор берётся из содержимого,
 * имя файла контрактом не является. Битый файл и дубль id — ошибка, как в
 * Trane (`read_bad_file_format`, `filters_repeated_ids`).
 */
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  DeepPartial,
  SavedFilterDto,
  SchedulerOptionsDto,
  StudySessionWire,
  ExtensionSettingsDto,
  LearningSettingsDto,
  UiSettingsDto,
} from '@spirula/engine-contract';
import { parseUserPreferences } from '../domain/manifest-schema.ts';
import type { ParseResult } from '../domain/manifest-schema.ts';
import {
  encodeUserPreferences,
  stringifyManifest,
} from '../domain/manifest-schema.ts';
import { decodeExtensionSettings } from '../domain/extension-settings.ts';
import { decodeLearningSettings } from '../domain/learning-settings.ts';
import { decodeUiSettings } from '../domain/ui-settings.ts';
import type { UserPreferences } from '../domain/manifest.ts';
import type { Logger, SettingsStore } from '../ports/index.ts';
import { decodeSchedulerOverrides } from '../scheduler/options.ts';
import {
  encodeSavedFilter,
  encodeStudySession,
  parseSavedFilter,
  parseStudySession,
} from '../scheduler/filter-codec.ts';
import { writeTextAtomic } from './atomic-write.ts';
import {
  compareCodePoints,
  createDefaultPreferences,
} from './settings-common.ts';

const PREFERENCES_FILE = 'user_preferences.json';
const SCHEDULER_OVERRIDES_FILE = 'scheduler_overrides.json';
const UI_FILE = 'ui.json';
const LEARNING_FILE = 'learning.json';
const EXTENSIONS_FILE = 'extensions.json';
const FILTERS_DIR = 'filters';
const SESSIONS_DIR = 'study_sessions';
const JSON_EXTENSION = '.json';
const encoder = new TextEncoder();

export class SettingsStoreError extends Error {
  readonly path: string;

  constructor(message: string, path: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SettingsStoreError';
    this.path = path;
  }
}

export interface JsonSettingsStoreDeps {
  /** `dataDir/settings`. */
  dir: string;
  logger?: Logger;
}

interface Entry<T> {
  path: string;
  value: T;
}

interface Collection<T extends { id: string }> {
  dir: string;
  parse: (raw: unknown) => ParseResult<T>;
  encode: (value: T) => T;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const fail = (action: string, path: string, cause: unknown) =>
  cause instanceof SettingsStoreError
    ? cause
    : new SettingsStoreError(
        `${action} ${path}: ${errorMessage(cause)}`,
        path,
        {
          cause,
        },
      );

const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';

/** `[A-Za-z0-9_-]` как есть, остальные байты UTF-8 — `%XX`. */
export const canonicalFileName = (id: string): string => {
  let out = '';
  for (const byte of encoder.encode(id)) {
    const char = String.fromCharCode(byte);
    out += /[A-Za-z0-9_-]/.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return `${out}${JSON_EXTENSION}`;
};

const isSettingsFile = (name: string) =>
  name.endsWith(JSON_EXTENSION) && !name.startsWith('.');

export const createJsonSettingsStore = ({
  dir,
  logger,
}: JsonSettingsStoreDeps): SettingsStore => {
  const readJson = async (path: string): Promise<unknown> => {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      throw fail('cannot read', path, error);
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw fail('invalid JSON in', path, error);
    }
  };

  const parseFile = async <T>(
    path: string,
    parse: (raw: unknown) => ParseResult<T>,
  ): Promise<T> => {
    const result = parse(await readJson(path));
    if (result.ok) return result.value;
    const detail = result.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('; ');
    throw new SettingsStoreError(
      `invalid settings file ${path}: ${detail}`,
      path,
    );
  };

  /** Все читаемые файлы коллекции, по имени файла; нет каталога — пусто. */
  const scan = async <T extends { id: string }>(
    collection: Collection<T>,
  ): Promise<Entry<T>[]> => {
    let dirents;
    try {
      dirents = await readdir(collection.dir, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw fail('cannot read directory', collection.dir, error);
    }
    const names: string[] = [];
    for (const dirent of dirents) {
      if (dirent.isFile() && isSettingsFile(dirent.name)) {
        names.push(dirent.name);
      } else {
        logger?.debug(
          { dir: collection.dir, name: dirent.name },
          'ignored non-settings entry',
        );
      }
    }
    names.sort(compareCodePoints);
    const entries: Entry<T>[] = [];
    for (const name of names) {
      const path = join(collection.dir, name);
      entries.push({ path, value: await parseFile(path, collection.parse) });
    }
    return entries;
  };

  const list = async <T extends { id: string }>(
    collection: Collection<T>,
  ): Promise<T[]> => {
    const entries = await scan(collection);
    const seen = new Map<string, string>();
    for (const { path, value } of entries) {
      const first = seen.get(value.id);
      if (first !== undefined) {
        throw new SettingsStoreError(
          `duplicate id ${JSON.stringify(value.id)} in ${first} and ${path}`,
          path,
        );
      }
      seen.set(value.id, path);
    }
    return entries
      .map((entry) => entry.value)
      .sort((a, b) => compareCodePoints(a.id, b.id));
  };

  const save = async <T extends { id: string }>(
    collection: Collection<T>,
    value: T,
  ): Promise<void> => {
    if (value.id === '') {
      throw new SettingsStoreError('id must not be empty', collection.dir);
    }
    const entries = await scan(collection);
    const [existing, ...duplicates] = entries.filter(
      (entry) => entry.value.id === value.id,
    );
    let target = existing?.path;
    if (target === undefined) {
      // Каноническое имя мог занять чужой файл (в том числе, на файловой
      // системе без учёта регистра); `~` не входит в канонический алфавит.
      const taken = new Set(entries.map((e) => e.path.toLowerCase()));
      const base = canonicalFileName(value.id).slice(0, -JSON_EXTENSION.length);
      let name = `${base}${JSON_EXTENSION}`;
      for (
        let n = 1;
        taken.has(join(collection.dir, name).toLowerCase());
        n++
      ) {
        name = `${base}~${n}${JSON_EXTENSION}`;
      }
      target = join(collection.dir, name);
    }
    try {
      await writeTextAtomic(
        target,
        stringifyManifest(collection.encode(value)),
      );
      // Остатки дублей одного id: после записи id единственный.
      for (const duplicate of duplicates) await rm(duplicate.path);
    } catch (error) {
      throw fail('cannot write', target, error);
    }
  };

  const remove = async <T extends { id: string }>(
    collection: Collection<T>,
    id: string,
  ): Promise<boolean> => {
    const matches = (await scan(collection)).filter(
      (entry) => entry.value.id === id,
    );
    for (const { path } of matches) {
      try {
        await rm(path);
      } catch (error) {
        throw fail('cannot delete', path, error);
      }
    }
    return matches.length > 0;
  };

  const filters: Collection<SavedFilterDto> = {
    dir: join(dir, FILTERS_DIR),
    parse: parseSavedFilter,
    encode: encodeSavedFilter,
  };
  const sessions: Collection<StudySessionWire> = {
    dir: join(dir, SESSIONS_DIR),
    parse: parseStudySession,
    encode: encodeStudySession,
  };
  const preferencesPath = join(dir, PREFERENCES_FILE);
  const overridesPath = join(dir, SCHEDULER_OVERRIDES_FILE);
  const uiPath = join(dir, UI_FILE);
  const learningPath = join(dir, LEARNING_FILE);
  const extensionsPath = join(dir, EXTENSIONS_FILE);

  /** Нет файла — `null`: значения по умолчанию решает вызывающий. */
  const readOptionalJson = async (path: string): Promise<unknown> => {
    try {
      return await readJson(path);
    } catch (error) {
      if (error instanceof SettingsStoreError && isMissing(error.cause)) {
        return null;
      }
      throw error;
    }
  };

  const writeJson = async (path: string, value: unknown): Promise<void> => {
    try {
      await writeTextAtomic(path, stringifyManifest(value));
    } catch (error) {
      throw fail('cannot write', path, error);
    }
  };

  return {
    loadPreferences: async (): Promise<UserPreferences> => {
      try {
        return await parseFile(preferencesPath, parseUserPreferences);
      } catch (error) {
        if (error instanceof SettingsStoreError && isMissing(error.cause)) {
          return createDefaultPreferences();
        }
        throw error;
      }
    },
    savePreferences: async (preferences) => {
      try {
        await writeTextAtomic(
          preferencesPath,
          stringifyManifest(encodeUserPreferences(preferences)),
        );
      } catch (error) {
        throw fail('cannot write', preferencesPath, error);
      }
    },
    listFilters: () => list(filters),
    saveFilter: (filter) => save(filters, filter),
    deleteFilter: (id) => remove(filters, id),
    listSessions: () => list(sessions),
    saveSession: (session) => save(sessions, session),
    deleteSession: (id) => remove(sessions, id),
    loadSchedulerOverrides: async (): Promise<
      DeepPartial<SchedulerOptionsDto>
    > => decodeSchedulerOverrides(await readOptionalJson(overridesPath)),
    saveSchedulerOverrides: (overrides) => writeJson(overridesPath, overrides),
    loadUi: async (): Promise<UiSettingsDto> =>
      decodeUiSettings(await readOptionalJson(uiPath)),
    saveUi: (ui) => writeJson(uiPath, ui),
    loadLearning: async (): Promise<LearningSettingsDto> =>
      decodeLearningSettings(await readOptionalJson(learningPath)),
    saveLearning: (learning) => writeJson(learningPath, learning),
    loadExtensions: async (): Promise<ExtensionSettingsDto> =>
      decodeExtensionSettings(await readOptionalJson(extensionsPath)),
    saveExtensions: (extensions) => writeJson(extensionsPath, extensions),
  };
};
