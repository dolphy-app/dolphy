import type {
  DeepPartial,
  SavedFilterDto,
  SchedulerOptionsDto,
  StudySessionWire,
  ExtensionSettingsDto,
  LearningSettingsDto,
  UiSettingsDto,
} from '@dolphy-app/engine-contract';
import type { UserPreferences } from '../domain/manifest.ts';
import {
  DEFAULT_EXTENSION_SETTINGS,
  normalizeExtensionSettings,
} from '../domain/extension-settings.ts';
import { DEFAULT_LEARNING_SETTINGS } from '../domain/learning-settings.ts';
import { DEFAULT_UI_SETTINGS } from '../domain/ui-settings.ts';
import type { SettingsStore } from '../ports/index.ts';
import {
  encodeSavedFilter,
  encodeStudySession,
} from '../scheduler/filter-codec.ts';
import {
  compareCodePoints,
  createDefaultPreferences,
} from './settings-common.ts';

export interface MemorySettingsInit {
  preferences?: UserPreferences;
  filters?: readonly SavedFilterDto[];
  sessions?: readonly StudySessionWire[];
  schedulerOverrides?: DeepPartial<SchedulerOptionsDto>;
  ui?: UiSettingsDto;
  learning?: LearningSettingsDto;
  extensions?: ExtensionSettingsDto;
}

const sortedById = <T extends { id: string }>(map: Map<string, T>): T[] =>
  [...map.values()]
    .sort((a, b) => compareCodePoints(a.id, b.id))
    .map((item) => structuredClone(item));

/**
 * Хранилище настроек в памяти: для тестов и встраивания без диска. Данные
 * копируются на входе и выходе, порядок и умолчания — как у JSON-хранилища.
 */
export const createMemorySettingsStore = (
  initial: MemorySettingsInit = {},
): SettingsStore => {
  let preferences = structuredClone(
    initial.preferences ?? createDefaultPreferences(),
  );
  let schedulerOverrides = structuredClone(initial.schedulerOverrides ?? {});
  let ui = structuredClone(initial.ui ?? DEFAULT_UI_SETTINGS);
  let learning = { ...(initial.learning ?? DEFAULT_LEARNING_SETTINGS) };
  let extensions = normalizeExtensionSettings(
    initial.extensions ?? DEFAULT_EXTENSION_SETTINGS,
  );
  let updateCheckedAt: number | null = null;
  const filters = new Map<string, SavedFilterDto>();
  const sessions = new Map<string, StudySessionWire>();
  // `encode*` строит новые объекты целиком: вход не разделяет память с картой.
  const putFilter = (filter: SavedFilterDto) =>
    void filters.set(filter.id, encodeSavedFilter(filter));
  const putSession = (session: StudySessionWire) =>
    void sessions.set(session.id, encodeStudySession(session));
  initial.filters?.forEach(putFilter);
  initial.sessions?.forEach(putSession);

  return {
    loadPreferences: async () => structuredClone(preferences),
    savePreferences: async (next) => {
      preferences = structuredClone(next);
    },
    listFilters: async () => sortedById(filters),
    saveFilter: async (filter) => putFilter(filter),
    deleteFilter: async (id) => filters.delete(id),
    listSessions: async () => sortedById(sessions),
    saveSession: async (session) => putSession(session),
    deleteSession: async (id) => sessions.delete(id),
    loadSchedulerOverrides: async () => structuredClone(schedulerOverrides),
    saveSchedulerOverrides: async (next) => {
      schedulerOverrides = structuredClone(next);
    },
    loadUi: async () => ({ ...ui }),
    saveUi: async (next) => {
      ui = { ...next };
    },
    loadLearning: async () => ({ ...learning }),
    saveLearning: async (next) => {
      learning = { ...next };
    },
    loadExtensions: async () => structuredClone(extensions),
    saveExtensions: async (next) => {
      extensions = normalizeExtensionSettings(next);
    },
    loadUpdateCheckedAt: async () => updateCheckedAt,
    saveUpdateCheckedAt: async (at) => {
      updateCheckedAt = at;
    },
  };
};
