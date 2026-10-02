import { describe, expect, it } from 'vitest';
import {
  ASSET_LIMITS,
  CatalogFormatError,
  fullIndexUrl,
  legacyIndexSchema,
  legacySubset,
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

  it('allows up to 100 files, the first format only 50', () => {
    const many = (count: number) => [
      manifestFile,
      ...Array.from({ length: count - 1 }, (_, i) => file(`a/f${i}.json`)),
    ];
    expect(issuesOf(full([withFiles(many(100))]))).toEqual([]);
    expect(issuesOf(full([withFiles(many(101))]))[0]).toContain('files');
    const legacy = {
      ...(full([withFiles(many(51))]) as object),
      schemaVersion: 1,
    };
    expect(issuesOf(legacy)).not.toEqual([]);
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

  it('treats schemaVersion 1 as the first format: no icon, no asset files', () => {
    const asLegacy = (e: unknown) => ({
      ...(full([e]) as object),
      schemaVersion: 1,
    });
    expect(
      issuesOf(asLegacy(withFiles([manifestFile], { icon: ICON })))[0],
    ).toContain('icon');
    expect(
      issuesOf(asLegacy(withFiles([manifestFile, file('a.css')])))[0],
    ).toContain('files.1.path');
    expect(issuesOf(asLegacy(entry()))).toEqual([]);
  });
});

describe('legacySubset', () => {
  const plain = entry();
  const styled = entry({
    id: 'acme.styled',
    versions: [
      version({
        version: '2.0.0',
        files: [manifestFile, file('a.css')],
      }),
      version({ version: '1.0.0' }),
    ],
  });
  const onlyStyled = entry({
    id: 'acme.only',
    versions: [
      version({ version: '1.0.0', files: [manifestFile, file('a.png')] }),
    ],
  });
  const iconOnly = entry({
    id: 'acme.icon',
    versions: [version({ icon: ICON })],
  });
  const newPermission = entry({
    id: 'acme.events',
    versions: [version({ permissions: ['learning.events'] })],
  });
  const withPanels = entry({
    id: 'acme.panels',
    contributes: { ...entry().contributes, panels: ['acme.panels.main'] },
  });
  const source = parseIndex(
    full([plain, styled, onlyStyled, iconOnly, newPermission, withPanels]),
  );

  it('keeps what a released app parses and drops the rest', () => {
    const subset = legacySubset(source);
    expect(subset.schemaVersion).toBe(1);
    expect(subset.extensions.map((e) => e.id)).toEqual([
      'acme.quiz',
      'acme.styled',
    ]);
    expect(subset.extensions[1]?.versions.map((v) => v.version)).toEqual([
      '1.0.0',
    ]);
    expect(subset.revoked).toEqual(source.revoked);
  });

  it('is valid in the first format', () => {
    expect(legacyIndexSchema.safeParse(legacySubset(source)).success).toBe(
      true,
    );
    expect(
      parseIndex(JSON.parse(JSON.stringify(legacySubset(source)))),
    ).toEqual(legacySubset(source));
  });

  it('drops a version with more than 50 files', () => {
    const files = [
      manifestFile,
      ...Array.from({ length: 60 }, (_, i) => file(`a/f${i}.json`)),
    ];
    const wide = parseIndex(full([withFiles(files)]));
    expect(legacySubset(wide).extensions).toEqual([]);
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
        contributes: { ...good.contributes, widgets: ['x'] },
        versions: [{ ...version(), signature: 'abc' }],
      },
    ]) as Record<string, unknown>;
    const { index, warnings } = lenient({ ...raw, banner: 'hello' });
    expect(warnings).toEqual([]);
    const parsed = index.extensions[0];
    expect(parsed).not.toHaveProperty('future');
    expect(parsed?.contributes).not.toHaveProperty('widgets');
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
          versions: [version({ permissions: ['telepathy'] as never })],
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

  it('reads an index of the first format as well', () => {
    const { index } = lenient({
      ...(full([good]) as object),
      schemaVersion: 1,
    });
    expect(index.schemaVersion).toBe(1);
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
