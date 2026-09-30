import { describe, expect, it } from 'vitest';
import {
  CatalogFormatError,
  assertNotRolledBack,
  versionFileUrl,
} from '../src/index.ts';

describe('assertNotRolledBack', () => {
  const at = (generatedAt: string) => ({ generatedAt });

  it('нет кэша или индекс новее/равен — проходит', () => {
    expect(() =>
      assertNotRolledBack(null, at('2026-10-01T00:00:00Z')),
    ).not.toThrow();
    expect(() =>
      assertNotRolledBack(
        at('2026-10-01T00:00:00Z'),
        at('2026-10-02T00:00:00Z'),
      ),
    ).not.toThrow();
    expect(() =>
      assertNotRolledBack(
        at('2026-10-01T00:00:00Z'),
        at('2026-10-01T00:00:00Z'),
      ),
    ).not.toThrow();
  });

  it('индекс старше кэша — откат отвергается', () => {
    expect(() =>
      assertNotRolledBack(
        at('2026-10-02T00:00:00Z'),
        at('2026-10-01T00:00:00Z'),
      ),
    ).toThrow(CatalogFormatError);
  });

  it('сравнение по моменту времени, а не по строке (часовые пояса)', () => {
    expect(() =>
      assertNotRolledBack(
        at('2026-10-01T12:00:00Z'),
        at('2026-10-01T13:00:00+03:00'),
      ),
    ).toThrow(CatalogFormatError);
  });
});

describe('versionFileUrl', () => {
  const version = { baseUrl: 'extensions/acme.quiz/1.0.0/' };

  it('собирает адрес относительно index.json на том же origin', () => {
    expect(
      versionFileUrl(
        'https://dolphy-app.github.io/dolphy-extensions/index.json',
        version,
        'main.mjs',
      ).href,
    ).toBe(
      'https://dolphy-app.github.io/dolphy-extensions/extensions/acme.quiz/1.0.0/main.mjs',
    );
  });

  it('работает с локальным http-каталогом', () => {
    expect(
      versionFileUrl('http://127.0.0.1:8080/index.json', version, 'a.json')
        .href,
    ).toBe('http://127.0.0.1:8080/extensions/acme.quiz/1.0.0/a.json');
  });

  it('выход за origin отвергается', () => {
    expect(() =>
      versionFileUrl(
        'https://a.example/index.json',
        { baseUrl: '//evil.example/x/' },
        'a.json',
      ),
    ).toThrow(CatalogFormatError);
  });
});
