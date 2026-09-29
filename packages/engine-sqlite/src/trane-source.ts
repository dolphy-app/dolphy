import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EngineError } from '@lms/engine/app';
import type { TraneSource, TraneTrial } from '@lms/engine/sync';
import { openBetterSqliteDatabase } from './sql-database.ts';

/** Файлы каталога `.trane` (`trane-pristine/src/lib.rs`). */
const PRACTICE_STATS_DB = 'practice_stats.db';
const BLACKLIST_DB = 'blacklist.db';
const REVIEW_LIST_DB = 'review_list.db';

interface TrialRow {
  row_id: number;
  unit_id: string;
  score: number | null;
  timestamp: number | null;
}

const TRIALS_SQL = `SELECT p.id AS row_id, u.unit_id AS unit_id, p.score AS score,
  p.timestamp AS timestamp
  FROM practice_stats p JOIN uids u ON u.unit_uid = p.unit_uid
  ORDER BY p.timestamp, p.id`;

const readRows = <Row>(path: string, sql: string): Row[] => {
  const db = openBetterSqliteDatabase({ path, readOnly: true });
  try {
    return db.prepare<Row>(sql).all();
  } finally {
    db.close();
  }
};

/**
 * Читает `<traneDir>/{practice_stats,blacklist,review_list}.db` целиком в
 * память и сразу закрывает файлы (только чтение, Trane не трогаем). Нет ни
 * одной базы — `NOT_FOUND`; отсутствующая отдельная база — пустой список.
 */
export const readTraneDirectory = (traneDir: string): TraneSource => {
  const stats = join(traneDir, PRACTICE_STATS_DB);
  const blacklist = join(traneDir, BLACKLIST_DB);
  const reviewList = join(traneDir, REVIEW_LIST_DB);
  if (![stats, blacklist, reviewList].some((path) => existsSync(path))) {
    throw new EngineError('NOT_FOUND', { details: { traneDir } });
  }

  const trials: TraneTrial[] = existsSync(stats)
    ? readRows<TrialRow>(stats, TRIALS_SQL).map((row) => ({
        rowId: row.row_id,
        unitId: row.unit_id,
        score: row.score,
        timestampSec: row.timestamp,
      }))
    : [];
  const units = (path: string, table: string): string[] =>
    existsSync(path)
      ? readRows<{ unit_id: string }>(
          path,
          `SELECT unit_id FROM ${table} ORDER BY unit_id`,
        ).map((row) => row.unit_id)
      : [];

  const blacklisted = units(blacklist, 'blacklist');
  const reviewed = units(reviewList, 'review_list');
  return {
    trials: () => trials,
    blacklist: () => blacklisted,
    reviewList: () => reviewed,
  };
};
