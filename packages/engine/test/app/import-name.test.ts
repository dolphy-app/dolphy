import { describe, expect, it } from 'vitest';
import { importDirectoryName, importSlug } from '../../src/app/import-name.ts';

describe('importSlug', () => {
  it.each([
    ['My Sheet.csv', 'my-sheet'],
    ['archive.tar.gz', 'archive-tar'],
    ['Курс по SQL.csv', 'kurs-po-sql'],
    ['Щука, ёж и юла.csv', 'shchuka-ezh-i-yula'],
    ['Йод.csv', 'yod'],
    ['Café Résumé.csv', 'cafe-resume'],
    ['  --weird__name!!.csv', 'weird-name'],
    ['noext', 'noext'],
    ['.hidden', 'hidden'],
  ])('%s → %s', (name, slug) => {
    expect(importSlug(name)).toBe(slug);
  });

  it('transliterates names that macOS stores decomposed the same way as composed ones', () => {
    expect(importSlug('Йод.csv'.normalize('NFD'))).toBe('yod');
  });

  it('returns an empty slug when no latin letters or digits remain', () => {
    expect(importSlug('日本語.csv')).toBe('');
    expect(importSlug('???.csv')).toBe('');
  });

  it('cuts long names without a trailing dash', () => {
    const slug = importSlug(`${'a'.repeat(59)}-b${'c'.repeat(50)}.csv`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('importDirectoryName', () => {
  it('joins the extension id and the slug, falling back to "import"', () => {
    expect(importDirectoryName('acme.csv', 'My Sheet.csv')).toBe(
      'acme.csv-my-sheet',
    );
    expect(importDirectoryName('acme.csv', '日本語.csv')).toBe(
      'acme.csv-import',
    );
  });

  it('is stable: the same extension and file name give the same directory', () => {
    expect(importDirectoryName('acme.csv', 'Данные.csv')).toBe(
      importDirectoryName('acme.csv', 'Данные.csv'),
    );
  });

  it('keeps different extensions apart for the same file', () => {
    expect(importDirectoryName('acme.a', 'x.csv')).not.toBe(
      importDirectoryName('acme.b', 'x.csv'),
    );
  });
});
