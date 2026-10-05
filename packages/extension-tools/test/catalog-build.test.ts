import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseIndex } from '@dolphy-app/extension-catalog';
import { describe, expect, it } from 'vitest';
import { buildCatalog, reindexCatalog } from '../src/catalog/build.ts';
import type { BuildCatalogOptions } from '../src/catalog/build.ts';
import { BuildError } from '../src/errors.ts';
import { createRepo, readJson, setVersion } from './catalog-helpers.ts';
import type { Repo } from './catalog-helpers.ts';
import { makeTemp } from './helpers.ts';

const NIGHT = 'acme.night';
const NOW = new Date('2026-10-02T10:00:00.000Z');

const publish = async (
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

const indexOf = async (out: string) =>
  parseIndex(await readJson(path.join(out, 'index.v2.json')));

const sha256 = async (file: string): Promise<string> =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');

const listFiles = async (dir: string): Promise<string[]> =>
  (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();

describe('catalog build: publishing a version', () => {
  it('puts the version files and README, the index describes them with sizes and sha256', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    const results = await publish(repo, out, [NIGHT]);
    expect(results).toEqual([
      {
        id: NIGHT,
        version: '1.0.0',
        status: 'published',
        files: 2,
        bytes: expect.any(Number),
      },
    ]);
    const versionDir = path.join(out, 'extensions', NIGHT, '1.0.0');
    expect(await listFiles(versionDir)).toEqual([
      'README.md',
      'extension.json',
    ]);

    const index = await indexOf(out);
    expect(index.generatedAt).toBe(NOW.toISOString());
    const [entry] = index.extensions;
    expect(entry).toMatchObject({
      id: NIGHT,
      name: 'Sample',
      description: 'A sample extension for the catalog',
      author: 'octo-cat',
      source: `https://github.com/dolphy-app/dolphy-extensions/tree/main/extensions/${NIGHT}`,
      platforms: [],
      contributes: {
        exerciseTypes: [],
        themes: [NIGHT],
        markdownRenderers: [],
        gradePolicies: [],
      },
    });
    const [version] = entry?.versions ?? [];
    expect(version).toMatchObject({
      version: '1.0.0',
      apiVersion: 1,
      minAppVersion: null,
      permissions: [],
      publishedAt: NOW.toISOString(),
      baseUrl: `extensions/${NIGHT}/1.0.0/`,
    });
    for (const file of version?.files ?? []) {
      const target = path.join(versionDir, file.path);
      expect(file.size).toBe((await stat(target)).size);
      expect(file.sha256).toBe(await sha256(target));
    }
    expect(results[0]?.bytes).toBe(
      version?.files.reduce((sum, file) => sum + file.size, 0),
    );
  });

  it('index.v2.json file: two spaces, trailing newline, stable key order', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    const text = await readFile(path.join(out, 'index.v2.json'), 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    const parsed = JSON.parse(text);
    expect(text).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
    expect(Object.keys(parsed)).toEqual([
      'schemaVersion',
      'generatedAt',
      'extensions',
      'revoked',
    ]);
    expect(Object.keys(parsed.extensions[0].versions[0])).toEqual([
      'version',
      'apiVersion',
      'minAppVersion',
      'permissions',
      'publishedAt',
      'baseUrl',
      'files',
    ]);
  });

  it('builds extensions with code and markup, honors source-base and published-at', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only' },
      { fixture: 'markdown-only' },
      { fixture: 'hello', manifest: { minAppVersion: '1.2.0' } },
    ]);
    const out = await makeTemp();
    const results = await publish(repo, out, ['acme.hello', 'acme.chart'], {
      sourceBase: 'https://example.org/src/',
      publishedAt: '2026-01-01T00:00:00Z',
    });
    expect(results.map((result) => result.id)).toEqual([
      'acme.hello',
      'acme.chart',
    ]);
    const index = await indexOf(out);
    expect(index.extensions.map((entry) => entry.id)).toEqual([
      'acme.chart',
      'acme.hello',
    ]);
    const hello = index.extensions[1];
    expect(hello?.source).toBe('https://example.org/src/acme.hello');
    expect(hello?.contributes.exerciseTypes).toEqual(['acme.hello']);
    expect(hello?.versions[0]?.minAppVersion).toBe('1.2.0');
    expect(hello?.versions[0]?.publishedAt).toBe('2026-01-01T00:00:00Z');
    const paths = hello?.versions[0]?.files.map((file) => file.path);
    expect(paths).toContain('main.mjs');
    expect(paths).toContain('README.md');
    expect(index.extensions[0]?.contributes.markdownRenderers).toEqual([
      'chart',
    ]);
  });

  it('R8 version files carry no source maps', async () => {
    const repo = await createRepo([
      { fixture: 'hello' },
      { fixture: 'commands-panel' },
      { fixture: 'markdown-only' },
    ]);
    const out = await makeTemp();
    const ids = ['acme.hello', 'acme.commands-panel', 'acme.chart'];
    await publish(repo, out, ids);
    const index = await indexOf(out);
    const scripts: string[] = [];
    for (const entry of index.extensions) {
      const version = entry.versions[0];
      for (const file of version?.files ?? []) {
        if (!file.path.endsWith('.mjs')) continue;
        scripts.push(file.path);
        const text = await readFile(
          path.join(
            out,
            'extensions',
            entry.id,
            version?.version ?? '',
            file.path,
          ),
          'utf8',
        );
        expect(text).not.toContain('sourceMappingURL');
      }
    }
    expect(scripts.length).toBeGreaterThanOrEqual(4);
  });
});

describe('catalog build: settings and events', () => {
  const STATE = {
    permissions: ['learning.events'],
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
  };

  it('writes settings, events and permissions into the index entry', async () => {
    const repo = await createRepo([
      {
        fixture: 'hello',
        manifest: STATE,
        // the override manifest declares no views: host code without `views`
        files: {
          'src/index.ts':
            "import { defineExtension } from '@dolphy-app/extension-sdk';\nexport const host = defineExtension({});\n",
        },
      },
    ]);
    const out = await makeTemp();
    await publish(repo, out, ['acme.hello']);
    const index = await indexOf(out);
    const [entry] = index.extensions;
    expect(entry?.contributes.settings).toEqual(['acme.hello.mode']);
    expect(entry?.contributes.events).toEqual(['attempt.closed']);
    expect(entry?.versions[0]?.permissions).toEqual(['learning.events']);
    const raw = (await readJson(path.join(out, 'index.v2.json'))) as {
      extensions: { contributes: Record<string, unknown> }[];
    };
    expect(Object.keys(raw.extensions[0]?.contributes ?? {})).toEqual([
      'exerciseTypes',
      'themes',
      'markdownRenderers',
      'gradePolicies',
      'settings',
      'events',
    ]);
  });

  it('without settings and events the entry has no keys', async () => {
    const repo = await createRepo([{ fixture: 'hello' }]);
    const out = await makeTemp();
    await publish(repo, out, ['acme.hello']);
    const raw = (await readJson(path.join(out, 'index.v2.json'))) as {
      extensions: { contributes: Record<string, unknown> }[];
    };
    expect(Object.keys(raw.extensions[0]?.contributes ?? {})).toEqual([
      'exerciseTypes',
      'themes',
      'markdownRenderers',
      'gradePolicies',
    ]);
  });
});

describe('catalog build: commands and panels', () => {
  it('writes command and panel ids into the index entry', async () => {
    const repo = await createRepo([{ fixture: 'commands-panel' }]);
    const out = await makeTemp();
    await publish(repo, out, ['acme.commands-panel']);
    const [entry] = (await indexOf(out)).extensions;
    expect(entry?.contributes.commands).toEqual([
      'acme.commands-panel.open',
      'acme.commands-panel.ping',
    ]);
    expect(entry?.contributes.panels).toEqual(['acme.commands-panel.main']);
    const paths = entry?.versions[0]?.files.map((file) => file.path);
    expect(paths).toContain('panel.mjs');
    expect(paths).toContain('main.mjs');
  });

  it('writes widget ids and titles into the index entry', async () => {
    const repo = await createRepo([{ fixture: 'surfaces' }]);
    const out = await makeTemp();
    await publish(repo, out, ['acme.surfaces']);
    const [entry] = (await indexOf(out)).extensions;
    expect(entry?.contributes.widgets).toEqual([
      'acme.surfaces.card',
      'acme.surfaces.gauge',
      'acme.surfaces.badge',
    ]);
    expect(entry?.titles?.widgets).toEqual({
      'acme.surfaces.card': 'Card',
      'acme.surfaces.gauge': 'Gauge',
      'acme.surfaces.badge': 'Badge',
    });
    const paths = entry?.versions[0]?.files.map((file) => file.path);
    expect(paths).toContain('widget.mjs');
    expect(paths).toContain('ui/gauge.js');
  });

  it('without commands and panels the entry has no keys', async () => {
    const repo = await createRepo([{ fixture: 'hello' }]);
    const out = await makeTemp();
    await publish(repo, out, ['acme.hello']);
    const raw = (await readJson(path.join(out, 'index.v2.json'))) as {
      extensions: { contributes: Record<string, unknown> }[];
    };
    const keys = Object.keys(raw.extensions[0]?.contributes ?? {});
    expect(keys).not.toContain('commands');
    expect(keys).not.toContain('panels');
    expect(keys).not.toContain('widgets');
  });
});

describe('catalog build: importers and exporters', () => {
  const contributes = {
    commands: [{ id: 'acme.commands-panel.open', title: 'Open panel' }],
    panels: [{ id: 'acme.commands-panel.main', title: 'Acme panel' }],
    importers: [
      {
        id: 'acme.commands-panel.csv',
        title: 'CSV course',
        accept: ['.csv'],
      },
    ],
    exporters: [
      {
        id: 'acme.commands-panel.out',
        title: 'Course as CSV',
        scope: 'course',
      },
    ],
  };

  it('writes importer and exporter ids and titles into the index entry', async () => {
    const repo = await createRepo([
      { fixture: 'commands-panel', manifest: { contributes } },
    ]);
    const out = await makeTemp();
    await publish(repo, out, ['acme.commands-panel']);
    const [entry] = (await indexOf(out)).extensions;
    expect(entry?.contributes.importers).toEqual(['acme.commands-panel.csv']);
    expect(entry?.contributes.exporters).toEqual(['acme.commands-panel.out']);
    expect(entry?.titles?.importers).toEqual({
      'acme.commands-panel.csv': 'CSV course',
    });
    expect(entry?.titles?.exporters).toEqual({
      'acme.commands-panel.out': 'Course as CSV',
    });
  });

  it('without them the entry has no keys', async () => {
    const repo = await createRepo([{ fixture: 'commands-panel' }]);
    const out = await makeTemp();
    await publish(repo, out, ['acme.commands-panel']);
    const raw = (await readJson(path.join(out, 'index.v2.json'))) as {
      extensions: { contributes: Record<string, unknown> }[];
    };
    const keys = Object.keys(raw.extensions[0]?.contributes ?? {});
    expect(keys).not.toContain('importers');
    expect(keys).not.toContain('exporters');
  });
});

describe('catalog build: schedules', () => {
  const contributes = {
    commands: [{ id: 'acme.commands-panel.open', title: 'Open panel' }],
    panels: [{ id: 'acme.commands-panel.main', title: 'Acme panel' }],
    schedules: [
      { id: 'acme.commands-panel.morning', every: 'daily', at: '08:30' },
      { id: 'acme.commands-panel.tick', every: 'hourly' },
    ],
  };

  it('writes schedule ids (no titles) into the index entry', async () => {
    const repo = await createRepo([
      { fixture: 'commands-panel', manifest: { contributes } },
    ]);
    const out = await makeTemp();
    await publish(repo, out, ['acme.commands-panel']);
    const [entry] = (await indexOf(out)).extensions;
    expect(entry?.contributes.schedules).toEqual([
      'acme.commands-panel.morning',
      'acme.commands-panel.tick',
    ]);
    expect(entry?.titles?.schedules).toBeUndefined();
  });

  it('without them the entry has no key', async () => {
    const repo = await createRepo([{ fixture: 'commands-panel' }]);
    const out = await makeTemp();
    await publish(repo, out, ['acme.commands-panel']);
    const raw = (await readJson(path.join(out, 'index.v2.json'))) as {
      extensions: { contributes: Record<string, unknown> }[];
    };
    expect(Object.keys(raw.extensions[0]?.contributes ?? {})).not.toContain(
      'schedules',
    );
  });
});

describe('catalog build: version immutability', () => {
  it('rebuilding the same sources is a no-op, publishedAt is kept', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    const before = await indexOf(out);
    const again = await publish(repo, out, [NIGHT], {
      now: () => new Date('2026-11-01T00:00:00.000Z'),
    });
    expect(again[0]?.status).toBe('unchanged');
    const after = await indexOf(out);
    expect(after.extensions).toEqual(before.extensions);
    expect(after.generatedAt).toBe(before.generatedAt);
  });

  it('different content for the same version — an error, disk and index untouched', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    const indexBefore = await readFile(path.join(out, 'index.v2.json'), 'utf8');
    const manifestBefore = await readFile(
      path.join(out, 'extensions', NIGHT, '1.0.0', 'extension.json'),
      'utf8',
    );
    await writeFile(path.join(repo.dirOf(NIGHT), 'README.md'), '# changed\n');
    await expect(publish(repo, out, [NIGHT])).rejects.toThrow(
      /already published with different content/,
    );
    expect(await readFile(path.join(out, 'index.v2.json'), 'utf8')).toBe(
      indexBefore,
    );
    expect(
      await readFile(
        path.join(out, 'extensions', NIGHT, '1.0.0', 'extension.json'),
        'utf8',
      ),
    ).toBe(manifestBefore);
  });

  it('content differing from the index entry when the directory is missing is also an error', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const first = await makeTemp();
    await publish(repo, first, [NIGHT]);
    await writeFile(path.join(repo.dirOf(NIGHT), 'README.md'), '# changed\n');
    const second = await makeTemp();
    await expect(
      publish(repo, second, [NIGHT], {
        previousIndex: path.join(first, 'index.v2.json'),
      }),
    ).rejects.toBeInstanceOf(BuildError);
    await expect(stat(path.join(second, 'index.v2.json'))).rejects.toThrow();
  });

  it('a missing version directory is restored when it matches the index entry', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const first = await makeTemp();
    await publish(repo, first, [NIGHT]);
    const second = await makeTemp();
    const results = await publish(repo, second, [NIGHT], {
      previousIndex: path.join(first, 'index.v2.json'),
    });
    expect(results[0]?.status).toBe('published');
    expect(await listFiles(path.join(second, 'extensions', NIGHT))).toEqual([
      '1.0.0/README.md',
      '1.0.0/extension.json',
    ]);
  });
});

describe('catalog build: index merge', () => {
  it('keeps entries of non-rebuilt extensions and takes the index from <out>', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only' },
      { fixture: 'markdown-only' },
    ]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    await publish(repo, out, ['acme.chart']);
    const index = await indexOf(out);
    expect(index.extensions.map((entry) => entry.id)).toEqual([
      'acme.chart',
      NIGHT,
    ]);
  });

  it('--previous-index starts from another index', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only' },
      { fixture: 'markdown-only' },
    ]);
    const previous = await makeTemp();
    await publish(repo, previous, [NIGHT]);
    const out = await makeTemp();
    await publish(repo, out, ['acme.chart'], {
      previousIndex: path.join(previous, 'index.v2.json'),
    });
    const ids = (await indexOf(out)).extensions.map((entry) => entry.id);
    expect(ids).toEqual(['acme.chart', NIGHT]);
  });

  it('keeps five newest versions in descending order; the sixth leaves the index but not the disk', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    for (const version of [
      '1.0.0',
      '1.1.0',
      '1.0.1',
      '2.0.0',
      '1.2.0',
      '1.3.0',
    ]) {
      await setVersion(repo, NIGHT, version);
      await publish(repo, out, [NIGHT]);
    }
    const [entry] = (await indexOf(out)).extensions;
    expect(entry?.versions.map((version) => version.version)).toEqual([
      '2.0.0',
      '1.3.0',
      '1.2.0',
      '1.1.0',
      '1.0.1',
    ]);
    const onDisk = await readdir(path.join(out, 'extensions', NIGHT));
    expect(onDisk.sort()).toEqual([
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '1.2.0',
      '1.3.0',
      '2.0.0',
    ]);
  });

  it('revocations: carried over from the previous index and overridden by --revoked', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    const revokedFile = path.join(await makeTemp(), 'revoked.json');
    const revoked = [{ id: NIGHT, versions: '<1.0.0', reason: 'bad' }];
    await writeFile(revokedFile, JSON.stringify(revoked));
    await publish(repo, out, [NIGHT], { revoked: revokedFile });
    expect((await indexOf(out)).revoked).toEqual(revoked);

    await setVersion(repo, NIGHT, '1.0.1');
    await publish(repo, out, [NIGHT]);
    expect((await indexOf(out)).revoked).toEqual(revoked);

    const replacement = [{ id: NIGHT, versions: '<=1.0.0', reason: 'worse' }];
    await writeFile(revokedFile, JSON.stringify(replacement));
    await setVersion(repo, NIGHT, '1.0.2');
    await publish(repo, out, [NIGHT], { revoked: revokedFile });
    expect((await indexOf(out)).revoked).toEqual(replacement);
  });
});

describe('catalog build: CHANGELOG.md', () => {
  it('is copied into the version and listed in files with size and sha256; optional', async () => {
    const changelog = '# Changelog\n\n## 1.0.0\n\n- first\n';
    const repo = await createRepo([
      { fixture: 'theme-only', files: { 'CHANGELOG.md': changelog } },
    ]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    const file = path.join(out, 'extensions', NIGHT, '1.0.0', 'CHANGELOG.md');
    expect(await readFile(file, 'utf8')).toBe(changelog);
    const listed = (await indexOf(out)).extensions[0]?.versions[0]?.files.find(
      (item) => item.path === 'CHANGELOG.md',
    );
    expect(listed).toEqual({
      path: 'CHANGELOG.md',
      size: Buffer.byteLength(changelog),
      sha256: await sha256(file),
    });
    const plain = await createRepo([{ fixture: 'theme-only' }]);
    const plainOut = await makeTemp();
    await publish(plain, plainOut, [NIGHT]);
    expect(
      await listFiles(path.join(plainOut, 'extensions', NIGHT, '1.0.0')),
    ).not.toContain('CHANGELOG.md');
  });

  it('a CHANGELOG.md over 64 KiB or with NUL is refused, nothing is written', async () => {
    for (const content of ['x'.repeat(64 * 1024 + 1), 'a\u0000b']) {
      const repo = await createRepo([
        { fixture: 'theme-only', files: { 'CHANGELOG.md': content } },
      ]);
      const out = await makeTemp();
      await expect(publish(repo, out, [NIGHT])).rejects.toThrow(/CHANGELOG.md/);
      expect(await readdir(out)).toEqual([]);
    }
  });
});

describe('catalog build: deprecated', () => {
  const writeList = async (value: unknown): Promise<string> => {
    const file = path.join(await makeTemp(), 'deprecated.json');
    await writeFile(file, JSON.stringify(value));
    return file;
  };

  it('writes deprecated into the entry, keeps it on rebuild, removes it when the file drops the entry', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only' },
      { fixture: 'markdown-only' },
    ]);
    const out = await makeTemp();
    const list = await writeList([
      {
        id: NIGHT,
        versions: '<2.0.0',
        reason: 'Replaced',
        alternatives: ['acme.chart'],
      },
      { id: 'acme.chart', reason: 'Gone', alternatives: [] },
    ]);
    await publish(repo, out, [NIGHT, 'acme.chart'], { deprecated: list });
    const entries = (await indexOf(out)).extensions;
    expect(entries.find((e) => e.id === NIGHT)?.deprecated).toEqual({
      versions: '<2.0.0',
      reason: 'Replaced',
      alternatives: ['acme.chart'],
    });
    expect(entries.find((e) => e.id === 'acme.chart')?.deprecated).toEqual({
      versions: null,
      reason: 'Gone',
      alternatives: [],
    });

    // a new version without the flag keeps the deprecation
    await setVersion(repo, NIGHT, '1.0.1');
    await publish(repo, out, [NIGHT]);
    expect(
      (await indexOf(out)).extensions.find((e) => e.id === NIGHT)?.deprecated
        ?.reason,
    ).toBe('Replaced');

    // --reindex applies the file without rebuilding; entries missing from it lose the key
    const reduced = await writeList([
      { id: NIGHT, reason: 'Still replaced', alternatives: [] },
    ]);
    const result = await reindexCatalog({
      out,
      deprecated: reduced,
      now: () => NOW,
    });
    expect(result.changed).toBe(true);
    const after = (await indexOf(out)).extensions;
    expect(after.find((e) => e.id === NIGHT)?.deprecated?.reason).toBe(
      'Still replaced',
    );
    expect(after.find((e) => e.id === 'acme.chart')).not.toHaveProperty(
      'deprecated',
    );

    await reindexCatalog({
      out,
      deprecated: await writeList([]),
      now: () => NOW,
    });
    expect(
      (await indexOf(out)).extensions.every((e) => e.deprecated === undefined),
    ).toBe(true);
  });

  it('every kind of error fails the build and writes nothing', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const base = await createRepo([{ fixture: 'markdown-only' }]);
    const out = await makeTemp();
    await publish(base, out, ['acme.chart']);
    const before = await readFile(path.join(out, 'index.v2.json'), 'utf8');
    const cases: [unknown, RegExp][] = [
      [
        [
          { id: NIGHT, reason: 'a', alternatives: [] },
          { id: NIGHT, reason: 'b', alternatives: [] },
        ],
        /duplicate id/,
      ],
      [
        [{ id: 'acme.nowhere', reason: 'a', alternatives: [] }],
        /not in the index/,
      ],
      [
        [{ id: NIGHT, reason: 'a', alternatives: ['acme.nowhere'] }],
        /alternative 'acme.nowhere'/,
      ],
      [
        [{ id: NIGHT, versions: 'garbage', reason: 'a', alternatives: [] }],
        /invalid version range/,
      ],
      [
        [{ id: NIGHT, reason: '', alternatives: [] }],
        /deprecated list is invalid/,
      ],
      [{ id: NIGHT }, /deprecated list is invalid/],
    ];
    for (const [value, message] of cases) {
      await expect(
        publish(repo, out, [NIGHT], { deprecated: await writeList(value) }),
      ).rejects.toThrow(message);
      expect(await readFile(path.join(out, 'index.v2.json'), 'utf8')).toBe(
        before,
      );
      expect(await readdir(path.join(out, 'extensions'))).toEqual([
        'acme.chart',
      ]);
    }
    await expect(
      publish(repo, out, [NIGHT], { deprecated: path.join(out, 'nope.json') }),
    ).rejects.toThrow(/unreadable/);
  });
});

describe('catalog build: failures write nothing', () => {
  it('an invalid result (publishedAt) leaves the previous index and directories untouched', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only' },
      { fixture: 'markdown-only' },
    ]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    const before = await readFile(path.join(out, 'index.v2.json'), 'utf8');
    await expect(
      publish(repo, out, ['acme.chart'], { publishedAt: 'yesterday' }),
    ).rejects.toThrow(/resulting index is invalid/);
    expect(await readFile(path.join(out, 'index.v2.json'), 'utf8')).toBe(
      before,
    );
    expect(await readdir(path.join(out, 'extensions'))).toEqual([NIGHT]);
  });

  it('an error in the second extension leaves no traces of the first', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only' },
      { fixture: 'markdown-only', files: { 'README.md': null } },
    ]);
    const out = await makeTemp();
    await expect(publish(repo, out, [NIGHT, 'acme.chart'])).rejects.toThrow(
      /README.md is missing/,
    );
    expect(await readdir(out)).toEqual([]);
  });

  it('a broken previous index and a non-array --revoked — errors', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'index.v2.json'), '{"schemaVersion":7}');
    await expect(publish(repo, out, [NIGHT])).rejects.toThrow(
      /not a valid catalog index/,
    );
    const clean = await makeTemp();
    const revoked = path.join(clean, 'r.json');
    await writeFile(revoked, '{}');
    await expect(publish(repo, clean, [NIGHT], { revoked })).rejects.toThrow(
      /must be a JSON array/,
    );
  });

  it('files outside the catalog schema (assets/logo.gif), an empty README and name mismatch are rejected', async () => {
    const out = await makeTemp();
    const png = await createRepo([
      { fixture: 'theme-only', files: { 'assets/logo.gif': 'x' } },
    ]);
    await expect(publish(png, out, [NIGHT])).rejects.toThrow(
      /assets\/logo\.gif' is not allowed/,
    );
    const empty = await createRepo([
      { fixture: 'theme-only', files: { 'README.md': ' ' } },
    ]);
    await expect(publish(empty, out, [NIGHT])).rejects.toThrow(/README/);
    const moved = await createRepo([
      { fixture: 'theme-only', dirName: 'other' },
    ]);
    await expect(publish(moved, out, ['other'])).rejects.toThrow(
      /does not match manifest id/,
    );
  });

  it('without name/description/author the build refuses', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only', manifest: { author: undefined } },
    ]);
    await expect(publish(repo, await makeTemp(), [NIGHT])).rejects.toThrow(
      /lacks publication metadata: author/,
    );
  });
});
