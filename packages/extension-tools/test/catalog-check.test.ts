import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { checkCatalog, formatFinding } from '../src/catalog/check.ts';
import type { CheckOptions } from '../src/catalog/check.ts';
import { createGithubChecker } from '../src/catalog/github.ts';
import { RULES } from '../src/catalog/rules.ts';
import { CatalogUsageError } from '../src/errors.ts';
import { makeTemp } from './helpers.ts';
import { png } from '../../extension-catalog/test/samples.ts';
import {
  createRepo,
  renameDir,
  setVersion,
  writePublished,
} from './catalog-helpers.ts';
import type { ExtensionSpec, Repo } from './catalog-helpers.ts';

const ID = 'acme.night';

const run = async (
  repo: Repo,
  options: Partial<CheckOptions> = {},
): Promise<string[]> => {
  const findings = await checkCatalog({
    extensionsDir: repo.extensionsDir,
    skipGithubCheck: true,
    ...options,
  });
  return findings.map(formatFinding);
};

const single = (spec: Partial<ExtensionSpec> = {}) =>
  createRepo([{ fixture: 'theme-only', ...spec }]);

const expectRule = async (
  spec: Partial<ExtensionSpec>,
  rule: string,
  severity = 'error',
  options: Partial<CheckOptions> = {},
): Promise<string> => {
  const lines = await run(await single(spec), options);
  const hit = lines.find((line) => line.includes(` ${rule} `));
  expect(hit, lines.join('\n')).toBeDefined();
  expect(hit?.startsWith(`${severity} ${ID} ${rule} `)).toBe(true);
  return hit as string;
};

describe('catalog check: rules', () => {
  it('a correct project yields no findings; all rules are listed with titles', async () => {
    expect(await run(await single())).toEqual([]);
    const ids = RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('CHECK-001');
    expect(RULES.every((rule) => rule.title.length > 0)).toBe(true);
  });

  it('CHECK-001: unreadable and invalid manifest', async () => {
    await expectRule({ files: { 'extension.json': '{}' } }, 'CHECK-001');
    await expectRule({ files: { 'extension.json': null } }, 'CHECK-001');
  });

  it('CHECK-002: directory name is not equal to id', async () => {
    const repo = await single({ dirName: 'other' });
    expect(await run(repo)).toEqual([
      "error other CHECK-002 id: directory name 'other' does not match manifest id 'acme.night'",
    ]);
    await renameDir(repo, 'other', ID);
    expect(await run(repo)).toEqual([]);
  });

  it('CHECK-003: name, description, author are required', async () => {
    for (const key of ['name', 'description', 'author']) {
      const hit = await expectRule(
        { manifest: { [key]: undefined } },
        'CHECK-003',
      );
      expect(hit).toContain(`${key}:`);
    }
    await expectRule({ manifest: { name: 'x'.repeat(81) } }, 'CHECK-003');
  });

  it('CHECK-004: README.md is required and non-empty', async () => {
    await expectRule({ files: { 'README.md': null } }, 'CHECK-004');
    await expectRule({ files: { 'README.md': '  \n' } }, 'CHECK-004');
  });

  it('CHECK-005: author must be a GitHub login', async () => {
    const hit = await expectRule(
      { manifest: { author: '-bad_login' } },
      'CHECK-005',
    );
    expect(hit).toContain('author:');
  });

  it('CHECK-006: author exists on GitHub; a network failure is a warning', async () => {
    const repo = await single();
    const check = (status: 'exists' | 'missing' | 'unknown') =>
      run(repo, {
        skipGithubCheck: false,
        checkGithubUser: () => Promise.resolve(status),
      });
    expect(await check('exists')).toEqual([]);
    expect(await check('missing')).toEqual([
      "error acme.night CHECK-006 author: GitHub user 'octo-cat' does not exist",
    ]);
    expect(await check('unknown')).toEqual([
      "warning acme.night CHECK-006 author: could not verify GitHub user 'octo-cat'",
    ]);
  });

  it('CHECK-006: --skip-github-check does not contact GitHub', async () => {
    const checkGithubUser = vi.fn();
    await run(await single(), { checkGithubUser });
    expect(checkGithubUser).not.toHaveBeenCalled();
  });

  it('CHECK-007: package.json is required and must parse', async () => {
    await expectRule({ files: { 'package.json': null } }, 'CHECK-007');
    await expectRule({ files: { 'package.json': '{oops' } }, 'CHECK-007');
    await expectRule({ files: { 'package.json': '[]' } }, 'CHECK-007');
  });

  it.each(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock'])(
    'CHECK-008: lock file %s is accepted, without one — an error',
    async (lockfile) => {
      const files = { 'package-lock.json': null, [lockfile]: '{}' };
      expect(await run(await single({ files }))).toEqual([]);
      await expectRule({ files: { 'package-lock.json': null } }, 'CHECK-008');
    },
  );

  it.each([
    'preinstall',
    'install',
    'postinstall',
    'prepare',
    'prepublish',
    'prepublishOnly',
    'prepack',
    'postpack',
  ])('CHECK-009: script %s is forbidden, build is allowed', async (script) => {
    const allowed = JSON.stringify({ scripts: { build: 'dolphy-ext build' } });
    expect(
      await run(await single({ files: { 'package.json': allowed } })),
    ).toEqual([]);
    const bad = JSON.stringify({ scripts: { [script]: 'node x.js' } });
    const hit = await expectRule(
      { files: { 'package.json': bad } },
      'CHECK-009',
    );
    expect(hit).toContain(`scripts.${script}:`);
  });

  it.each([
    'git+https://github.com/a/b.git',
    'github:a/b',
    'a/b',
    'https://example.com/x.tgz',
    'http://example.com/x.tgz',
    'file:../x',
    'link:../x',
    'workspace:*',
    '../x',
  ])('CHECK-010: dependency %s is not from the registry', async (specifier) => {
    const manifest = JSON.stringify({ devDependencies: { dep: specifier } });
    const hit = await expectRule(
      { files: { 'package.json': manifest } },
      'CHECK-010',
    );
    expect(hit).toContain('devDependencies.dep:');
  });

  it('CHECK-010: registry ranges and npm aliases are allowed', async () => {
    const manifest = JSON.stringify({
      dependencies: {
        a: '^1.2.3',
        b: '~2.0.0',
        c: '*',
        d: 'npm:e@1.0.0',
        f: '1.x',
      },
      peerDependencies: { g: '>=1 <3' },
    });
    expect(
      await run(await single({ files: { 'package.json': manifest } })),
    ).toEqual([]);
  });

  it('CHECK-011: another’s package scope is a warning, own or no scope is not', async () => {
    await expectRule(
      { files: { 'package.json': '{"name":"@acme/x"}' } },
      'CHECK-011',
      'warning',
    );
    for (const name of ['@dolphy-app/x', 'plain']) {
      const files = { 'package.json': JSON.stringify({ name }) };
      expect(await run(await single({ files }))).toEqual([]);
    }
  });

  it('CHECK-012: version strictly greater than the published one', async () => {
    const repo = await single({ manifest: { version: '1.2.0' } });
    const check = async (versions: string[]) =>
      run(repo, { publishedIndex: await writePublished(repo, ID, versions) });
    expect(await check(['1.1.0', '1.0.0'])).toEqual([]);
    expect(await check(['1.2.0', '1.0.0'])).toEqual([
      'error acme.night CHECK-012 version: version 1.2.0 is already published',
    ]);
    expect(await check(['1.3.0'])).toEqual([
      'error acme.night CHECK-012 version: version 1.2.0 is not greater than published 1.3.0',
    ]);
  });

  it('CHECK-012: a version from the middle of the published ones — “already published”', async () => {
    const repo = await single({ manifest: { version: '1.0.0' } });
    const file = await writePublished(repo, ID, ['2.0.0', '1.0.0']);
    const lines = await run(repo, { publishedIndex: file });
    expect(lines).toEqual([
      'error acme.night CHECK-012 version: version 1.0.0 is already published',
    ]);
  });

  it('CHECK-012: no index file — nothing is published; another id does not interfere', async () => {
    const repo = await single();
    const missing = path.join(repo.root, 'none.json');
    expect(await run(repo, { publishedIndex: missing })).toEqual([]);
    const other = await writePublished(repo, 'acme.other', ['9.0.0']);
    expect(await run(repo, { publishedIndex: other })).toEqual([]);
  });

  it('CHECK-012: a broken index is an error, not a silent skip', async () => {
    const repo = await single();
    const file = path.join(repo.root, 'broken.json');
    await writeFile(file, '{"schemaVersion":2}');
    await expect(run(repo, { publishedIndex: file })).rejects.toThrow(
      /not a valid catalog index/,
    );
  });

  it('CHECK-013: limits on source count and size', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 201 }, (_, i) => [`src/f${i}.txt`, 'x']),
    );
    await expectRule({ files: many }, 'CHECK-013');
    const big = 'x'.repeat(1_000_001);
    const hit = await expectRule(
      { files: { 'src/big.txt': big } },
      'CHECK-013',
    );
    expect(hit).toContain('src/big.txt:');
    const chunk = 'x'.repeat(900_000);
    const total = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`src/c${i}.txt`, chunk]),
    );
    const sizeHit = await expectRule({ files: total }, 'CHECK-013');
    expect(sizeHit).toContain('exceed the limit of 5000000');
  });

  it('CHECK-013: node_modules, dist-ext, .dolphy and .git are not counted', async () => {
    const big = 'x'.repeat(1_000_001);
    const files = {
      'node_modules/dep/index.js': big,
      'dist-ext/main.mjs': big,
      '.dolphy/ids.d.ts': big,
      '.git/objects/blob': big,
    };
    expect(await run(await single({ files }))).toEqual([]);
  });

  it('CHECK-014: symbolic links are forbidden', async () => {
    const repo = await single();
    await symlink('README.md', path.join(repo.dirOf(ID), 'link.md'));
    expect(await run(repo)).toEqual([
      'error acme.night CHECK-014 link.md: symbolic links are not allowed',
    ]);
  });

  it.each(['.exe', '.dll', '.so', '.dylib', '.node', '.sh', '.BAT'])(
    'CHECK-015: file %s is forbidden',
    async (extension) => {
      const hit = await expectRule(
        { files: { [`bin/tool${extension}`]: 'x' } },
        'CHECK-015',
      );
      expect(hit).toContain(`bin/tool${extension}:`);
    },
  );

  it('CHECK-016: minAppVersion is not newer than --max-app-version', async () => {
    const spec = { manifest: { minAppVersion: '1.3.0' } };
    await expectRule(spec, 'CHECK-016', 'error', { maxAppVersion: '1.2.9' });
    const repo = await single(spec);
    expect(await run(repo, { maxAppVersion: '1.3.0' })).toEqual([]);
    expect(await run(repo)).toEqual([]);
  });
});

describe('catalog check: authoring rules', () => {
  const builtSite = async (
    files: Record<string, string>,
    version = '1.0.0',
  ): Promise<string> => {
    const site = await makeTemp();
    const dir = path.join(site, 'extensions', ID, version);
    await mkdir(dir, { recursive: true });
    for (const [file, text] of Object.entries(files)) {
      await writeFile(path.join(dir, file), text);
    }
    return site;
  };

  it('CHECK-019: a description under 20 characters is a warning', async () => {
    const hit = await expectRule(
      { manifest: { description: 'Too short' } },
      'CHECK-019',
      'warning',
    );
    expect(hit).toContain(' description: ');
    const repo = await single({ manifest: { description: 'x'.repeat(20) } });
    expect(await run(repo)).toEqual([]);
  });

  it('CHECK-030: CHANGELOG.md limits; a missing section of the current version is a warning', async () => {
    const good = '# Changelog\n\n## [1.0.0] - 2026-10-01\n\n- first\n';
    expect(
      await run(await single({ files: { 'CHANGELOG.md': good } })),
    ).toEqual([]);
    expect(
      await run(
        await single({ files: { 'CHANGELOG.md': '## v1.0.0\n\n- first\n' } }),
      ),
    ).toEqual([]);
    const missing = await expectRule(
      { files: { 'CHANGELOG.md': '## 0.9.0\n\n- old\n' } },
      'CHECK-030',
      'warning',
    );
    expect(missing).toContain("'## 1.0.0'");
    // `1.0.0` must not match the section of `11.0.0` or `1.0.01`
    await expectRule(
      { files: { 'CHANGELOG.md': '## 11.0.0\n\n- x\n' } },
      'CHECK-030',
      'warning',
    );
    const big = await expectRule(
      { files: { 'CHANGELOG.md': `## 1.0.0\n${'x'.repeat(64 * 1024)}` } },
      'CHECK-030',
    );
    expect(big).toContain('exceed the limit');
    await expectRule(
      { files: { 'CHANGELOG.md': Uint8Array.from([0x23, 0xff, 0xfe]) } },
      'CHECK-030',
    );
    await expectRule(
      { files: { 'CHANGELOG.md': '## 1.0.0\n\u0000\n' } },
      'CHECK-030',
    );
  });

  it('--deprecated: the form is checked, alternatives against the published index', async () => {
    const repo = await single();
    const published = await writePublished(repo, ID, ['0.9.0']);
    const list = path.join(repo.root, 'deprecated.json');
    const check = async (value: unknown, withIndex = true) => {
      await writeFile(list, JSON.stringify(value));
      return run(repo, {
        deprecated: list,
        ...(withIndex ? { publishedIndex: published } : {}),
      });
    };
    expect(await check([])).toEqual([]);
    expect(
      await check([
        { id: ID, versions: '<1.0.0', reason: 'old', alternatives: [ID] },
      ]),
    ).toEqual([]);
    const missing = await check([
      { id: ID, reason: 'old', alternatives: ['acme.gone'] },
    ]);
    expect(missing).toEqual([
      `error ${ID} deprecated alternatives: alternative 'acme.gone' is not in the index`,
    ]);
    // without an index the existence of alternatives is not checked
    expect(
      await check(
        [{ id: ID, reason: 'old', alternatives: ['acme.gone'] }],
        false,
      ),
    ).toEqual([]);
    for (const bad of [
      { id: ID, reason: '', alternatives: [] },
      { id: ID, reason: 'x'.repeat(201), alternatives: [] },
      { id: ID, reason: 'x', alternatives: ['a.b', 'a.c', 'a.d', 'a.e'] },
      { id: ID, versions: 'not a range', reason: 'x', alternatives: [] },
      { id: ID, reason: 'x', alternatives: [], extra: 1 },
    ]) {
      const lines = await check([bad]);
      expect(lines, JSON.stringify(bad)).toHaveLength(1);
      expect(lines[0]).toMatch(
        /^error deprecated\.json deprecated \/: deprecated list is invalid/,
      );
    }
    const duplicate = {
      id: ID,
      reason: 'x',
      alternatives: [],
    };
    expect((await check([duplicate, duplicate]))[0]).toContain('duplicate id');
  });

  it('CHECK-021: the id published under another author fails, the same author (any case) does not', async () => {
    const repo = await single();
    const published = await writePublished(repo, ID, ['0.9.0']);
    expect(await run(repo, { publishedIndex: published })).toEqual([]);
    const other = await single({ manifest: { author: 'someone-else' } });
    const otherLines = await run(other, {
      publishedIndex: await writePublished(other, ID, ['0.9.0']),
    });
    expect(otherLines).toEqual([
      `error ${ID} CHECK-021 author: id '${ID}' is published by 'octo-cat': the first publisher owns the id`,
    ]);
    const cased = await single({ manifest: { author: 'Octo-Cat' } });
    expect(
      await run(cased, {
        publishedIndex: await writePublished(cased, ID, ['0.9.0']),
      }),
    ).toEqual([]);
    expect(await run(other)).toEqual([]);
  });

  it('CHECK-022: eval or new Function in the built version', async () => {
    const builtDir = await builtSite({
      'main.mjs': 'new Function("return 1")',
    });
    const hit = await expectRule({}, 'CHECK-022', 'warning', { builtDir });
    expect(hit).toContain(' main.mjs: ');
  });

  it('CHECK-023: obfuscated built code', async () => {
    const builtDir = await builtSite({ 'view.mjs': `${'a'.repeat(21_000)}\n` });
    await expectRule({}, 'CHECK-023', 'warning', { builtDir });
  });

  it('CHECK-025: an embedded source map is an error', async () => {
    const builtDir = await builtSite({
      'main.mjs':
        'x();\n//# sourceMappingURL=data:application/json;base64,e30=',
    });
    await expectRule({}, 'CHECK-025', 'error', { builtDir });
  });

  it('bundle rules are silent without --built; a missing built version is one warning; only the checked version is read', async () => {
    const repo = await single();
    expect(await run(repo)).toEqual([]);
    const elsewhere = await builtSite({ 'main.mjs': 'eval("1")' }, '2.0.0');
    expect(await run(repo, { builtDir: elsewhere })).toEqual([
      expect.stringMatching(
        new RegExp(
          `^warning ${ID} CHECK-022 --built: built version is not found`,
        ),
      ),
    ]);
  });
});

describe('catalog check: assets and icon', () => {
  const svgOf = (body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

  it('CHECK-017: an unsafe SVG, a forged PNG and a mismatching file name the file and the reason', async () => {
    const repo = await single({
      files: {
        'assets/evil.svg': svgOf('<script>alert(1)</script>'),
        'assets/forged.png': png(80_000, 80_000),
        'assets/fake.webp': png(),
        'assets/bad.css': '@import url(https://example.com/x.css);',
        'assets/Upper.PNG': png(),
        'assets/good.png': png(100),
        'assets/good.css': '.a{background:url(good.png)}',
      },
    });
    const lines = (await run(repo)).filter((line) =>
      line.includes(' CHECK-017 '),
    );
    expect(lines).toHaveLength(5);
    const hit = (file: string) =>
      lines.find((line) => line.includes(` ${file}:`));
    expect(hit('assets/evil.svg')).toContain('<script>');
    expect(hit('assets/forged.png')).toContain('4096');
    expect(hit('assets/fake.webp')).toContain('WebP');
    expect(hit('assets/bad.css')).toContain('@import');
    expect(hit('assets/Upper.PNG')).toContain('lowercase');
  });

  it('CHECK-017: files outside assets/ are not read as assets', async () => {
    const repo = await single({ files: { 'src/draft.png': 'not an image' } });
    expect(await run(repo)).toEqual([]);
  });

  it('CHECK-018: a good icon passes; a missing, non-square, tiny or SVG icon fails', async () => {
    const good = await single({
      manifest: { icon: 'assets/icon.png' },
      files: { 'assets/icon.png': png(128) },
    });
    expect(await run(good)).toEqual([]);
    const bad = async (icon: string, content: Uint8Array | null) => {
      const repo = await single({
        manifest: { icon },
        files: { [icon]: content },
      });
      return (await run(repo)).filter((line) => line.includes(' CHECK-018 '));
    };
    expect((await bad('assets/icon.png', null))[0]).toContain('is not a file');
    expect((await bad('assets/icon.png', png(64, 100)))[0]).toContain('square');
    expect((await bad('assets/icon.png', png(32)))[0]).toContain('64 to 512');
    expect((await bad('assets/icon.webp', png(64)))[0]).toContain('WebP');
  });

  it('CHECK-018: an icon outside the extension directory is rejected by the manifest', async () => {
    const lines = await run(
      await single({ manifest: { icon: '../icon.png' } }),
    );
    expect(lines.some((line) => line.includes(' CHECK-001 '))).toBe(true);
  });
});

describe('catalog check: directory selection', () => {
  it('checks all subdirectories except hidden ones and files; --ids narrows the selection', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only' },
      { fixture: 'markdown-only', files: { 'README.md': null } },
    ]);
    await mkdir(path.join(repo.extensionsDir, '.github'));
    await writeFile(path.join(repo.extensionsDir, 'notes.txt'), 'x');
    expect(await run(repo)).toEqual([
      'error acme.chart CHECK-004 README.md: README.md is missing or empty',
    ]);
    expect(await run(repo, { ids: [ID] })).toEqual([]);
  });

  it('a nonexistent id in --ids and a missing directory — a usage error', async () => {
    const repo = await single();
    await expect(run(repo, { ids: ['nope'] })).rejects.toBeInstanceOf(
      CatalogUsageError,
    );
    await expect(
      run(repo, { extensionsDir: path.join(repo.root, 'absent') }),
    ).rejects.toBeInstanceOf(CatalogUsageError);
  });

  it('directory without extension.json — CHECK-001 by directory name', async () => {
    const repo = await createRepo();
    await mkdir(path.join(repo.extensionsDir, 'empty.dir'));
    const lines = await run(repo);
    expect(
      lines[0]?.startsWith('error empty.dir CHECK-001 extension.json: '),
    ).toBe(true);
  });

  it('after a version bump the CHECK-012 finding disappears', async () => {
    const repo = await single();
    const file = await writePublished(repo, ID, ['1.0.0']);
    expect(await run(repo, { publishedIndex: file })).toHaveLength(1);
    await setVersion(repo, ID, '1.0.1');
    expect(await run(repo, { publishedIndex: file })).toEqual([]);
  });
});

describe('GitHub author check', () => {
  const respond = (status: number) =>
    vi.fn(() => Promise.resolve(new Response('{}', { status })));

  it('200 — exists, 404 — does not, anything else and a network failure — unknown', async () => {
    const statuses = { exists: 200, missing: 404, unknown: 403 } as const;
    for (const [expected, status] of Object.entries(statuses)) {
      const check = createGithubChecker({ fetch: respond(status) });
      expect(await check('octo-cat')).toBe(expected);
    }
    const failing = createGithubChecker({
      fetch: () => Promise.reject(new Error('offline')),
    });
    expect(await failing('octo-cat')).toBe('unknown');
  });

  it('requests users/<login> with a token and caches the response', async () => {
    const fetcher = respond(200);
    const check = createGithubChecker({ fetch: fetcher, token: 'secret' });
    await check('octo-cat');
    await check('octo-cat');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe('https://api.github.com/users/octo-cat');
    expect(init.headers.authorization).toBe('Bearer secret');
  });
});
