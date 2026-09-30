import { join } from 'node:path';
import Database from 'better-sqlite3';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface JournalRow {
  device_id: string;
  seq: number;
  id: string;
  kind: string;
  at: number;
  recorded_at: number;
  unit_id: string;
  grade: number | null;
  source: string | null;
}

const open = (userData: string, readonly: boolean) =>
  new Database(join(userData, 'data', 'engine.db'), {
    readonly,
    fileMustExist: true,
  });

/** Журнал попыток в порядке записи (чтение, приложение может быть запущено). */
export const readJournal = (userData: string): JournalRow[] => {
  const db = open(userData, true);
  try {
    return db
      .prepare(
        `select device_id, seq, id, kind, at, recorded_at, unit_id, grade, source
         from log_entry order by device_id, seq`,
      )
      .all() as JournalRow[];
  } finally {
    db.close();
  }
};

export const readSetting = (userData: string, key: string): unknown => {
  const db = open(userData, true);
  try {
    const row = db
      .prepare('select value from setting where key = ?')
      .get(key) as { value: string } | undefined;
    return row === undefined ? undefined : JSON.parse(row.value);
  } finally {
    db.close();
  }
};

/**
 * «Проходят дни»: все записи журнала сдвигаются в прошлое, как если бы
 * попытки были сделаны `days` суток назад. Порядок записей не меняется,
 * поэтому движок, перечитав журнал при запуске, видит забывание. Только для
 * закрытого приложения и только для временной БД e2e: журнал приложения
 * append-only.
 */
export const shiftJournalBack = (userData: string, days: number) => {
  const db = open(userData, false);
  try {
    db.prepare(
      'update log_entry set at = at - @ms, recorded_at = recorded_at - @ms',
    ).run({ ms: days * DAY_MS });
  } finally {
    db.close();
  }
};
