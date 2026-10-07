import { describe, expect, it } from 'vitest';
import {
  ASSET_LIMITS,
  CatalogFormatError,
  fullIndexUrl,
  parseIndex,
  parseIndexLenient,
} from '../src/index.ts';
import type { CatalogIndex } from '../src/index.ts';
import { entry, sha, version } from './fixtures.ts';
import { iconDataUri } from '../src/index.ts';
import { png } from './samples.ts';

const file = (path: string, size = 10) => ({ path, size, sha256: sha('c') });
const manifestFile = file('extension.json');
const ICON = iconDataUri('assets/icon.png', png());

const full = (extensions: unknown[]): unknown => ({
  schemaVersion: 2,
  generatedAt: '2026-10-01T12:00:00Z',
  extensions,
  revoked: [{ id: 'acme.bad', versions: '<1.2.0', reason: 'security' }],
});

const withFiles = (files: unknown[], extra: Record<string, unknown> = {}) =>
  entry({ versions: [version({ files, ...extra } as never)] });

const issuesOf = (raw: unknown): string[] => {
  try {
    parseIndex(raw);
  } catch (error) {
    if (error instanceof CatalogFormatError) return error.issues;
    throw error;
  }
  return [];
};

describe('full index (schemaVersion 2)', () => {
  it('accepts style sheets, images, fonts and an icon', () => {
    const files = [
      manifestFile,
      file('main.mjs'),
      file('assets/panel.css'),
      file('assets/logo.png'),
      file('assets/hero.webp'),
      file('assets/photo.jpg'),
      file('assets/photo2.jpeg'),
      file('assets/mark.svg'),
      file('assets/font.woff2'),
    ];
    const parsed = parseIndex(full([withFiles(files, { icon: ICON })]));
    expect(parsed.extensions[0]?.versions[0]?.icon).toBe(ICON);
  });

  it('allows up to 100 files', () => {
    const many = (count: number) => [
      manifestFile,
      ...Array.from({ length: count - 1 }, (_, i) => file(`a/f${i}.json`)),
    ];
    expect(issuesOf(full([withFiles(many(100))]))).toEqual([]);
    expect(issuesOf(full([withFiles(many(101))]))[0]).toContain('files');
  });

  it('rejects uppercase and unknown extensions', () => {
    expect(
      issuesOf(full([withFiles([manifestFile, file('assets/Logo.PNG')])]))[0],
    ).toContain('files.1.path');
    expect(
      issuesOf(full([withFiles([manifestFile, file('assets/a.gif')])]))[0],
    ).toContain('files.1.path');
    expect(
      issuesOf(full([withFiles([manifestFile, file('assets/a.html')])]))[0],
    ).toContain('files.1.path');
  });

  it('applies the per-type size ceilings', () => {
    const tooBig = (path: string, size: number) =>
      issuesOf(full([withFiles([manifestFile, file(path, size)])]));
    expect(tooBig('a.css', ASSET_LIMITS.css)).toEqual([]);
    expect(tooBig('a.css', ASSET_LIMITS.css + 1)[0]).toContain('a.css');
    expect(tooBig('a.svg', ASSET_LIMITS.svg + 1)).not.toEqual([]);
    expect(tooBig('a.png', ASSET_LIMITS.image + 1)).not.toEqual([]);
    expect(tooBig('a.woff2', ASSET_LIMITS.woff2 + 1)).not.toEqual([]);
    expect(tooBig('a.woff2', ASSET_LIMITS.woff2)).toEqual([]);
  });

  it('rejects an icon that is not a png or webp data URI, or too long', () => {
    const badIcon = (icon: string) =>
      issuesOf(full([withFiles([manifestFile], { icon })]));
    expect(badIcon('https://example.com/i.png')).not.toEqual([]);
    expect(badIcon('data:image/svg+xml;base64,AAAA')).not.toEqual([]);
    expect(badIcon(`${ICON}"><script>`)).not.toEqual([]);
    expect(badIcon(`data:image/png;base64,${'A'.repeat(30_000)}`)).not.toEqual(
      [],
    );
  });

  it('rejects the first format: schemaVersion 1 is not an index', () => {
    const first = { ...(full([entry()]) as object), schemaVersion: 1 };
    expect(issuesOf(first)[0]).toContain('schemaVersion');
  });

  it('accepts titles and tags of the contributions that exist', () => {
    const titled = entry({
      contributes: {
        ...entry().contributes,
        commands: ['acme.quiz.open'],
        markdownRenderers: ['chart'],
      },
      titles: {
        commands: { 'acme.quiz.open': 'Open quiz' },
        exerciseTypes: { 'acme.quiz': 'Quiz' },
        markdownRenderers: { chart: 'Charts' },
      },
      versions: [version({ tags: ['learning', 'productivity'] })],
    });
    const parsed = parseIndex(full([titled])).extensions[0];
    expect(parsed?.titles).toEqual({
      commands: { 'acme.quiz.open': 'Open quiz' },
      exerciseTypes: { 'acme.quiz': 'Quiz' },
      markdownRenderers: { chart: 'Charts' },
    });
    expect(parsed?.versions[0]?.tags).toEqual(['learning', 'productivity']);
  });

  it('rejects titles for ids missing from contributes, bad points and long titles', () => {
    const titled = (titles: unknown) =>
      issuesOf(full([entry({ titles: titles as never })]));
    expect(titled({ themes: { 'acme.ghost': 'Ghost' } })[0]).toContain(
      'titles.themes.acme.ghost',
    );
    expect(titled({ exerciseTypes: { 'acme.ghost': 'Quiz' } })[0]).toContain(
      'titles.exerciseTypes.acme.ghost',
    );
    expect(titled({ events: { 'session.started': 'x' } })).not.toEqual([]);
    expect(titled({ commands: { 'acme.x': 'x'.repeat(61) } })).not.toEqual([]);
    expect(titled({ commands: { 'acme.x': '' } })).not.toEqual([]);
    expect(titled({ themes: { 'Not Valid': 'x' } })).not.toEqual([]);
  });

  it('rejects unknown, duplicate and more than five tags', () => {
    const tagged = (tags: unknown) =>
      issuesOf(full([entry({ versions: [version({ tags: tags as never })] })]));
    expect(tagged(['hologram'])[0]).toContain('tags.0');
    expect(tagged(['theme', 'theme'])[0]).toContain('duplicate tag');
    expect(
      tagged([
        'learning',
        'language',
        'content',
        'theme',
        'interface',
        'developer',
      ]),
    ).not.toEqual([]);
    expect(
      tagged(['learning', 'language', 'content', 'theme', 'interface']),
    ).toEqual([]);
  });
});

describe('parseIndexLenient', () => {
  const good = entry();
  const lenient = (raw: unknown) => parseIndexLenient(raw);

  it('parses a full index without warnings', () => {
    const { index, warnings } = lenient(full([good]));
    expect(warnings).toEqual([]);
    expect(index.extensions).toHaveLength(1);
  });

  it('drops unknown keys at every level', () => {
    const raw = full([
      {
        ...good,
        future: true,
        contributes: { ...good.contributes, gadgets: ['x'] },
        versions: [{ ...version(), signature: 'abc' }],
      },
    ]) as Record<string, unknown>;
    const { index, warnings } = lenient({ ...raw, banner: 'hello' });
    expect(warnings).toEqual([]);
    const parsed = index.extensions[0];
    expect(parsed).not.toHaveProperty('future');
    expect(parsed?.contributes).not.toHaveProperty('gadgets');
    expect(parsed?.versions[0]).not.toHaveProperty('signature');
    expect(index).not.toHaveProperty('banner');
  });

  it('skips an entry it cannot read and keeps the others', () => {
    const { index, warnings } = lenient(
      full([{ ...good, id: 'Not A Valid Id' }, entry({ id: 'acme.other' })]),
    );
    expect(index.extensions.map((e) => e.id)).toEqual(['acme.other']);
    expect(warnings[0]).toContain('extension #0');
  });

  it('skips a version it cannot read and keeps the others of the entry', () => {
    const { index, warnings } = lenient(
      full([
        entry({
          versions: [
            version({ version: '2.0.0', files: [manifestFile, file('a.gif')] }),
            version({ version: '1.0.0' }),
          ],
        }),
      ]),
    );
    expect(index.extensions[0]?.versions.map((v) => v.version)).toEqual([
      '1.0.0',
    ]);
    expect(warnings[0]).toContain("'acme.quiz' version #0");
  });

  it('skips an entry left without versions', () => {
    const { index, warnings } = lenient(
      full([
        entry({
          versions: [version({ version: 'not-a-version' })],
        }),
      ]),
    );
    expect(index.extensions).toEqual([]);
    expect(warnings.at(-1)).toContain('no version could be read');
  });

  it('sorts versions newest first and drops duplicates', () => {
    const { index } = lenient(
      full([
        entry({
          versions: [
            version({ version: '1.0.0' }),
            version({ version: '2.0.0' }),
            version({ version: '2.0.0' }),
          ],
        }),
      ]),
    );
    expect(index.extensions[0]?.versions.map((v) => v.version)).toEqual([
      '2.0.0',
      '1.0.0',
    ]);
  });

  it('rejects the first format as a whole', () => {
    expect(() =>
      lenient({ ...(full([good]) as object), schemaVersion: 1 }),
    ).toThrow(CatalogFormatError);
  });

  it('keeps the entry when its titles are unreadable and drops the titles', () => {
    const { index, warnings } = lenient(
      full([{ ...good, titles: { themes: 'midnight' } }]),
    );
    expect(warnings).toEqual([]);
    expect(index.extensions).toHaveLength(1);
    expect(index.extensions[0]?.titles).toBeUndefined();
  });

  it('reads titles and drops unknown points of the map', () => {
    const { index } = lenient(
      full([
        {
          ...good,
          titles: { themes: { 'acme.dark': 'Dark' }, gadgets: { x: 'y' } },
        },
      ]),
    );
    expect(index.extensions[0]?.titles).toEqual({
      themes: { 'acme.dark': 'Dark' },
    });
  });

  it('drops tags outside its vocabulary, not the version or the entry', () => {
    const { index, warnings } = lenient(
      full([
        entry({
          versions: [
            version({
              version: '2.0.0',
              tags: ['theme', 'hologram', 'theme'] as never,
            }),
            version({ version: '1.0.0', tags: 'theme' as never }),
          ],
        }),
      ]),
    );
    expect(warnings).toEqual([]);
    expect(index.extensions[0]?.versions.map((v) => v.tags)).toEqual([
      ['theme'],
      [],
    ]);
  });

  it('rejects the index as a whole when the head or the revocations are broken', () => {
    const raw = full([good]) as CatalogIndex;
    expect(() => lenient({ ...raw, schemaVersion: 3 })).toThrow(
      CatalogFormatError,
    );
    expect(() => lenient({ ...raw, generatedAt: 'yesterday' })).toThrow(
      CatalogFormatError,
    );
    expect(() => lenient({ ...raw, extensions: 'none' })).toThrow(
      CatalogFormatError,
    );
    expect(() =>
      lenient({
        ...raw,
        revoked: [{ id: 'acme.bad', versions: 'x', reason: 'r' }],
      }),
    ).toThrow(CatalogFormatError);
    expect(() => lenient(null)).toThrow(CatalogFormatError);
  });
});

describe('fullIndexUrl', () => {
  it('lies next to the catalog address', () => {
    expect(fullIndexUrl('https://example.com/cat/index.json').href).toBe(
      'https://example.com/cat/index.v2.json',
    );
    expect(fullIndexUrl('http://localhost:8080/index.json?x=1').href).toBe(
      'http://localhost:8080/index.v2.json',
    );
  });
});
