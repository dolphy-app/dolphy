import type {
  CatalogEntry,
  CatalogVersion,
} from '@dolphy-app/extension-catalog';
import { describe, expect, it } from 'vitest';
import type { InspectedManifest } from '../src/options.ts';
import { manifestMismatch } from '../src/verify.ts';

const version = {
  version: '1.0.0',
} as unknown as CatalogVersion;

const entry = { id: 'acme.state' } as unknown as CatalogEntry;

const manifestWith = (): InspectedManifest => ({
  id: 'acme.state',
  version: '1.0.0',
  icon: null,
  tags: [],
  dependencies: [],
});

describe('manifestMismatch: id and version', () => {
  it('rejects a manifest id or version that differs from the record', () => {
    expect(manifestMismatch(manifestWith(), entry, version)).toBeNull();
    expect(
      manifestMismatch({ ...manifestWith(), id: 'acme.other' }, entry, version),
    ).toContain("manifest id 'acme.other'");
    expect(
      manifestMismatch({ ...manifestWith(), version: '1.0.1' }, entry, version),
    ).toContain("manifest version '1.0.1'");
  });
});

describe('manifestMismatch: tags', () => {
  const taggedVersion = (tags?: string[]): CatalogVersion =>
    ({ ...version, ...(tags === undefined ? {} : { tags }) }) as CatalogVersion;
  const manifest = (tags: string[]): InspectedManifest => ({
    ...manifestWith(),
    tags,
  });

  it('passes when the sets are equal in any order, and when both are empty', () => {
    expect(
      manifestMismatch(
        manifest(['theme', 'interface']),
        entry,
        taggedVersion(['interface', 'theme']),
      ),
    ).toBeNull();
    expect(manifestMismatch(manifest([]), entry, taggedVersion())).toBeNull();
  });

  it('rejects tags the record lacks and tags the manifest lacks', () => {
    expect(manifestMismatch(manifest(['theme']), entry, taggedVersion())).toBe(
      'manifest tags differ from the catalog entry',
    );
    expect(
      manifestMismatch(manifest([]), entry, taggedVersion(['theme'])),
    ).toBe('manifest tags differ from the catalog entry');
    expect(
      manifestMismatch(
        manifest(['theme']),
        entry,
        taggedVersion(['theme', 'interface']),
      ),
    ).toBe('manifest tags differ from the catalog entry');
  });
});

describe('manifestMismatch: dependencies', () => {
  const withDependencies = (
    dependencies?: { id: string; range?: string }[],
  ): CatalogVersion =>
    ({
      ...version,
      ...(dependencies === undefined ? {} : { dependencies }),
    }) as CatalogVersion;
  const manifest = (
    dependencies: { id: string; range: string | null }[],
  ): InspectedManifest => ({ ...manifestWith(), dependencies });
  const MESSAGE = 'manifest dependencies differ from the catalog entry';

  it('passes when equal in any order, with and without ranges, and when both are empty', () => {
    expect(
      manifestMismatch(
        manifest([
          { id: 'acme.b', range: null },
          { id: 'acme.a', range: '>=1.0.0' },
        ]),
        entry,
        withDependencies([
          { id: 'acme.a', range: '>=1.0.0' },
          { id: 'acme.b' },
        ]),
      ),
    ).toBeNull();
    expect(
      manifestMismatch(manifest([]), entry, withDependencies()),
    ).toBeNull();
  });

  it('rejects a missing, an extra and a different-range dependency', () => {
    expect(
      manifestMismatch(
        manifest([{ id: 'acme.a', range: null }]),
        entry,
        withDependencies(),
      ),
    ).toBe(MESSAGE);
    expect(
      manifestMismatch(
        manifest([]),
        entry,
        withDependencies([{ id: 'acme.a' }]),
      ),
    ).toBe(MESSAGE);
    expect(
      manifestMismatch(
        manifest([{ id: 'acme.a', range: '>=2.0.0' }]),
        entry,
        withDependencies([{ id: 'acme.a', range: '>=1.0.0' }]),
      ),
    ).toBe(MESSAGE);
  });
});
