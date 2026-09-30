import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  DEFAULT_SNAPSHOT_LIMITS,
  GitFetchError,
  SnapshotRejectedError,
  type SnapshotLimits,
  type SnapshotViolation,
} from '@spirula-app/engine/ports';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createIsomorphicGitFetcher } from '../src/index.ts';
import { serveGitRepo } from '@spirula-app/testkit';
import type { GitFiles, GitServer } from '@spirula-app/testkit';

// Тесты требуют системный git с `http-backend`; без него падаем громко.
beforeAll(() => {
  const r = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('system git is required for these tests');
  const backend = spawnSync('git', ['http-backend'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
  if (backend.error || /not a git command/i.test(backend.stderr)) {
    throw new Error('git http-backend is required for these tests');
  }
});

const fetcher = createIsomorphicGitFetcher({ resolveIdleTimeoutMs: 300 });
const servers: GitServer[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

const serve = async (
  files: GitFiles,
  extra: Partial<Parameters<typeof serveGitRepo>[0]> = {},
  options: Parameters<typeof serveGitRepo>[1] = {},
): Promise<GitServer> => {
  const server = await serveGitRepo({ files, ...extra }, options);
  servers.push(server);
  return server;
};

/** Каталоги `destDir`/`tmpDir` создаёт вызывающий сервис. */
const fetchSnapshot = async (
  url: string,
  ref: string | null = null,
  limits: Partial<SnapshotLimits> = {},
  signal?: AbortSignal,
) => {
  const root = await mkdtemp(join(tmpdir(), 'spirula-git-test-'));
  dirs.push(root);
  await mkdir(join(root, 'dest'));
  await mkdir(join(root, 'tmp'));
  const progress: string[] = [];
  const result = await fetcher.fetchSnapshot({
    url,
    ref,
    signal: signal ?? new AbortController().signal,
    destDir: join(root, 'dest'),
    tmpDir: join(root, 'tmp'),
    limits: { ...DEFAULT_SNAPSHOT_LIMITS, ...limits },
    onProgress: (phase) => progress.push(phase),
  });
  return { result, dest: join(root, 'dest'), progress };
};

const readTree = async (
  dir: string,
  rel = '',
): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
    const path = rel === '' ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) Object.assign(out, await readTree(dir, path));
    else out[path] = await readFile(join(dir, path), 'utf8');
  }
  return out;
};

const rejection = async (
  promise: Promise<unknown>,
): Promise<SnapshotRejectedError> => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SnapshotRejectedError);
  return error as SnapshotRejectedError;
};

const fetchFailure = async (promise: Promise<unknown>): Promise<string> => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GitFetchError);
  return (error as GitFetchError).reason;
};

describe('happy path', () => {
  it('exports the commit tree and returns the 40-hex commit', async () => {
    const files = {
      'course.yaml': 'name: demo\n',
      'units/a/unit.md': '# A\n',
      'units/a/deep/x.txt': 'x',
    };
    const server = await serve(files);
    const { result, dest, progress } = await fetchSnapshot(server.url);
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.commit).toBe(server.revParse('main'));
    expect(result.ref).toBe('refs/heads/main');
    expect(result.files).toBe(3);
    expect(result.bytes).toBe(11 + 4 + 1);
    expect(await readTree(dest)).toEqual(files);
    expect(progress).toContain('fetch');
    expect(progress).toContain('export');
  });

  it('keeps the executable bit and never writes .git', async () => {
    const server = await serve({ 'run.sh': { executable: '#!/bin/sh\n' } });
    const { dest } = await fetchSnapshot(server.url);
    expect((await stat(join(dest, 'run.sh'))).mode & 0o111).not.toBe(0);
    expect(await readdir(dest)).toEqual(['run.sh']);
  });
});

describe('refs', () => {
  it('resolves default branch, branch, tag and annotated tag', async () => {
    const server = await serve(
      { 'f.txt': 'one' },
      { branch: 'trunk', tags: ['v1'], annotatedTags: ['v2'] },
    );
    const first = server.revParse('trunk');
    server.branch('dev');
    server.commit({ 'f.txt': 'two' }, 'second');
    server.commit({ 'f.txt': 'three' }, 'third');

    const head = await fetcher.resolve({
      url: server.url,
      ref: null,
      signal: new AbortController().signal,
    });
    expect(head).toEqual({
      ref: 'refs/heads/trunk',
      commit: server.revParse('trunk'),
    });
    const branch = await fetcher.resolve({
      url: server.url,
      ref: 'dev',
      signal: new AbortController().signal,
    });
    expect(branch.ref).toBe('refs/heads/dev');
    expect(branch.commit).toBe(first);

    const light = await fetchSnapshot(server.url, 'v1');
    expect(light.result).toMatchObject({ ref: 'refs/tags/v1', commit: first });
    expect(await readTree(light.dest)).toEqual({ 'f.txt': 'one' });

    const annotated = await fetchSnapshot(server.url, 'v2');
    expect(annotated.result).toMatchObject({
      ref: 'refs/tags/v2',
      commit: first,
    });
    expect(await readTree(annotated.dest)).toEqual({ 'f.txt': 'one' });

    const tip = await fetchSnapshot(server.url, 'trunk');
    expect(await readTree(tip.dest)).toEqual({ 'f.txt': 'three' });
  });

  it('fails with ref-not-found for an unknown ref', async () => {
    const server = await serve({ 'f.txt': 'x' });
    const signal = new AbortController().signal;
    const error = await fetcher
      .resolve({ url: server.url, ref: 'nope', signal })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitFetchError);
    expect((error as GitFetchError).reason).toBe('ref-not-found');
    expect(await fetchFailure(fetchSnapshot(server.url, 'nope'))).toBe(
      'ref-not-found',
    );
  });
});

describe('network failures', () => {
  it('maps 404 to not-found', async () => {
    const server = await serve({ 'f.txt': 'x' });
    const missing = server.url.replace('/repo.git', '/other.git');
    expect(await fetchFailure(fetchSnapshot(missing))).toBe('not-found');
  });

  it('maps a non-git HTTP answer to not-found', async () => {
    const server = await serve({ 'f.txt': 'x' }, {}, { status: 404 });
    expect(await fetchFailure(fetchSnapshot(server.url))).toBe('not-found');
  });

  it.each([401, 403])('maps %i to auth-required', async (status) => {
    const server = await serve({ 'f.txt': 'x' }, {}, { status });
    expect(await fetchFailure(fetchSnapshot(server.url))).toBe('auth-required');
  });

  it('maps a closed port to network', async () => {
    const server = await serve({ 'f.txt': 'x' });
    const url = server.url;
    await server.close();
    servers.length = 0;
    expect(await fetchFailure(fetchSnapshot(url))).toBe('network');
  });

  it('maps a silent server to timeout', async () => {
    const server = await serve({ 'f.txt': 'x' }, {}, { stallMs: 5_000 });
    const started = Date.now();
    expect(
      await fetchFailure(
        fetchSnapshot(server.url, null, { idleTimeoutMs: 200 }),
      ),
    ).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('rejects the resolve of a silent server with timeout', async () => {
    const server = await serve({ 'f.txt': 'x' }, {}, { stallMs: 5_000 });
    expect(
      await fetchFailure(
        fetcher.resolve({
          url: server.url,
          ref: null,
          signal: new AbortController().signal,
        }),
      ),
    ).toBe('timeout');
  });

  it('aborts on signal with AbortError and stops promptly', async () => {
    const server = await serve({ 'f.txt': 'x' }, {}, { stallMs: 5_000 });
    const controller = new AbortController();
    const pending = fetchSnapshot(server.url, null, {}, controller.signal);
    // Реальный сокет: отмена должна прийти, пока запрос висит на сервере.
    setTimeout(() => controller.abort(), 100);
    const started = Date.now();
    const error = await pending.catch((e: unknown) => e);
    expect((error as Error).name).toBe('AbortError');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('rejects an already aborted signal', async () => {
    const server = await serve({ 'f.txt': 'x' });
    const error = await fetchSnapshot(
      server.url,
      null,
      {},
      AbortSignal.abort(),
    ).catch((e: unknown) => e);
    expect((error as Error).name).toBe('AbortError');
  });

  it('fails with too-large when the download exceeds maxBytes', async () => {
    // Несжимаемые данные больше maxBytes + запас на протокол (1 МиБ).
    const server = await serve({ 'big.bin': randomBytes(1_500_000) });
    expect(
      await fetchFailure(fetchSnapshot(server.url, null, { maxBytes: 1000 })),
    ).toBe('too-large');
  });

  it('refuses non-http schemes', async () => {
    await expect(fetchSnapshot('file:///etc/passwd')).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});

describe('snapshot rules (R7)', () => {
  const expectViolation = async (
    files: GitFiles,
    violation: SnapshotViolation,
    limits: Partial<SnapshotLimits> = {},
  ): Promise<void> => {
    const server = await serve(files);
    const error = await rejection(fetchSnapshot(server.url, null, limits));
    expect(error.violation).toBe(violation);
  };

  it('rejects a symlink', () =>
    expectViolation(
      { 'ok.txt': 'x', 'units/link': { symlink: '../../etc/passwd' } },
      'symlink',
    ));

  it('rejects a submodule', () =>
    expectViolation(
      { 'ok.txt': 'x', sub: { gitlink: '1'.repeat(40) } },
      'special-file',
    ));

  it.each(['.git/config', 'a/.GIT/x', 'a/.Git'])(
    'rejects the .git segment in %s',
    (path) => expectViolation({ [path]: 'x' }, 'git-segment'),
  );

  it.each(['a/../b', '../x', './y'])('rejects the path %s', (path) =>
    expectViolation({ [path]: 'x' }, 'path-escapes'),
  );

  it('rejects paths that differ only by case', () =>
    expectViolation({ 'Unit/a.md': '1', 'unit/b.md': '2' }, 'case-collision'));

  it('rejects a file above maxFileBytes', () =>
    expectViolation({ 'a.txt': '1234567890' }, 'file-too-large', {
      maxFileBytes: 9,
    }));

  it('rejects a snapshot above maxBytes', () =>
    expectViolation(
      { 'a.txt': '12345', 'b.txt': '12345', 'c.txt': '12345' },
      'too-large',
      { maxBytes: 12 },
    ));

  it('rejects more than maxFiles files', () =>
    expectViolation({ a: '1', b: '2', c: '3' }, 'too-many-files', {
      maxFiles: 2,
    }));

  it('accepts exactly maxFiles files and exactly maxFileBytes bytes', async () => {
    const server = await serve({ a: '12345', b: '12345' });
    const { result } = await fetchSnapshot(server.url, null, {
      maxFiles: 2,
      maxFileBytes: 5,
      maxBytes: 10,
    });
    expect(result.files).toBe(2);
  });
});
