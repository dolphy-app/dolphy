/** Разбор `spec` вида lms.sql и кэш файлов библиотеки. */
import { describe, expect, it } from 'vitest';
import {
  createTextCache,
  isSafePath,
  parseSpec,
} from '../../src/verification-params.ts';
import { createFilesSource } from '../helpers/files-source.ts';

const valid = { fixture: 'f/emp.sql', expected: 'c/a.csv' };

describe('parseSpec', () => {
  it('минимальный блок и все необязательные поля', () => {
    expect(parseSpec(valid)).toEqual({
      ok: true,
      params: { fixture: 'f/emp.sql', expected: 'c/a.csv', compare: {} },
    });
    const full = parseSpec({
      ...valid,
      reference: 'solutions/a.sql',
      orderSensitive: true,
      ignoreColumnNames: true,
      numericTolerance: 0,
      columnOrder: 'any',
      maxRows: 50,
      maxBytes: 4096,
    });
    expect(full).toEqual({
      ok: true,
      params: {
        fixture: 'f/emp.sql',
        expected: 'c/a.csv',
        reference: 'solutions/a.sql',
        compare: {
          orderSensitive: true,
          ignoreColumnNames: true,
          numericTolerance: 0,
          columnOrder: 'any',
        },
        maxRows: 50,
        maxBytes: 4096,
      },
    });
  });

  it('нет блока или нет fixture — fixture_error; нет expected или кривые правила — expected_error', () => {
    expect(parseSpec(undefined)).toMatchObject({
      ok: false,
      code: 'fixture_error',
    });
    expect(parseSpec({ expected: 'a.csv' })).toMatchObject({
      ok: false,
      code: 'fixture_error',
    });
    expect(parseSpec({ fixture: 'a.sql' })).toMatchObject({
      ok: false,
      code: 'expected_error',
    });
    for (const bad of [
      { orderSensitive: 'yes' },
      { ignoreColumnNames: 1 },
      { numericTolerance: -1 },
      { numericTolerance: Number.NaN },
      { columnOrder: 'random' },
      { maxRows: 0 },
      { maxRows: 1e9 },
      { maxBytes: 1.5 },
      { reference: 5 },
    ]) {
      expect(
        parseSpec({ ...valid, ...bad }),
        JSON.stringify(bad),
      ).toMatchObject({ ok: false, code: 'expected_error' });
    }
  });

  it('пути только относительные и внутри библиотеки', () => {
    for (const path of [
      '/etc/passwd',
      '../x.sql',
      'a/../../x',
      'a\\b',
      'C:x',
      '',
    ]) {
      expect(isSafePath(path), path).toBe(false);
      expect(parseSpec({ ...valid, fixture: path }), path).toMatchObject({
        ok: false,
        code: 'fixture_error',
      });
    }
    expect(isSafePath('fixtures/emp.sql')).toBe(true);
  });
});

describe('кэш файлов библиотеки', () => {
  it('читает файл один раз, пока отпечаток stat не изменился; правка подхватывается', async () => {
    const source = createFilesSource({ 'a.sql': 'one' });
    const cache = createTextCache(source);
    expect(await cache.read('a.sql')).toBe('one');
    expect(await cache.read('a.sql')).toBe('one');
    expect(source.reads).toEqual(['a.sql']);
    source.set('a.sql', 'two!');
    expect(await cache.read('a.sql')).toBe('two!');
    expect(source.reads).toEqual(['a.sql', 'a.sql']);
  });

  it('нет файла и путь за корнем — CourseFileError, без содержимого', async () => {
    const cache = createTextCache({
      readText: async () => 'x',
      stat: async (path) =>
        path === 'out'
          ? { kind: 'file', bytes: 1, mtimeMs: 0, outsideRoot: true }
          : null,
    });
    await expect(cache.read('nope')).rejects.toThrow(/not found/u);
    await expect(cache.read('out')).rejects.toThrow(/leaves the library/u);
  });

  it('ёмкость ограничена: старые записи вытесняются', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [`f${i}.sql`, `${i}`]),
    );
    const source = createFilesSource(files);
    const cache = createTextCache(source);
    for (let i = 0; i < 300; i++) await cache.read(`f${i}.sql`);
    await cache.read('f0.sql');
    expect(source.reads.filter((path) => path === 'f0.sql')).toHaveLength(2);
    await cache.read('f299.sql');
    expect(source.reads.filter((path) => path === 'f299.sql')).toHaveLength(1);
  });
});
