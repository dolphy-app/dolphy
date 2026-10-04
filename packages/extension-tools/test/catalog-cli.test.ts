import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RULES } from '../src/catalog/rules.ts';
import { runCli } from '../src/cli/run.ts';
import type { CliDeps } from '../src/cli/run.ts';
import { createIo, createRepo, writePublished } from './catalog-helpers.ts';
import { makeTemp } from './helpers.ts';

const exec = async (args: string[], deps: CliDeps = {}) => {
  const cli = createIo();
  const code = await runCli(args, cli.io, deps);
  return { code, stdout: cli.stdout(), stderr: cli.stderr() };
};

describe('dolphy-ext catalog check', () => {
  it('no findings: code 0 and empty output', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const result = await exec([
      'catalog',
      'check',
      repo.extensionsDir,
      '--skip-github-check',
    ]);
    expect(result).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('errors: lines “severity id RULE field: message”, code 1; warnings do not change the code', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only', files: { 'README.md': null } },
      {
        fixture: 'markdown-only',
        files: { 'package.json': '{"name":"@acme/x"}' },
      },
    ]);
    const result = await exec([
      'catalog',
      'check',
      repo.extensionsDir,
      '--skip-github-check',
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe(
      "warning acme.chart CHECK-011 name: package scope of '@acme/x' is not @dolphy-app\n" +
        'error acme.night CHECK-004 README.md: README.md is missing or empty\n',
    );

    const onlyWarning = await exec([
      'catalog',
      'check',
      repo.extensionsDir,
      '--ids',
      'acme.chart',
      '--skip-github-check',
    ]);
    expect(onlyWarning.code).toBe(0);
    expect(onlyWarning.stdout).toContain('warning acme.chart CHECK-011');
  });

  it('the author is checked via the GitHub API with a token from the environment', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const fetcher = vi.fn(() =>
      Promise.resolve(new Response('', { status: 404 })),
    );
    const result = await exec(['catalog', 'check', repo.extensionsDir], {
      fetch: fetcher as unknown as typeof fetch,
      env: { GITHUB_TOKEN: 't0ken' },
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe(
      "error acme.night CHECK-006 author: GitHub user 'octo-cat' does not exist\n",
    );
    const calls = fetcher.mock.calls as unknown as [
      string,
      { headers: Record<string, string> },
    ][];
    expect(calls[0]?.[1].headers.authorization).toBe('Bearer t0ken');
  });

  it('--published-index и --max-app-version work through the CLI', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only', manifest: { minAppVersion: '2.0.0' } },
    ]);
    const published = await writePublished(repo, 'acme.night', ['1.0.0']);
    const result = await exec([
      'catalog',
      'check',
      repo.extensionsDir,
      '--skip-github-check',
      '--published-index',
      published,
      '--max-app-version',
      '1.5.0',
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      'CHECK-012 version: version 1.0.0 is already',
    );
    expect(result.stdout).toContain('CHECK-016 minAppVersion');
  });

  it('--list-rules prints all rules', async () => {
    const result = await exec(['catalog', 'check', '--list-rules']);
    expect(result.code).toBe(0);
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(RULES.length);
    expect(lines).toHaveLength(27);
    expect(lines[0]).toMatch(/^CHECK-001 \S/);
  });

  it('--built enables the bundle rules; a source map fails the run', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const built = path.join(repo.root, 'site/extensions/acme.night/1.0.0');
    await mkdir(built, { recursive: true });
    await writeFile(
      path.join(built, 'main.mjs'),
      'x();\n//# sourceMappingURL=data:application/json;base64,e30=',
    );
    const base = [
      'catalog',
      'check',
      repo.extensionsDir,
      '--skip-github-check',
    ];
    expect((await exec(base)).code).toBe(0);
    const result = await exec([
      ...base,
      '--built',
      path.join(repo.root, 'site'),
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('error acme.night CHECK-025 main.mjs:');
    expect((await exec([...base, '--built'])).code).toBe(2);
  });

  it('usage errors give code 2', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    for (const args of [
      ['catalog'],
      ['catalog', 'publish'],
      ['catalog', 'check'],
      ['catalog', 'check', repo.extensionsDir, '--wat'],
      ['catalog', 'check', repo.extensionsDir, '--ids'],
      ['catalog', 'check', repo.extensionsDir, '--max-app-version', 'abc'],
      ['catalog', 'check', repo.extensionsDir, '--ids', 'missing'],
      ['catalog', 'check', path.join(repo.root, 'absent')],
      ['catalog', 'build', '--ids', 'a', '--out', 'o'],
      ['catalog', 'build', '--src', 's', '--out', 'o'],
      ['catalog', 'build', '--src', 's', '--ids', 'a'],
    ]) {
      expect((await exec(args)).code, args.join(' ')).toBe(2);
    }
  });

  it('help describes the catalog subcommands', async () => {
    const result = await exec(['--help']);
    expect(result.stdout).toContain('dolphy-ext catalog check');
    expect(result.stdout).toContain('dolphy-ext catalog build');
  });
});

describe('dolphy-ext catalog build', () => {
  it('prints a line per extension: published, then unchanged', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    const args = [
      'catalog',
      'build',
      '--src',
      repo.extensionsDir,
      '--ids',
      'acme.night',
      '--out',
      out,
    ];
    const first = await exec(args);
    expect(first.code).toBe(0);
    expect(first.stdout).toMatch(
      /^published acme\.night@1\.0\.0 \(2 files, \d+ bytes\)\n$/,
    );
    expect((await exec(args)).stdout).toBe('unchanged acme.night@1.0.0\n');
    const index = JSON.parse(
      await readFile(path.join(out, 'index.v2.json'), 'utf8'),
    );
    expect(index.extensions).toHaveLength(1);
  });

  it('build error: code 1, message in stderr, index not created', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only', files: { 'README.md': null } },
    ]);
    const out = await makeTemp();
    const result = await exec([
      'catalog',
      'build',
      '--src',
      repo.extensionsDir,
      '--ids',
      'acme.night',
      '--out',
      out,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      'error acme.night: README.md is missing or empty\n',
    );
    await expect(readFile(path.join(out, 'index.v2.json'))).rejects.toThrow();
  });

  it('--previous-index, --revoked, --source-base и --published-at reach the build', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    const revoked = path.join(out, 'revoked.json');
    await writeFile(
      revoked,
      JSON.stringify([{ id: 'acme.night', versions: '<1.0.0', reason: 'old' }]),
    );
    const result = await exec([
      'catalog',
      'build',
      '--src',
      repo.extensionsDir,
      '--ids',
      'acme.night,acme.night',
      '--out',
      out,
      '--previous-index',
      path.join(out, 'none.json'),
      '--revoked',
      revoked,
      '--source-base',
      'https://example.org/x',
      '--published-at',
      '2026-03-04T05:06:07Z',
    ]);
    expect(result.code).toBe(0);
    const index = JSON.parse(
      await readFile(path.join(out, 'index.v2.json'), 'utf8'),
    );
    expect(index.extensions[0].source).toBe('https://example.org/x/acme.night');
    expect(index.extensions[0].versions[0].publishedAt).toBe(
      '2026-03-04T05:06:07Z',
    );
    expect(index.revoked).toHaveLength(1);
  });
});

describe('dolphy-ext catalog build --reindex', () => {
  const setup = async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    await exec([
      'catalog',
      'build',
      '--src',
      repo.extensionsDir,
      '--ids',
      'acme.night',
      '--out',
      out,
    ]);
    const indexFile = path.join(out, 'index.v2.json');
    const revokedFile = path.join(out, 'revoked.json');
    return { out, indexFile, revokedFile };
  };
  const readIndex = async (file: string) =>
    JSON.parse(await readFile(file, 'utf8'));

  it('adds a revocation, keeping extension entries, and updates generatedAt', async () => {
    const { out, indexFile, revokedFile } = await setup();
    const before = await readIndex(indexFile);
    await writeFile(
      revokedFile,
      JSON.stringify([
        { id: 'acme.night', versions: '<=1.0.0', reason: 'bad' },
      ]),
    );
    const now = new Date('2030-01-02T03:04:05.000Z');
    const result = await exec(
      ['catalog', 'build', '--reindex', '--out', out, '--revoked', revokedFile],
      { now: () => now },
    );
    expect(result).toEqual({
      code: 0,
      stdout: 'reindexed (1 extensions, 1 revoked)\n',
      stderr: '',
    });
    const after = await readIndex(indexFile);
    expect(after.extensions).toEqual(before.extensions);
    expect(after.revoked).toEqual([
      { id: 'acme.night', versions: '<=1.0.0', reason: 'bad' },
    ]);
    expect(after.generatedAt).toBe(now.toISOString());
  });

  it('--deprecated reaches build --reindex and catalog check; a bad alternative exits 1 without touching the index', async () => {
    const { out, indexFile } = await setup();
    const file = path.join(out, 'deprecated.json');
    await writeFile(
      file,
      JSON.stringify([{ id: 'acme.night', reason: 'Old', alternatives: [] }]),
    );
    const base = ['catalog', 'build', '--reindex', '--out', out];
    expect((await exec([...base, '--deprecated', file])).code).toBe(0);
    expect((await readIndex(indexFile)).extensions[0].deprecated).toEqual({
      versions: null,
      reason: 'Old',
      alternatives: [],
    });
    const before = await readFile(indexFile, 'utf8');
    await writeFile(
      file,
      JSON.stringify([
        { id: 'acme.night', reason: 'Old', alternatives: ['acme.missing'] },
      ]),
    );
    const built = await exec([...base, '--deprecated', file]);
    expect(built.code).toBe(1);
    expect(built.stderr).toContain("alternative 'acme.missing'");
    expect(await readFile(indexFile, 'utf8')).toBe(before);
    const repo = await createRepo([]);
    const checked = await exec([
      'catalog',
      'check',
      repo.extensionsDir,
      '--skip-github-check',
      '--deprecated',
      file,
      '--published-index',
      indexFile,
    ]);
    expect(checked.code).toBe(1);
    expect(checked.stdout).toBe(
      "error acme.night deprecated alternatives: alternative 'acme.missing' is not in the index\n",
    );
  });

  it('without --revoked the list is kept, an empty array clears it', async () => {
    const { out, indexFile, revokedFile } = await setup();
    await writeFile(
      revokedFile,
      JSON.stringify([{ id: 'acme.night', versions: '<1.0.0', reason: 'old' }]),
    );
    const base = ['catalog', 'build', '--reindex', '--out', out];
    await exec([...base, '--revoked', revokedFile]);
    expect((await exec(base)).stdout).toBe(
      'reindexed (1 extensions, 1 revoked) — no changes\n',
    );
    expect((await readIndex(indexFile)).revoked).toHaveLength(1);
    await writeFile(revokedFile, '[]');
    expect((await exec([...base, '--revoked', revokedFile])).stdout).toBe(
      'reindexed (1 extensions, 0 revoked)\n',
    );
    expect((await readIndex(indexFile)).revoked).toEqual([]);
  });

  it('--previous-index takes the source index from another file', async () => {
    const { indexFile } = await setup();
    const target = await makeTemp();
    const result = await exec([
      'catalog',
      'build',
      '--reindex',
      '--out',
      target,
      '--previous-index',
      indexFile,
    ]);
    expect(result.code).toBe(0);
    expect(
      (await readIndex(path.join(target, 'index.v2.json'))).extensions,
    ).toHaveLength(1);
  });

  it('no index — a usage error', async () => {
    const result = await exec([
      'catalog',
      'build',
      '--reindex',
      '--out',
      await makeTemp(),
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('nothing to reindex');
  });

  it('invalid range in --revoked: code 1, index untouched', async () => {
    const { out, indexFile, revokedFile } = await setup();
    const before = await readFile(indexFile, 'utf8');
    await writeFile(
      revokedFile,
      JSON.stringify([{ id: 'acme.night', versions: 'nonsense', reason: 'x' }]),
    );
    const result = await exec([
      'catalog',
      'build',
      '--reindex',
      '--out',
      out,
      '--revoked',
      revokedFile,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('resulting index is invalid');
    expect(await readFile(indexFile, 'utf8')).toBe(before);
  });

  it('--src, --ids и --source-base together with --reindex, as well as a missing --out — usage errors', async () => {
    for (const extra of [
      ['--ids', 'a'],
      ['--src', 'x'],
      ['--source-base', 'https://example.org'],
    ]) {
      const result = await exec([
        'catalog',
        'build',
        '--reindex',
        '--out',
        'o',
        ...extra,
      ]);
      expect(result.code, extra.join(' ')).toBe(2);
    }
    expect((await exec(['catalog', 'build', '--reindex'])).code).toBe(2);
  });

  it('the same revocation list — the file is not rewritten', async () => {
    const { out, indexFile, revokedFile } = await setup();
    await writeFile(
      revokedFile,
      JSON.stringify([{ id: 'acme.night', versions: '<1.0.0', reason: 'old' }]),
    );
    const args = ['catalog', 'build', '--reindex', '--out', out];
    await exec([...args, '--revoked', revokedFile]);
    const before = await readFile(indexFile, 'utf8');
    const result = await exec([...args, '--revoked', revokedFile], {
      now: () => new Date('2040-01-01T00:00:00.000Z'),
    });
    expect(result.stdout).toBe(
      'reindexed (1 extensions, 1 revoked) — no changes\n',
    );
    expect(await readFile(indexFile, 'utf8')).toBe(before);
  });
});

describe('catalog build: rerun without changes', () => {
  it('all extensions unchanged and the same revocation — index.v2.json stays as it was', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    const args = [
      'catalog',
      'build',
      '--src',
      repo.extensionsDir,
      '--ids',
      'acme.night',
      '--out',
      out,
    ];
    await exec(args);
    const indexFile = path.join(out, 'index.v2.json');
    const before = await readFile(indexFile, 'utf8');
    const again = await exec(args, {
      now: () => new Date('2040-01-01T00:00:00.000Z'),
    });
    expect(again.stdout).toBe('unchanged acme.night@1.0.0\n');
    expect(await readFile(indexFile, 'utf8')).toBe(before);
  });
});
