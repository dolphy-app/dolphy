import { describe, expect, it } from 'vitest';
import {
  normalizeRepositoryRef,
  normalizeRepositoryUrl,
  repositorySlug,
} from '../../src/app/index.ts';
import { urlHash8 } from '../../src/app/repository-url.ts';

describe('normalizeRepositoryUrl', () => {
  it.each([
    ['https://GitHub.com/Acme/Sql.git', 'https://github.com/Acme/Sql'],
    ['https://github.com/acme/sql/', 'https://github.com/acme/sql'],
    ['  http://host:8080/a/b.git/#frag ', 'http://host:8080/a/b'],
    ['https://host:443/a', 'https://host/a'],
    ['https://host', 'https://host'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeRepositoryUrl(input)).toBe(expected);
  });
});

describe('normalizeRepositoryRef', () => {
  it('treats a missing ref as the default branch', () => {
    for (const empty of [undefined, null, '']) {
      expect(normalizeRepositoryRef(empty)).toBeNull();
    }
    expect(normalizeRepositoryRef('release/1.0')).toBe('release/1.0');
  });

  it.each(['a b', 'a..b', '-x', '/x', 'x/', 'x.lock', 'a@{1}', 'a~1', 'a\tb'])(
    'rejects %j',
    (ref) => {
      expect(() => normalizeRepositoryRef(ref)).toThrow(/valid/);
    },
  );
});

describe('repositorySlug', () => {
  it('joins host and path segments into a safe directory name', () => {
    expect(repositorySlug('https://github.com/Acme/SQL_Course')).toBe(
      'github.com-acme-sql_course',
    );
    expect(repositorySlug('http://127.0.0.1:8080/a b/c')).toBe(
      '127.0.0.1-8080-a-b-c',
    );
  });

  it('never starts with a dot, stays within the length limit and matches the installer alphabet', () => {
    const long = `https://example.com/${'x'.repeat(200)}/${'y'.repeat(10)}`;
    for (const url of [long, 'https://.hidden.example/a', 'https://[::1]/a']) {
      const slug = repositorySlug(url);
      expect(slug).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
      expect(slug.length).toBeLessThanOrEqual(80);
      expect(slug).not.toMatch(/[-.]$/);
    }
  });

  it('hash suffix is the first 8 hex of the SHA-1 of the URL', async () => {
    // sha1('abc') = a9993e36…
    expect(await urlHash8('abc')).toBe('a9993e36');
  });
});
