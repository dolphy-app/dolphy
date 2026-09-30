import type { RepositoryRecord, RepositoryStore } from '@spirula/engine/ports';
import { EngineError } from '@spirula/engine/app';
import { guard } from './errors.ts';
import type { SqlDatabase } from './sql-database.ts';

const corrupt = (id: string, reason: string) =>
  new EngineError('STORE_CORRUPT', {
    message: `Invalid stored repository (${id}): ${reason}`,
    details: { subject: `repository:${id}`, reason },
  });

const parseBody = (id: string, body: string): RepositoryRecord => {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (error) {
    throw corrupt(id, error instanceof Error ? error.message : 'JSON');
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { id?: unknown }).id !== id
  ) {
    throw corrupt(id, 'id mismatch');
  }
  return value as RepositoryRecord;
};

/**
 * Реестр репозиториев в `engine.db`: строка на запись, тело — JSON
 * `RepositoryRecord`. Порядок — по `id` (BINARY-сортировка TEXT). Использует
 * соединение хранилища журнала и не закрывает его.
 */
export const createSqliteRepositoryStore = (
  db: SqlDatabase,
): RepositoryStore => {
  const selectAll = db.prepare<{ id: string; body: string }>(
    'SELECT id, body FROM repository ORDER BY id',
  );
  const upsert = db.prepare(
    `INSERT INTO repository (id, body) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET body = excluded.body`,
  );
  const deleteById = db.prepare('DELETE FROM repository WHERE id = ?');
  return {
    list: async () =>
      guard(() => selectAll.all().map(({ id, body }) => parseBody(id, body))),
    put: async (record) => {
      if (record.id === '') {
        throw new EngineError('INVALID_ARGUMENT', {
          message: 'id must not be empty',
          details: { table: 'repository' },
        });
      }
      const body = JSON.stringify(record);
      guard(() => void upsert.run(record.id, body));
    },
    delete: async (id) => guard(() => deleteById.run(id).changes > 0),
  };
};
