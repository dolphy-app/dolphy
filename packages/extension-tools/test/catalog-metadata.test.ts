import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseIndex } from '@dolphy-app/extension-catalog';
import type { CatalogIndex } from '@dolphy-app/extension-catalog';
import { describe, expect, it } from 'vitest';
import { buildCatalog, reindexCatalog } from '../src/catalog/build.ts';
import type { BuildCatalogOptions } from '../src/catalog/build.ts';
import { assembleIndex, hasSameContent } from '../src/catalog/index-file.ts';
import { createRepo, readJson, setVersion } from './catalog-helpers.ts';
import type { Repo } from './catalog-helpers.ts';
import { parseIndex as parseReleasedIndex } from './fixtures/released-schema-v1.ts';
import { makeTemp } from './helpers.ts';

const NIGHT = 'acme.night';
const PANELS = 'acme.commands-panel';
const NOW = new Date('2026-10-03T10:00:00.000Z');

const publish = (
  repo: Repo,
  out: string,
  ids: string[],
  extra: Partial<BuildCatalogOptions> = {},
) =>
  buildCatalog({
    src: repo.extensionsDir,
    ids,
    out,
    now: () => NOW,
    ...extra,
  });

const fullOf = async (out: string) =>
  parseIndex(await readJson(path.join(out, 'index.v2.json')));

/** The first-format index as the released app v0.2.0 reads it: strictly. */
const releasedOf = async (out: string) =>
  parseReleasedIndex(await readJson(path.join(out, 'index.json')));

describe('catalog build: titles', () => {
  it('writes the titles of the newest manifest and omits points without any', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only' },
      { fixture: 'commands-panel' },
      { fixture: 'markdown-only' },
    ]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT, PANELS, 'acme.chart']);
    const entries = Object.fromEntries(
      (await fullOf(out)).extensions.map((entry) => [entry.id, entry]),
    );
    expect(entries[NIGHT]?.titles).toEqual({
      themes: { [NIGHT]: 'Night' },
    });
    expect(entries[PANELS]?.titles).toEqual({
      commands: {
        'acme.commands-panel.open': 'Open panel',
        'acme.commands-panel.ping': 'Ping',
      },
      panels: { 'acme.commands-panel.main': 'Acme panel' },
    });
    expect(entries['acme.chart']).not.toHaveProperty('titles');
  });

  it('refreshes the titles of an unchanged version and keeps them across reindex', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    const file = path.join(out, 'index.v2.json');
    const stale = (await readJson(file)) as {
      extensions: Record<string, unknown>[];
    };
    // an index written by tools that did not know titles
    delete stale.extensions[0]?.titles;
    await writeFile(file, JSON.stringify(stale));
    const [result] = await publish(repo, out, [NIGHT]);
    expect(result?.status).toBe('unchanged');
    expect((await fullOf(out)).extensions[0]?.titles).toEqual({
      themes: { [NIGHT]: 'Night' },
    });
    const reindexed = await reindexCatalog({
      out,
      now: () => new Date('2026-11-01T00:00:00.000Z'),
    });
    expect(reindexed.changed).toBe(false);
    expect((await fullOf(out)).extensions[0]?.titles).toEqual({
      themes: { [NIGHT]: 'Night' },
    });
  });
});

describe('catalog build: tags and the first format', () => {
  it('keeps a tagged entry visible to released apps through its older untagged versions', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    await setVersion(repo, NIGHT, '1.1.0');
    const manifestFile = path.join(repo.dirOf(NIGHT), 'extension.json');
    const manifest = (await readJson(manifestFile)) as object;
    await writeFile(
      manifestFile,
      JSON.stringify({ ...manifest, tags: ['theme', 'interface'] }),
    );
    const [published] = await publish(repo, out, [NIGHT]);
    expect(published?.inLegacyIndex).toBe(false);

    const full = (await fullOf(out)).extensions[0];
    expect(full?.versions.map((v) => [v.version, v.tags])).toEqual([
      ['1.1.0', ['theme', 'interface']],
      ['1.0.0', undefined],
    ]);
    expect(full?.versions[1]).not.toHaveProperty('tags');
    expect(full?.titles).toEqual({ themes: { [NIGHT]: 'Night' } });

    const released = await releasedOf(out);
    expect(released.extensions).toHaveLength(1);
    expect(released.extensions[0]?.versions.map((v) => v.version)).toEqual([
      '1.0.0',
    ]);
    const raw = await readJson(path.join(out, 'index.json'));
    expect(JSON.stringify(raw)).not.toMatch(/titles|tags/);
  });

  it('hides an extension whose only version is tagged from released apps, not from the full index', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only', manifest: { tags: ['theme'] } },
    ]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    expect((await releasedOf(out)).extensions).toEqual([]);
    expect((await fullOf(out)).extensions[0]?.versions[0]?.tags).toEqual([
      'theme',
    ]);
  });

  it('writes tags of the version only when the manifest has them', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    expect((await fullOf(out)).extensions[0]?.versions[0]).not.toHaveProperty(
      'tags',
    );
  });
});

describe('index content comparison', () => {
  const base = async (): Promise<CatalogIndex> => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    return fullOf(out);
  };

  it('detects a changed title and a changed tag list, ignores empty maps', async () => {
    const current = await base();
    const clone = (): CatalogIndex => structuredClone(current);

    const renamed = clone();
    renamed.extensions[0]!.titles = { themes: { [NIGHT]: 'Midnight' } };
    expect(hasSameContent(current, renamed)).toBe(false);

    const tagged = clone();
    tagged.extensions[0]!.versions[0]!.tags = ['theme'];
    expect(hasSameContent(current, tagged)).toBe(false);

    const empties = clone();
    empties.extensions[0]!.titles = { themes: {} };
    empties.extensions[0]!.versions[0]!.tags = [];
    const bare = clone();
    delete bare.extensions[0]!.titles;
    expect(hasSameContent(bare, empties)).toBe(true);
    expect(
      Object.keys(
        assembleIndex({
          generatedAt: current.generatedAt,
          extensions: empties.extensions,
          revoked: [],
        }).extensions[0] ?? {},
      ),
    ).not.toContain('titles');
  });
});
