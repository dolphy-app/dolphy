import { prepareStorageWrite } from '../app/extension-storage.ts';
import { compareKeys, utf8Length } from '../domain/index.ts';
import type {
  ExtensionDataSpace,
  ExtensionDataStore,
} from '../ports/extension-data.ts';

/** Одно пространство в памяти: JSON-текст на ключ, копии отдаются через `JSON.parse`. */
const createMemorySpace = (): ExtensionDataSpace => {
  const spaces = new Map<string, Map<string, string>>();
  const entries = (extensionId: string): [string, string][] =>
    [...(spaces.get(extensionId) ?? [])].sort(([a], [b]) => compareKeys(a, b));
  return {
    get: async (extensionId, key) => {
      const encoded = spaces.get(extensionId)?.get(key);
      return encoded === undefined ? undefined : JSON.parse(encoded);
    },
    set: async (extensionId, key, value) => {
      const space = spaces.get(extensionId) ?? new Map<string, string>();
      const { encoded } = prepareStorageWrite(extensionId, key, value, () => {
        const existing = space.get(key);
        let totalBytes = 0;
        for (const text of space.values()) totalBytes += utf8Length(text);
        return {
          existingBytes: existing === undefined ? null : utf8Length(existing),
          keys: space.size,
          totalBytes,
        };
      });
      space.set(key, encoded);
      spaces.set(extensionId, space);
    },
    delete: async (extensionId, key) => {
      const space = spaces.get(extensionId);
      const removed = space?.delete(key) ?? false;
      if (space?.size === 0) spaces.delete(extensionId);
      return removed;
    },
    keys: async (extensionId) => entries(extensionId).map(([key]) => key),
    all: async (extensionId) =>
      Object.fromEntries(
        entries(extensionId).map(([key, text]) => [key, JSON.parse(text)]),
      ),
    usage: async (extensionId) => {
      const space = entries(extensionId);
      return {
        keys: space.length,
        bytes: space.reduce((sum, [, text]) => sum + utf8Length(text), 0),
      };
    },
    deleteAll: async (extensionId) => {
      spaces.delete(extensionId);
    },
  };
};

/** `ExtensionDataStore` в памяти (тесты): потолки и копии — как у SQLite-адаптера. */
export const createMemoryExtensionDataStore = (): ExtensionDataStore => {
  const storage = createMemorySpace();
  const settings = createMemorySpace();
  return {
    storage,
    settings,
    deleteAllData: async (extensionId) => {
      await storage.deleteAll(extensionId);
      await settings.deleteAll(extensionId);
    },
  };
};
