import type { RepositoryRecord, RepositoryStore } from '../ports/index.ts';

/** `RepositoryStore` в памяти (тесты). Возвращает копии: записи снаружи не меняют реестр. */
export const createMemoryRepositoryStore = (): RepositoryStore => {
  const records = new Map<string, RepositoryRecord>();
  const copy = (record: RepositoryRecord): RepositoryRecord =>
    structuredClone(record);
  return {
    list: async () =>
      [...records.values()]
        .sort((a, b) => Number(a.id > b.id) - Number(a.id < b.id))
        .map(copy),
    put: async (record) => {
      records.set(record.id, copy(record));
    },
    delete: async (id) => records.delete(id),
  };
};
