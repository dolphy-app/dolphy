import { readFile, writeFile } from 'node:fs/promises';
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

describe('spirula-ext catalog check', () => {
  it('без замечаний: код 0 и пустой вывод', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const result = await exec([
      'catalog',
      'check',
      repo.extensionsDir,
      '--skip-github-check',
    ]);
    expect(result).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('ошибки: строки «severity id RULE поле: сообщение», код 1; предупреждения кода не меняют', async () => {
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
      "warning acme.chart CHECK-011 name: package scope of '@acme/x' is not @spirula-app\n" +
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

  it('автор проверяется через GitHub API с токеном из окружения', async () => {
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

  it('--published-index и --max-app-version работают через CLI', async () => {
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

  it('--list-rules печатает все правила', async () => {
    const result = await exec(['catalog', 'check', '--list-rules']);
    expect(result.code).toBe(0);
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(RULES.length);
    expect(lines[0]).toMatch(/^CHECK-001 \S/);
  });

  it('ошибки использования дают код 2', async () => {
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

  it('справка описывает подкоманды catalog', async () => {
    const result = await exec(['--help']);
    expect(result.stdout).toContain('spirula-ext catalog check');
    expect(result.stdout).toContain('spirula-ext catalog build');
  });
});

describe('spirula-ext catalog build', () => {
  it('печатает строку на расширение: published, затем unchanged', async () => {
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
      await readFile(path.join(out, 'index.json'), 'utf8'),
    );
    expect(index.extensions).toHaveLength(1);
  });

  it('ошибка сборки: код 1, сообщение в stderr, индекс не создан', async () => {
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
    await expect(readFile(path.join(out, 'index.json'))).rejects.toThrow();
  });

  it('--previous-index, --revoked, --source-base и --published-at доходят до сборки', async () => {
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
      await readFile(path.join(out, 'index.json'), 'utf8'),
    );
    expect(index.extensions[0].source).toBe('https://example.org/x/acme.night');
    expect(index.extensions[0].versions[0].publishedAt).toBe(
      '2026-03-04T05:06:07Z',
    );
    expect(index.revoked).toHaveLength(1);
  });
});
