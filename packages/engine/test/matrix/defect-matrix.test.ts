/**
 * T-32: каждый внесённый дефект найден компилятором с ожидаемым кодом и
 * файлом (строка — где детерминирована); чистая библиотека молчит; негативы
 * (безобидные заглушки frontmatter, `nonAncestor`, пороги гранулярности)
 * не порождают диагностик. Синтетика 3000 уроков × 4 упражнения.
 */
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMatrix } from '../helpers/matrix.ts';
import type { Layout } from '../helpers/defects.ts';
import type { MatrixResult } from '../helpers/matrix.ts';

const MIN_CHECKED = 52;

const rootMasksChmod = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'chmod-probe-'));
  const file = join(dir, 'probe');
  writeFileSync(file, 'x');
  chmodSync(file, 0o000);
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();
const TIMEOUT_MS = 120_000;

// матрица строится один раз на раскладку: чтение 3000×4 файлов — секунды
const results = new Map<Layout, Promise<MatrixResult>>();
const getResult = (layout: Layout) => {
  let result = results.get(layout);
  if (result === undefined) {
    result = runMatrix(layout);
    results.set(layout, result);
  }
  return result;
};

describe.each(['kb', 'json'] as const)('T-32 матрица: %s', (layout) => {
  const run = () => getResult(layout);

  it(
    'чистая библиотека: 0 warning и 0 error',
    async () => {
      const { cleanNonInfo } = await run();
      expect(cleanNonInfo).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    'каждый дефект найден с ожидаемыми кодом, файлом и строкой',
    async () => {
      const { rows, injected } = await run();
      expect(rows).toHaveLength(injected.expect.length);
      expect(rows.filter(({ found }) => !found)).toEqual([]);
      expect(rows.filter(({ found, lineOk }) => found && !lineOk)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    'нет неожиданных warning/error и негативы молчат',
    async () => {
      const { unexplained, violated } = await run();
      expect(unexplained).toEqual([]);
      expect(violated).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    'дефектная библиотека действительно содержит ошибки',
    async () => {
      const { defectiveErrors } = await run();
      expect(defectiveErrors).toBeGreaterThan(0);
    },
    TIMEOUT_MS,
  );
});

describe('матрица: состав (T-32)', () => {
  it(
    'KB: 32 исходных дефекта и 3 на W_GRANULARITY; JSON: 16 и 3',
    async () => {
      const [kb, json] = await Promise.all([
        getResult('kb'),
        getResult('json'),
      ]);
      const granularity = (r: MatrixResult) =>
        r.injected.expect.filter(({ code }) => code === 'W_GRANULARITY').length;
      expect(granularity(kb)).toBe(3);
      expect(granularity(json)).toBe(3);
      // для root chmod 000 не закрывает файл: дефект «нечитаемый файл» в
      // каждой раскладке не вносится (см. `isUnreadable` в helpers/defects)
      const masked = rootMasksChmod ? 1 : 0;
      expect(kb.injected.expect.length - granularity(kb)).toBe(32 - masked);
      expect(json.injected.expect.length - granularity(json)).toBe(16 - masked);
      const checked = (r: MatrixResult) =>
        r.injected.expect.length + r.injected.mustNot.length;
      expect(checked(kb) + checked(json)).toBeGreaterThanOrEqual(MIN_CHECKED);
    },
    TIMEOUT_MS,
  );
});
