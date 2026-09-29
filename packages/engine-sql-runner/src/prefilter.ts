/**
 * Префильтр текста ответа. НЕ граница безопасности: он даёт понятное
 * сообщение до SQLite и сокращает поверхность атаки. Запрет исполняют драйвер
 * (authorizer, `query_only`, limits) и процесс (kill). Лексер префильтра ≠
 * лексер SQLite (NBSP, NUL), а `WITH c AS (SELECT 1) DELETE …` его проходит.
 *
 * Снимает комментарии и кавычки, затем требует один оператор (допустима
 * только хвостовая `;`) с первым словом `SELECT | WITH | VALUES`.
 */
export interface PrefilterResult {
  ok: boolean;
  reason?: string;
  code?: 'forbidden' | 'sql_error' | 'sql_too_long';
}

const VERBS: Record<string, true> = {
  INSERT: true,
  UPDATE: true,
  DELETE: true,
  DROP: true,
  CREATE: true,
  ALTER: true,
  ATTACH: true,
  DETACH: true,
  PRAGMA: true,
  VACUUM: true,
  REINDEX: true,
  ANALYZE: true,
  BEGIN: true,
  COMMIT: true,
  END: true,
  ROLLBACK: true,
  SAVEPOINT: true,
  RELEASE: true,
  REPLACE: true,
  EXPLAIN: true,
};

const QUOTES: Record<string, true> = { "'": true, '"': true, '`': true };

/** Заменяет комментарии и литералы пробелом/маркером; O(n) по ограниченному тексту. */
const stripLiterals = (sql: string): string => {
  const parts: string[] = [];
  const n = sql.length;
  let i = 0;
  let plainFrom = 0;
  const flush = (to: number) => {
    if (to > plainFrom) parts.push(sql.slice(plainFrom, to));
  };
  while (i < n) {
    const c = sql.charAt(i);
    const next = sql.charAt(i + 1);
    if (c === '-' && next === '-') {
      flush(i);
      while (i < n && sql.charAt(i) !== '\n') i++;
      parts.push(' ');
      plainFrom = i;
    } else if (c === '/' && next === '*') {
      flush(i);
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      parts.push(' ');
      plainFrom = i;
    } else if (Object.hasOwn(QUOTES, c)) {
      flush(i);
      i++;
      // удвоенная кавычка экранирует; незакрытый литерал тянется до конца
      while (i < n) {
        if (sql.charAt(i) === c) {
          if (sql.charAt(i + 1) === c) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      parts.push(' Q ');
      plainFrom = i;
    } else if (c === '[') {
      flush(i);
      const end = sql.indexOf(']', i + 1);
      i = end < 0 ? n : end + 1;
      parts.push(' Q ');
      plainFrom = i;
    } else {
      i++;
    }
  }
  flush(Math.min(i, n));
  return parts.join('');
};

export const prefilter = (sql: string, maxChars: number): PrefilterResult => {
  if (sql.length > maxChars) {
    return {
      ok: false,
      reason: `SQL longer than ${maxChars} characters`,
      code: 'sql_too_long',
    };
  }
  if (sql.trim() === '') {
    return { ok: false, reason: 'empty statement', code: 'sql_error' };
  }
  if (sql.includes('\0')) {
    return { ok: false, reason: 'NUL byte in SQL', code: 'forbidden' };
  }
  const trimmed = stripLiterals(sql).replace(/[\s;]+$/u, '');
  if (trimmed.includes(';')) {
    return {
      ok: false,
      reason: 'only a single statement is allowed',
      code: 'forbidden',
    };
  }
  const keyword = /^[\s(]*([A-Za-z]+)/u.exec(trimmed)?.[1]?.toUpperCase();
  if (keyword !== 'SELECT' && keyword !== 'WITH' && keyword !== 'VALUES') {
    return {
      ok: false,
      reason: `statement must start with SELECT/WITH/VALUES, got ${keyword ?? 'non-keyword'}`,
      code:
        keyword !== undefined && Object.hasOwn(VERBS, keyword)
          ? 'forbidden'
          : 'sql_error',
    };
  }
  return { ok: true };
};
