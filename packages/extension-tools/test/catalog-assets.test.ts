import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EXTENSION_PERMISSIONS } from '@dolphy-app/extension-api';
import { parseIndex } from '@dolphy-app/extension-catalog';
import { describe, expect, it } from 'vitest';
import { buildCatalog, reindexCatalog } from '../src/catalog/build.ts';
import type { BuildCatalogOptions } from '../src/catalog/build.ts';
import { BuildError } from '../src/errors.ts';
import {
  jpeg,
  png,
  webp,
  woff2,
} from '../../extension-catalog/test/samples.ts';
import { createRepo, readJson, readManifest } from './catalog-helpers.ts';
import type { Repo } from './catalog-helpers.ts';
import { makeTemp } from './helpers.ts';

const NIGHT = 'acme.night';
const NOW = new Date('2026-10-02T10:00:00.000Z');

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

const ASSETS: Record<string, string | Uint8Array> = {
  'assets/panel.css': '.a { background: url(logo.png); }\n',
  'assets/logo.png': png(128),
  'assets/photo.jpg': jpeg(300),
  'assets/hero.webp': webp(200),
  'assets/mark.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
  'assets/font.woff2': woff2(256),
  'assets/icon.png': png(64),
};

/** Next version of the night theme with assets and an icon. */
const addAssets = async (repo: Repo, version: string): Promise<void> => {
  const dir = repo.dirOf(NIGHT);
  for (const [file, content] of Object.entries(ASSETS)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), content);
  }
  const manifest = await readManifest(path.join(dir, 'extension.json'));
  await writeFile(
    path.join(dir, 'extension.json'),
    `${JSON.stringify({ ...manifest, version, icon: 'assets/icon.png' }, null, 2)}\n`,
  );
};

describe('catalog build: assets and icon', () => {
  it('publishes style sheets, images and fonts; the full index carries the icon as a data URI', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    await addAssets(repo, '1.0.0');
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    const [entry] = (await fullOf(out)).extensions;
    const [version] = entry?.versions ?? [];
    expect(version?.files.map((file) => file.path)).toEqual(
      [
        'README.md',
        'assets/font.woff2',
        'assets/hero.webp',
        'assets/icon.png',
        'assets/logo.png',
        'assets/mark.svg',
        'assets/panel.css',
        'assets/photo.jpg',
        'extension.json',
      ].sort(),
    );
    const icon = Buffer.from(png(64)).toString('base64');
    expect(version?.icon).toBe(`data:image/png;base64,${icon}`);
    const served = await readFile(
      path.join(out, 'extensions', NIGHT, '1.0.0', 'assets', 'logo.png'),
    );
    expect(new Uint8Array(served)).toEqual(png(128));
  });

  it('writes exactly one index file: index.v2.json, schema 2', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    expect(
      (await readdir(out)).filter((name) => name.startsWith('index')),
    ).toEqual(['index.v2.json']);
    expect((await fullOf(out)).schemaVersion).toBe(2);
  });

  it.each([
    [
      'a script in an SVG',
      {
        'assets/a.svg':
          '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
      },
      /assets\/a\.svg: .*<script>/,
    ],
    [
      'an external @import in CSS',
      { 'assets/a.css': '@import url(https://example.com/x.css);' },
      /assets\/a\.css: @import/,
    ],
    [
      'a PNG with a forged huge IHDR',
      { 'assets/a.png': png(70_000, 70_000) },
      /assets\/a\.png: .*4096/,
    ],
    ['a JPEG named .png', { 'assets/a.png': jpeg() }, /assets\/a\.png: .*PNG/],
    [
      'an oversized style sheet',
      { 'assets/a.css': `.a{}${' '.repeat(260 * 1024)}` },
      /assets\/a\.css: .*256|exceed/,
    ],
    [
      'a capital extension',
      { 'assets/Logo.PNG': png() },
      /assets\/Logo\.PNG: .*lowercase/,
    ],
  ])('refuses %s and writes nothing', async (_name, files, pattern) => {
    const repo = await createRepo([{ fixture: 'theme-only', files }]);
    const out = await makeTemp();
    await expect(publish(repo, out, [NIGHT])).rejects.toThrow(BuildError);
    await expect(publish(repo, out, [NIGHT])).rejects.toThrow(pattern);
    await expect(readFile(path.join(out, 'index.v2.json'))).rejects.toThrow();
  });

  it('refuses an icon that is not square or too small', async () => {
    const repo = await createRepo([
      {
        fixture: 'theme-only',
        manifest: { icon: 'assets/icon.png' },
        files: { 'assets/icon.png': png(64, 80) },
      },
    ]);
    await expect(publish(repo, await makeTemp(), [NIGHT])).rejects.toThrow(
      /square/,
    );
    const small = await createRepo([
      {
        fixture: 'theme-only',
        manifest: { icon: 'assets/icon.png' },
        files: { 'assets/icon.png': png(32) },
      },
    ]);
    await expect(publish(small, await makeTemp(), [NIGHT])).rejects.toThrow(
      /64 to 512/,
    );
  });

  it('copies an icon that lies outside assets/', async () => {
    const repo = await createRepo([
      {
        fixture: 'theme-only',
        manifest: { icon: 'icon.png' },
        files: { 'icon.png': png(64) },
      },
    ]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    const [entry] = (await fullOf(out)).extensions;
    expect(entry?.versions[0]?.files.map((file) => file.path)).toContain(
      'icon.png',
    );
  });

  it('allows 100 files, refuses 101', async () => {
    const filesOf = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          `assets/data/f${String(i).padStart(3, '0')}.json`,
          '{}',
        ]),
      );
    // extension.json and README.md are two more files
    const ok = await createRepo([
      { fixture: 'theme-only', files: filesOf(98) },
    ]);
    const out = await makeTemp();
    const [result] = await publish(ok, out, [NIGHT]);
    expect(result?.files).toBe(100);
    const tooMany = await createRepo([
      { fixture: 'theme-only', files: filesOf(99) },
    ]);
    await expect(publish(tooMany, await makeTemp(), [NIGHT])).rejects.toThrow(
      /101 files exceed the limit of 100/,
    );
  });
});

describe('catalog build: the whole catalog', () => {
  it('publishes a version with every permission, file type and entry key', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only' },
      {
        fixture: 'hello',
        manifest: {
          permissions: [...EXTENSION_PERMISSIONS],
          tags: ['learning', 'developer'],
          icon: 'assets/icon.png',
          contributes: {
            settings: [
              {
                id: 'acme.hello.mode',
                type: 'boolean',
                label: 'Mode',
                default: true,
              },
            ],
            events: [{ event: 'attempt.closed' }],
          },
        },
        files: {
          ...ASSETS,
          'src/index.ts':
            "import { defineExtension } from '@dolphy-app/extension-sdk';\nexport const host = defineExtension({});\n",
        },
      },
      { fixture: 'markdown-only' },
    ]);
    const out = await makeTemp();
    const ids = [NIGHT, 'acme.hello', 'acme.chart'];
    await publish(repo, out, ids);
    // the next version of the night theme brings assets and an icon
    await addAssets(repo, '2.0.0');
    await publish(repo, out, [NIGHT]);

    const full = await fullOf(out);
    const byId = Object.fromEntries(
      full.extensions.map((entry) => [entry.id, entry]),
    );
    expect(byId[NIGHT]?.versions.map((v) => v.version)).toEqual([
      '2.0.0',
      '1.0.0',
    ]);
    const [hello] = byId['acme.hello']?.versions ?? [];
    expect(hello?.permissions).toEqual(
      expect.arrayContaining([...EXTENSION_PERMISSIONS]),
    );
    expect(hello?.tags).toEqual(['learning', 'developer']);
    expect(hello?.icon).toMatch(/^data:image\/png;base64,/);
    expect(hello?.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(Object.keys(ASSETS)),
    );
    expect(byId['acme.hello']?.contributes.settings).toEqual([
      'acme.hello.mode',
    ]);
    expect(byId['acme.hello']?.contributes.events).toEqual(['attempt.closed']);
    expect(byId['acme.chart']?.versions).toHaveLength(1);
  });

  it('keeps an extension whose only version is new and tagged', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    await addAssets(repo, '1.0.0');
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    expect((await fullOf(out)).extensions).toHaveLength(1);
  });

  it('a version of 51 files is in the index (the limit is 100)', async () => {
    const filesOf = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          `assets/data/f${String(i).padStart(3, '0')}.json`,
          '{}',
        ]),
      );
    // extension.json and README.md are two more files
    const repo = await createRepo([
      { fixture: 'theme-only', files: filesOf(49) },
    ]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    expect((await fullOf(out)).extensions[0]?.versions[0]?.files).toHaveLength(
      51,
    );
  });

  it('keeps the index consistent across reindex and revocation', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    await addAssets(repo, '2.0.0');
    await publish(repo, out, [NIGHT]);
    const revoked = path.join(await makeTemp(), 'revoked.json');
    await writeFile(
      revoked,
      JSON.stringify([{ id: NIGHT, versions: '<2.0.0', reason: 'broken' }]),
    );
    const later = new Date('2026-11-01T00:00:00.000Z');
    const result = await reindexCatalog({ out, revoked, now: () => later });
    expect(result.changed).toBe(true);
    const full = await fullOf(out);
    expect(full.generatedAt).toBe(later.toISOString());
    expect(full.revoked).toHaveLength(1);
    expect(full.extensions[0]?.versions).toHaveLength(2);
    const again = await reindexCatalog({
      out,
      revoked,
      now: () => new Date('2026-12-01T00:00:00.000Z'),
    });
    expect(again.changed).toBe(false);
  });
});
