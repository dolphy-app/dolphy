/**
 * Параметры `engine.exercise.spec` вида `dolphy.sql`: `fixture` и `expected` — пути от корня библиотеки, `reference` —
 * эталонное решение (читает компилятор при `--run-checks`, не раннер),
 * остальное — правила сравнения и лимиты.
 */
import type { CourseSource } from '@dolphy-app/engine/ports';
import type { CompareOptions } from './types.ts';

export interface SqlCheckParams {
  fixture: string;
  expected: string;
  reference?: string;
  compare: CompareOptions;
  maxRows?: number;
  maxBytes?: number;
}

export type ParamsResult =
  | { ok: true; params: SqlCheckParams }
  | { ok: false; code: 'fixture_error' | 'expected_error'; message: string };

/** Потолки лимитов, которые автор курса может запросить. */
export const HARD_MAX_ROWS = 100_000;
export const HARD_MAX_BYTES = 10_000_000;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isSafePath = (path: string): boolean =>
  path !== '' &&
  !path.startsWith('/') &&
  !path.includes('\\') &&
  !path.includes('\0') &&
  !/^[A-Za-z]:/u.test(path) &&
  !path.split('/').includes('..');

const positiveInt = (value: unknown, ceiling: number): number | null =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value > 0 &&
  value <= ceiling
    ? value
    : null;

const bad = (
  code: 'fixture_error' | 'expected_error',
  message: string,
): ParamsResult => ({ ok: false, code, message });

/** Разбирает `spec`; ошибка — баг курса (`error/*_error`, не вина ученика). */
export const parseSpec = (spec: unknown): ParamsResult => {
  if (!isPlainRecord(spec)) {
    return bad('fixture_error', 'exercise has no spec');
  }
  const { fixture, expected, reference } = spec;
  if (typeof fixture !== 'string' || !isSafePath(fixture)) {
    return bad('fixture_error', 'spec.fixture must be a library path');
  }
  if (typeof expected !== 'string' || !isSafePath(expected)) {
    return bad('expected_error', 'spec.expected must be a library path');
  }
  if (
    reference !== undefined &&
    (typeof reference !== 'string' || !isSafePath(reference))
  ) {
    return bad('expected_error', 'spec.reference must be a library path');
  }
  const compare: CompareOptions = {};
  const { orderSensitive, ignoreColumnNames, numericTolerance, columnOrder } =
    spec;
  if (orderSensitive !== undefined) {
    if (typeof orderSensitive !== 'boolean') {
      return bad('expected_error', 'spec.orderSensitive must be boolean');
    }
    compare.orderSensitive = orderSensitive;
  }
  if (ignoreColumnNames !== undefined) {
    if (typeof ignoreColumnNames !== 'boolean') {
      return bad('expected_error', 'spec.ignoreColumnNames must be boolean');
    }
    compare.ignoreColumnNames = ignoreColumnNames;
  }
  if (numericTolerance !== undefined) {
    if (
      typeof numericTolerance !== 'number' ||
      !Number.isFinite(numericTolerance) ||
      numericTolerance < 0
    ) {
      return bad(
        'expected_error',
        'spec.numericTolerance must be a number >= 0',
      );
    }
    compare.numericTolerance = numericTolerance;
  }
  if (columnOrder !== undefined) {
    if (columnOrder !== 'strict' && columnOrder !== 'any') {
      return bad(
        'expected_error',
        "spec.columnOrder must be 'strict' or 'any'",
      );
    }
    compare.columnOrder = columnOrder;
  }
  const params: SqlCheckParams = { fixture, expected, compare };
  if (reference !== undefined) params.reference = reference as string;
  for (const [key, ceiling] of [
    ['maxRows', HARD_MAX_ROWS],
    ['maxBytes', HARD_MAX_BYTES],
  ] as const) {
    const raw = spec[key];
    if (raw === undefined) continue;
    const value = positiveInt(raw, ceiling);
    if (value === null) {
      return bad(
        'expected_error',
        `spec.${key} must be an integer in 1..${ceiling}`,
      );
    }
    params[key] = value;
  }
  return { ok: true, params };
};

const CACHE_CAPACITY = 256;

/** Ошибка чтения файла курса: путь и причина без содержимого. */
export class CourseFileError extends Error {}

export interface TextCache {
  read(path: string): Promise<string>;
}

/**
 * Читает файлы библиотеки с кэшем по отпечатку `stat`: проверка обходится
 * дешевле повторного чтения (1 000 проверок ≤ 1 с), а правка файла автором
 * подхватывается сразу. Ёмкость ограничена, вытесняется самая старая.
 */
export const createTextCache = (
  source: Pick<CourseSource, 'readText' | 'stat'>,
): TextCache => {
  const entries = new Map<string, { fingerprint: string; text: string }>();
  const read = async (path: string): Promise<string> => {
    const stat = await source.stat(path).catch(() => null);
    if (stat === null || stat.kind !== 'file') {
      throw new CourseFileError(`file not found: ${path}`);
    }
    if (stat.outsideRoot === true) {
      throw new CourseFileError(`path leaves the library: ${path}`);
    }
    const fingerprint = `${stat.bytes}:${stat.mtimeMs}:${stat.ctimeMs ?? 0}:${stat.ino ?? 0}`;
    const cached = entries.get(path);
    if (cached?.fingerprint === fingerprint) return cached.text;
    let text: string;
    try {
      text = await source.readText(path);
    } catch {
      throw new CourseFileError(`file cannot be read: ${path}`);
    }
    entries.delete(path);
    if (entries.size >= CACHE_CAPACITY) {
      const [oldest] = entries.keys();
      if (oldest !== undefined) entries.delete(oldest);
    }
    entries.set(path, { fingerprint, text });
    return text;
  };
  return { read };
};
