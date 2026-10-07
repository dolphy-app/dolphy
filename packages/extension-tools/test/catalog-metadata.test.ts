import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseIndex } from '@dolphy-app/extension-catalog';
import type { CatalogIndex } from '@dolphy-app/extension-catalog';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../src/catalog/build.ts';
import type { BuildCatalogOptions } from '../src/catalog/build.ts';
import { assembleIndex, hasSameContent } from '../src/catalog/index-file.ts';
import { createRepo, readJson, setVersion } from './catalog-helpers.ts';
import type { Repo } from './catalog-helpers.ts';
import { makeTemp } from './helpers.ts';

const NIGHT = 'acme.night';
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

describe('catalog build: tags', () => {
  it('records tags per version: a tagged version next to an older untagged one', async () => {
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
    await publish(repo, out, [NIGHT]);

    const full = (await fullOf(out)).extensions[0];
    expect(full?.versions.map((v) => [v.version, v.tags])).toEqual([
      ['1.1.0', ['theme', 'interface']],
      ['1.0.0', undefined],
    ]);
    expect(full?.versions[1]).not.toHaveProperty('tags');
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

  it('detects a changed tag list, ignores an empty one', async () => {
    const current = await base();
    const clone = (): CatalogIndex => structuredClone(current);

    const tagged = clone();
    tagged.extensions[0]!.versions[0]!.tags = ['theme'];
    expect(hasSameContent(current, tagged)).toBe(false);

    const empties = clone();
    empties.extensions[0]!.versions[0]!.tags = [];
    expect(hasSameContent(current, empties)).toBe(true);
    expect(
      Object.keys(
        assembleIndex({
          generatedAt: current.generatedAt,
          extensions: empties.extensions,
          revoked: [],
        }).extensions[0]?.versions[0] ?? {},
      ),
    ).not.toContain('tags');
  });
});
