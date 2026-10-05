import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { EngineEvent, RepositoryPhase } from '@dolphy-app/engine-contract';
import {
  buildLibrary,
  createFakeClock,
  createFakeExerciseTypes,
  createFakeExtensionHostControl,
  createFakeExtensionInstaller,
  createFakeExtensionPolicy,
  createFakeExtensionRegistry,
  createFakeExtensionCommands,
  createFakeExtensionTransfers,
  createFakeExtensionReloader,
  createFakeGradePolicies,
  createSeededRng,
  createTestIds,
  renderLibrary,
} from '@dolphy-app/testkit';
import type { CourseLibrary } from '@dolphy-app/testkit';
import { describe, expect, it, vi } from 'vitest';
import {
  EngineError,
  createEngine,
  createExtensionHealth,
  recoverRepositories,
} from '../../../src/app/index.ts';
import {
  MAX_HELD_PREVIEWS,
  PREVIEW_TTL_MS,
} from '../../../src/app/services/repositories.ts';
import {
  createMemoryEventStore,
  createMemoryExtensionDataStore,
  createMemoryRepositoryStore,
  createNodeFsCourseSource,
  createNodeSnapshotInstaller,
  nodeDefaults,
} from '../../../src/node/index.ts';
import {
  GitFetchError,
  SnapshotRejectedError,
} from '../../../src/ports/index.ts';
import type {
  GitSnapshotFetcher,
  RepositoryStore,
} from '../../../src/ports/index.ts';
import { createTestEngine } from '../../helpers/engine.ts';
import type { TestEngine } from '../../helpers/engine.ts';
import { useTmpDirs, writeFiles } from '../../helpers/tmp.ts';

const tmp = useTmpDirs();

const URL_SQL = 'https://example.com/acme/sql';
const ID_SQL = 'example.com-acme-sql';

const sha = (n: number) => n.toString(16).padStart(40, '0');

const course = (id: string, lessons = 1): CourseLibrary =>
  buildLibrary({
    courses: [
      {
        id,
        lessons: Array.from({ length: lessons }, (_, i) => ({
          id: `l${i}`,
          exercises: 2,
        })),
      },
    ],
  });

const filesOf = (library: CourseLibrary): Record<string, string> =>
  Object.fromEntries(renderLibrary(library));

interface Remote {
  commit: string;
  files: Record<string, string>;
  resolveError?: Error;
  fetchError?: Error;
}

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const aborted = (signal: AbortSignal) => {
  const { promise, reject } = deferred<never>();
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener('abort', () => reject(signal.reason));
  return promise;
};

interface Gate {
  open: Promise<void>;
  /** Загрузка дошла до блокировки. */
  reached(): void;
}

interface FakeGit {
  remotes: Map<string, Remote>;
  calls: string[];
  fetcher: GitSnapshotFetcher;
  /** Блокирует `fetchSnapshot`: `started` — загрузка дошла до блокировки, `release` — пустить дальше. */
  block(): { release(): void; started: Promise<void> };
}

/** Скриптованный git-сервер: по URL отдаёт коммит и файлы; сеть можно заблокировать. */
const createFakeGit = (): FakeGit => {
  const remotes = new Map<string, Remote>();
  const calls: string[] = [];
  let gate: Gate | null = null;
  const remoteOf = (url: string) => {
    const remote = remotes.get(url);
    if (remote === undefined) throw new GitFetchError('not-found', url);
    return remote;
  };
  const fetcher: GitSnapshotFetcher = {
    resolve: async ({ url }) => {
      calls.push(`resolve ${url}`);
      const remote = remoteOf(url);
      if (remote.resolveError) throw remote.resolveError;
      return { ref: 'refs/heads/main', commit: remote.commit };
    },
    fetchSnapshot: async ({ url, signal, destDir, onProgress }) => {
      calls.push(`fetch ${url}`);
      const remote = remoteOf(url);
      onProgress('fetch', { loaded: 1, total: 2 });
      if (gate !== null) {
        gate.reached();
        await Promise.race([gate.open, aborted(signal)]);
      }
      if (remote.fetchError) throw remote.fetchError;
      await writeFiles(destDir, remote.files);
      const count = Object.keys(remote.files).length;
      onProgress('export', { loaded: count, total: count });
      return {
        ref: 'refs/heads/main',
        commit: remote.commit,
        files: count,
        bytes: 0,
      };
    },
  };
  return {
    remotes,
    calls,
    fetcher,
    block: () => {
      const open = deferred();
      const started = deferred();
      gate = { open: open.promise, reached: started.resolve };
      return { release: open.resolve, started: started.promise };
    },
  };
};

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

interface Opened extends TestEngine {
  git: FakeGit;
  store: RepositoryStore;
  libraryRoot: string;
  dataDir: string;
  courseIds(): Promise<string[]>;
}

/** Библиотека на диске с курсом `base`; поверх — настоящий движок со скриптованным git. */
const open = async (
  options: { store?: RepositoryStore; git?: FakeGit } = {},
): Promise<Opened> => {
  const root = await tmp.make();
  const libraryRoot = join(root, 'library');
  const dataDir = join(root, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFiles(libraryRoot, filesOf(course('base')));
  const git = options.git ?? createFakeGit();
  const store = options.store ?? createMemoryRepositoryStore();
  const t = await createTestEngine({
    library: createNodeFsCourseSource(libraryRoot),
    config: { libraryRoot, dataDir },
    snapshotFetcher: git.fetcher,
    repositoryStore: store,
  });
  const courseIds = async () =>
    (await t.engine.library.listCourses()).items.map(({ id }) => id);
  return { ...t, git, store, libraryRoot, dataDir, courseIds };
};

const remote = (t: Opened, url: string, library: CourseLibrary, n = 1) => {
  t.git.remotes.set(url, { commit: sha(n), files: filesOf(library) });
};

const failure = async (promise: Promise<unknown>): Promise<EngineError> => {
  try {
    await promise;
  } catch (error) {
    return error as EngineError;
  }
  throw new Error('expected the call to reject');
};

const phasesOf = (events: readonly EngineEvent[]): RepositoryPhase[] => {
  const phases: RepositoryPhase[] = [];
  for (const event of events) {
    if (event.type === 'repository-progress' && phases.at(-1) !== event.phase) {
      phases.push(event.phase);
    }
  }
  return phases;
};

/**
 * Нет ни `.staging`, ни `git-tmp`, ни операций в `.trash`: операция убрала за
 * собой (пустые корзины корней `.trash/repositories` и `.trash/imported` не в счёт).
 */
const expectClean = async (t: Opened) => {
  for (const dir of [
    join(t.libraryRoot, '.staging'),
    join(t.dataDir, 'git-tmp'),
  ]) {
    expect(await readdir(dir).catch(() => [])).toEqual([]);
  }
  const trash = join(t.libraryRoot, '.trash');
  for (const root of await readdir(trash).catch(() => [])) {
    expect(['repositories', 'imported']).toContain(root);
    expect(await readdir(join(trash, root))).toEqual([]);
  }
};

describe('repositories.add', () => {
  it('loads the courses into the library and reports progress in phase order (R1, R8)', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    const dto = await t.engine.repositories.add({ url: `${URL_SQL}.git/` });
    expect(dto).toMatchObject({
      id: ID_SQL,
      url: URL_SQL,
      ref: null,
      status: 'ready',
      courseIds: ['sql'],
      fetchedAt: t.clock.now(),
    });
    expect(dto.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await t.courseIds()).toEqual(['base', 'sql']);
    expect(await t.engine.repositories.list()).toEqual([dto]);
    expect(await t.store.list()).toHaveLength(1);

    expect(phasesOf(t.events)).toEqual([
      'resolve',
      'fetch',
      'export',
      'validate',
      'reload',
    ]);
    const lastProgress = t.events.findLastIndex(
      ({ type }) => type === 'repository-progress',
    );
    const reloaded = t.events.findIndex(
      ({ type }) => type === 'library-reloaded',
    );
    expect(reloaded).toBeGreaterThan(lastProgress);
    expect(t.events).toContainEqual({
      type: 'repository-progress',
      id: ID_SQL,
      phase: 'fetch',
      loaded: 1,
      total: 2,
    });
    await expectClean(t);
  });

  it('keeps the ref and the course files of the snapshot on disk', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    const dto = await t.engine.repositories.add({ url: URL_SQL, ref: 'v1' });
    expect(dto.ref).toBe('v1');
    expect(
      await readFile(
        join(t.libraryRoot, 'repositories', ID_SQL, 'sql/course_manifest.json'),
        'utf8',
      ),
    ).toContain('"sql"');
  });

  it('gives a second URL with the same slug a hash suffix', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    remote(t, 'https://example.com/acme/SQL', course('sql2'));
    await t.engine.repositories.add({ url: URL_SQL });
    const second = await t.engine.repositories.add({
      url: 'https://example.com/acme/SQL',
    });
    expect(second.id).toMatch(new RegExp(`^${ID_SQL}-[0-9a-f]{8}$`));
    expect(await t.courseIds()).toEqual(['base', 'sql', 'sql2']);
  });
});

describe('repositories.add input (R3)', () => {
  const bad: [string, { url: string; ref?: string }, string][] = [
    ['ftp scheme', { url: 'ftp://example.com/a/b' }, 'url'],
    ['ssh scheme', { url: 'git@example.com:a/b.git' }, 'url'],
    ['file scheme', { url: 'file:///tmp/repo' }, 'url'],
    ['login', { url: 'https://user@example.com/a/b' }, 'url'],
    ['password', { url: 'https://user:pw@example.com/a/b' }, 'url'],
    ['empty', { url: '  ' }, 'url'],
    ['garbage', { url: 'not a url' }, 'url'],
    ['query', { url: 'https://example.com/a/b?x=1' }, 'url'],
    ['ref with space', { url: URL_SQL, ref: 'a b' }, 'ref'],
    ['ref with ..', { url: URL_SQL, ref: 'a..b' }, 'ref'],
    ['ref with dash start', { url: URL_SQL, ref: '-x' }, 'ref'],
    ['ref with newline', { url: URL_SQL, ref: 'a\nb' }, 'ref'],
  ];

  it.each(bad)('rejects %s before any network call', async (_, req, field) => {
    const t = await open();
    const error = await failure(t.engine.repositories.add(req));
    expect(error).toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { field },
    });
    expect(t.git.calls).toEqual([]);
    expect(await t.store.list()).toEqual([]);
  });

  it('treats a URL that normalizes to a known one as REPOSITORY_EXISTS without a network call', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    await t.engine.repositories.add({ url: URL_SQL });
    const calls = t.git.calls.length;
    for (const url of [
      'https://EXAMPLE.com/acme/sql.git',
      'https://example.com/acme/sql/',
      `${URL_SQL}.git/#readme`,
    ]) {
      const error = await failure(t.engine.repositories.add({ url }));
      expect(error).toMatchObject({
        code: 'REPOSITORY_EXISTS',
        details: { id: ID_SQL },
      });
    }
    expect(t.git.calls).toHaveLength(calls);
  });

  it('refuses a directory that already occupies repositories/<id> without a record', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    await writeFiles(t.libraryRoot, { [`repositories/${ID_SQL}/x.txt`]: 'x' });
    const error = await failure(t.engine.repositories.add({ url: URL_SQL }));
    expect(error).toMatchObject({
      code: 'REPOSITORY_REJECTED',
      details: { reason: 'path-conflict' },
    });
    expect(t.git.calls).toEqual([]);
  });
});

describe('atomic add (R2)', () => {
  const expectUntouched = async (t: Opened) => {
    expect(await t.courseIds()).toEqual(['base']);
    expect(await t.store.list()).toEqual([]);
    expect(await exists(join(t.libraryRoot, 'repositories', ID_SQL))).toBe(
      false,
    );
    expect(await t.engine.library.getInfo()).toMatchObject({
      state: 'ready',
      diagnostics: { errors: 0 },
    });
    expect((await t.engine.library.getDiagnostics()).items).toEqual([]);
    await expectClean(t);
  };

  it('rejects a repository without any course', async () => {
    const t = await open();
    t.git.remotes.set(URL_SQL, { commit: sha(1), files: { 'README.md': '#' } });
    const error = await failure(t.engine.repositories.add({ url: URL_SQL }));
    expect(error).toMatchObject({
      code: 'REPOSITORY_REJECTED',
      details: { reason: 'no-courses' },
    });
    await expectUntouched(t);
  });

  it('rejects a course id that is already loaded and explains it with diagnostics', async () => {
    const t = await open();
    remote(t, URL_SQL, course('base'));
    const error = await failure(t.engine.repositories.add({ url: URL_SQL }));
    expect(error.code).toBe('REPOSITORY_REJECTED');
    expect(error.details).toMatchObject({ reason: 'reload-rejected' });
    const { diagnostics } = error.details as {
      diagnostics: { code: string }[];
    };
    expect(diagnostics.map(({ code }) => code)).toContain('E_ID_DUPLICATE');
    await expectUntouched(t);
    expect(t.events.some(({ type }) => type === 'library-reloaded')).toBe(
      false,
    );
  });

  it('rejects a broken manifest before touching the library', async () => {
    const t = await open();
    t.git.remotes.set(URL_SQL, {
      commit: sha(1),
      files: { ...filesOf(course('sql')), 'sql/course_manifest.json': '{' },
    });
    const error = await failure(t.engine.repositories.add({ url: URL_SQL }));
    expect(error.details).toMatchObject({ reason: 'invalid-library' });
    const { diagnostics } = error.details as {
      diagnostics: { code: string; path?: string }[];
    };
    expect(diagnostics.map(({ code }) => code)).toContain('E_JSON_PARSE');
    // пути — от корня репозитория, без каталога снимка
    expect(diagnostics.map(({ path }) => path)).toContain(
      'sql/course_manifest.json',
    );
    expect(diagnostics.every(({ path }) => !path?.startsWith(ID_SQL))).toBe(
      true,
    );
    expect(diagnostics.length).toBeLessThanOrEqual(50);
    await expectUntouched(t);
    // библиотека даже не перезагружалась
    expect(phasesOf(t.events)).not.toContain('reload');
  });
});

describe('repository layout', () => {
  /** Курс в корне репозитория: `course_manifest.json`, `<урок>/...` без каталога курса. */
  const rootCourse = (id: string): Record<string, string> =>
    Object.fromEntries(
      Object.entries(filesOf(course(id))).map(([path, text]) => [
        path.slice(path.indexOf('/') + 1),
        text,
      ]),
    );

  it('accepts a repository whose root is a course and shows it after the real reload', async () => {
    const t = await open();
    t.git.remotes.set(URL_SQL, { commit: sha(1), files: rootCourse('sql') });
    const dto = await t.engine.repositories.add({ url: URL_SQL });
    expect(dto).toMatchObject({ status: 'ready', courseIds: ['sql'] });
    expect(await t.courseIds()).toEqual(['base', 'sql']);
    expect(
      await exists(
        join(t.libraryRoot, 'repositories', ID_SQL, 'course_manifest.json'),
      ),
    ).toBe(true);
    expect((await t.engine.library.listLessons('sql')).items).toHaveLength(1);
    await expectClean(t);
  });

  it('still accepts courses in subdirectories, several per repository', async () => {
    const t = await open();
    t.git.remotes.set(URL_SQL, {
      commit: sha(1),
      files: {
        ...filesOf(course('one')),
        ...filesOf(course('two')),
        'docs/readme.md': '#',
      },
    });
    const dto = await t.engine.repositories.add({ url: URL_SQL });
    expect(dto.courseIds).toEqual(['one', 'two']);
    expect(await t.courseIds()).toEqual(['base', 'one', 'two']);
  });
});

describe('failures are distinguishable and change nothing (R4)', () => {
  it.each([
    ['not-found', false],
    ['auth-required', false],
    ['ref-not-found', false],
    ['too-large', false],
    ['timeout', true],
    ['network', true],
  ] as const)('resolve failure %s', async (reason, retryable) => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    t.git.remotes.get(URL_SQL)!.resolveError = new GitFetchError(reason, 'x');
    const error = await failure(t.engine.repositories.add({ url: URL_SQL }));
    expect(error).toMatchObject({
      code: 'GIT_FETCH_FAILED',
      retryable,
      details: { reason },
    });
    expect(await t.store.list()).toEqual([]);
    expect(await t.courseIds()).toEqual(['base']);
  });

  it('download failure cleans the operation dirs', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    t.git.remotes.get(URL_SQL)!.fetchError = new GitFetchError('timeout', 'x');
    const error = await failure(t.engine.repositories.add({ url: URL_SQL }));
    expect(error).toMatchObject({ code: 'GIT_FETCH_FAILED' });
    await expectClean(t);
  });

  it('a snapshot rule violation is REPOSITORY_REJECTED with reason and path', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    t.git.remotes.get(URL_SQL)!.fetchError = new SnapshotRejectedError(
      'symlink',
      'symlink is not allowed',
      'sql/link',
    );
    const error = await failure(t.engine.repositories.add({ url: URL_SQL }));
    expect(error).toMatchObject({
      code: 'REPOSITORY_REJECTED',
      details: { reason: 'symlink', path: 'sql/link' },
    });
    expect(await t.store.list()).toEqual([]);
    await expectClean(t);
  });
});

describe('repositories.update (R5, R10)', () => {
  const added = async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    const dto = await t.engine.repositories.add({ url: URL_SQL });
    t.git.calls.length = 0;
    t.events.length = 0;
    return { t, dto };
  };

  it('asks only for the commit when it is unchanged', async () => {
    const { t, dto } = await added();
    t.clock.advance(1_000);
    const result = await t.engine.repositories.update(dto.id);
    expect(result).toEqual({ changed: false, repository: dto });
    expect(t.git.calls).toEqual([`resolve ${URL_SQL}`]);
    expect(await t.store.list()).toEqual([
      expect.objectContaining({ commit: dto.commit, fetchedAt: dto.fetchedAt }),
    ]);
    expect(phasesOf(t.events)).toEqual(['resolve']);
  });

  it('swaps the snapshot and the graph for a new commit', async () => {
    const { t, dto } = await added();
    remote(t, URL_SQL, course('sql', 2), 2);
    t.clock.advance(5_000);
    const result = await t.engine.repositories.update(dto.id);
    expect(result.changed).toBe(true);
    expect(result.repository).toMatchObject({
      status: 'ready',
      commit: sha(2),
      fetchedAt: t.clock.now(),
    });
    expect(
      (await t.engine.library.listLessons('sql')).items.map(({ id }) => id),
    ).toEqual(['sql::l0', 'sql::l1']);
    expect(t.events.some(({ type }) => type === 'library-reloaded')).toBe(true);
    await expectClean(t);
  });

  it('keeps the old snapshot, the graph and records lastError when the new commit breaks the manifest', async () => {
    const { t, dto } = await added();
    t.git.remotes.set(URL_SQL, {
      commit: sha(2),
      files: { ...filesOf(course('sql', 2)), 'sql/course_manifest.json': '{' },
    });
    const error = await failure(t.engine.repositories.update(dto.id));
    expect(error.code).toBe('REPOSITORY_REJECTED');
    expect(await t.courseIds()).toEqual(['base', 'sql']);
    expect((await t.engine.library.listLessons('sql')).items).toHaveLength(1);
    const [listed] = await t.engine.repositories.list();
    expect(listed).toMatchObject({
      status: 'error',
      commit: dto.commit,
      lastError: { code: 'REPOSITORY_REJECTED' },
    });
    await expectClean(t);
  });

  it('rolls back a snapshot that the library reload rejects', async () => {
    const { t, dto } = await added();
    const manifest = join(
      t.libraryRoot,
      'repositories',
      ID_SQL,
      'sql/course_manifest.json',
    );
    const before = await readFile(manifest, 'utf8');
    // новый коммит приносит курс с id уже загруженного `base`
    remote(
      t,
      URL_SQL,
      buildLibrary({
        courses: [
          { id: 'sql', lessons: [{ id: 'l0', exercises: 2 }] },
          { id: 'base', lessons: [{ id: 'l0', exercises: 1 }] },
        ],
      }),
      2,
    );
    const error = await failure(t.engine.repositories.update(dto.id));
    expect(error.details).toMatchObject({ reason: 'reload-rejected' });
    expect(await readFile(manifest, 'utf8')).toBe(before);
    expect(await t.courseIds()).toEqual(['base', 'sql']);
    expect(await t.engine.library.getInfo()).toMatchObject({ state: 'ready' });
    expect(await t.store.list()).toEqual([
      expect.objectContaining({ commit: dto.commit }),
    ]);
    await expectClean(t);
  });

  it('a later update to an accepted commit clears the error', async () => {
    const { t, dto } = await added();
    t.git.remotes.get(URL_SQL)!.commit = sha(2);
    t.git.remotes.get(URL_SQL)!.files['sql/course_manifest.json'] = '{';
    await failure(t.engine.repositories.update(dto.id));
    remote(t, URL_SQL, course('sql', 2), 3);
    const result = await t.engine.repositories.update(dto.id);
    expect(result.repository.lastError).toBeUndefined();
    expect((await t.engine.repositories.list())[0]?.status).toBe('ready');
  });

  it('re-fetches an unchanged commit when the snapshot directory is gone', async () => {
    const { t, dto } = await added();
    await rm(join(t.libraryRoot, 'repositories', ID_SQL), { recursive: true });
    expect((await t.engine.repositories.list())[0]?.status).toBe('error');
    const result = await t.engine.repositories.update(dto.id);
    expect(result.changed).toBe(true);
    expect(t.git.calls).toContain(`fetch ${URL_SQL}`);
    expect((await t.engine.repositories.list())[0]?.status).toBe('ready');
    expect(await t.courseIds()).toEqual(['base', 'sql']);
  });

  it('two parallel updates run one after another: the second sees the loaded commit', async () => {
    const { t, dto } = await added();
    remote(t, URL_SQL, course('sql', 2), 2);
    const [first, second] = await Promise.all([
      t.engine.repositories.update(dto.id),
      t.engine.repositories.update(dto.id),
    ]);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(t.git.calls.filter((call) => call.startsWith('fetch'))).toHaveLength(
      1,
    );
    expect(second.repository.commit).toBe(sha(2));
    expect((await t.engine.library.listLessons('sql')).items).toHaveLength(2);
  });

  it('reports NOT_FOUND for an unknown id', async () => {
    const t = await open();
    const error = await failure(t.engine.repositories.update('nope'));
    expect(error).toMatchObject({ code: 'NOT_FOUND', details: { id: 'nope' } });
  });
});

describe('repositories.remove (R6)', () => {
  it('drops the snapshot and the record, keeps the journal, and re-adding brings the progress back', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    const dto = await t.engine.repositories.add({ url: URL_SQL });
    await t.engine.practice.recordAttempt({
      requestId: 'r1',
      exerciseId: 'sql::l0::e0',
      grade: 4,
    });
    const progress = await t.engine.practice.getProgress();
    const entries = t.eventStore.entryCount();
    t.events.length = 0;

    await t.engine.repositories.remove(dto.id);
    expect(await t.courseIds()).toEqual(['base']);
    expect(await t.engine.repositories.list()).toEqual([]);
    expect(await t.store.list()).toEqual([]);
    expect(await exists(join(t.libraryRoot, 'repositories', ID_SQL))).toBe(
      false,
    );
    expect(t.events.some(({ type }) => type === 'library-reloaded')).toBe(true);
    expect(t.eventStore.entryCount()).toBe(entries);
    const { items } = await t.engine.library.getDiagnostics();
    expect(items.map(({ code, unitId }) => [code, unitId])).toEqual([
      ['W_ORPHAN_EVENTS', 'sql::l0::e0'],
    ]);

    await t.engine.repositories.add({ url: URL_SQL });
    expect(await t.engine.practice.getProgress()).toEqual(progress);
    expect((await t.engine.library.getDiagnostics()).items).toEqual([]);
  });

  it('reports NOT_FOUND for an unknown id', async () => {
    const t = await open();
    const error = await failure(t.engine.repositories.remove('nope'));
    expect(error.code).toBe('NOT_FOUND');
  });
});

describe('long operations (R8)', () => {
  it('answers plan.getDay and list while the download is blocked; cancel restores the state', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    const gate = t.git.block();
    const adding = failure(t.engine.repositories.add({ url: URL_SQL }));
    await gate.started;

    // без ожидания загрузки: иначе `plan` стоял бы в очереди за `add`
    const day = await t.engine.plan.getDay({ maxItems: 3, seed: 1 });
    expect(day.items.length).toBeGreaterThan(0);

    // сервис виден как обновляемый только после записи в реестр; до неё — прогресс
    expect(phasesOf(t.events)).toEqual(['resolve', 'fetch']);
    expect(await t.engine.repositories.cancel(ID_SQL)).toBe(true);
    const error = await adding;
    expect(error).toMatchObject({
      code: 'GIT_FETCH_FAILED',
      retryable: true,
      details: { reason: 'cancelled' },
    });
    gate.release();
    expect(await t.engine.repositories.cancel(ID_SQL)).toBe(false);
    expect(await t.courseIds()).toEqual(['base']);
    expect(await t.store.list()).toEqual([]);
    await expectClean(t);
  });

  it('shows an updating repository as `updating` and cancel leaves the snapshot as it was', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    const dto = await t.engine.repositories.add({ url: URL_SQL });
    remote(t, URL_SQL, course('sql', 2), 2);
    const gate = t.git.block();
    const updating = failure(t.engine.repositories.update(dto.id));
    await gate.started;
    expect((await t.engine.repositories.list())[0]?.status).toBe('updating');
    expect(await t.engine.repositories.cancel(dto.id)).toBe(true);
    expect((await updating).details).toMatchObject({ reason: 'cancelled' });
    gate.release();
    const [listed] = await t.engine.repositories.list();
    expect(listed).toMatchObject({ status: 'ready', commit: dto.commit });
    expect((await t.engine.library.listLessons('sql')).items).toHaveLength(1);
    await expectClean(t);
  });

  it('remove aborts a running update before removing the repository', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    const dto = await t.engine.repositories.add({ url: URL_SQL });
    remote(t, URL_SQL, course('sql', 2), 2);
    const gate = t.git.block();
    const updating = failure(t.engine.repositories.update(dto.id));
    await gate.started;
    await t.engine.repositories.remove(dto.id);
    expect((await updating).details).toMatchObject({ reason: 'cancelled' });
    expect(await t.courseIds()).toEqual(['base']);
    expect(await t.store.list()).toEqual([]);
  });

  it('closing the engine aborts a running download', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    const gate = t.git.block();
    const adding = failure(t.engine.repositories.add({ url: URL_SQL }));
    await gate.started;
    await t.engine.close();
    expect((await adding).code).toBe('ENGINE_CLOSED');
  });
});

describe('startup recovery (R9)', () => {
  it('removes leftovers and snapshots without a record, keeps registered ones', async () => {
    const root = await tmp.make();
    const libraryRoot = join(root, 'library');
    const dataDir = join(root, 'data');
    await writeFiles(libraryRoot, {
      '.staging/op1/a.txt': 'partial',
      '.trash/op2/kept/v.txt': 'old',
      'repositories/orphan/x.txt': 'x',
      'repositories/kept/v.txt': 'kept',
    });
    await writeFiles(dataDir, { 'git-tmp/op1/pack': 'x' });
    const repositoryStore = createMemoryRepositoryStore();
    await repositoryStore.put({
      id: 'kept',
      url: 'https://example.com/kept',
      ref: null,
      commit: sha(1),
      fetchedAt: 1,
      courseIds: [],
    });
    await repositoryStore.put({
      id: 'lost',
      url: 'https://example.com/lost',
      ref: null,
      commit: sha(1),
      fetchedAt: 1,
      courseIds: [],
    });
    const warnings: unknown[] = [];
    await recoverRepositories({
      repositoryStore,
      snapshotInstaller: createNodeSnapshotInstaller({ libraryRoot, dataDir }),
      logger: {
        debug: () => {},
        info: () => {},
        warn: (fields) => void warnings.push(fields),
        error: () => {},
      },
    });
    expect(await readdir(join(libraryRoot, 'repositories'))).toEqual(['kept']);
    expect(await exists(join(libraryRoot, '.staging'))).toBe(false);
    expect(await exists(join(libraryRoot, '.trash'))).toBe(false);
    expect(await exists(join(dataDir, 'git-tmp'))).toBe(false);
    // записи реестра не трогаем: у `lost` нет каталога, `list` покажет `error`
    expect((await repositoryStore.list()).map(({ id }) => id)).toEqual([
      'kept',
      'lost',
    ]);
    expect(warnings).toEqual([{ id: 'orphan' }]);
  });

  it('createEngine recovers before the first library load and the registry survives a restart', async () => {
    const root = await tmp.make();
    const libraryRoot = join(root, 'library');
    const dataDir = join(root, 'data');
    await mkdir(dataDir, { recursive: true });
    await writeFiles(libraryRoot, filesOf(course('base')));
    const git = createFakeGit();
    git.remotes.set(URL_SQL, { commit: sha(1), files: filesOf(course('sql')) });
    const repositoryStore = createMemoryRepositoryStore();
    const config = { libraryRoot, dataDir };
    const boot = () =>
      createEngine(
        {
          ...nodeDefaults(config),
          clock: createFakeClock(),
          rng: createSeededRng(1),
          ids: createTestIds('e'),
          eventStore: createMemoryEventStore(),
          extensionDataStore: createMemoryExtensionDataStore(),
          exerciseTypes: createFakeExerciseTypes(),
          gradePolicies: createFakeGradePolicies(),
          extensionCommands: createFakeExtensionCommands(),
          extensionTransfers: createFakeExtensionTransfers(),
          extensionRegistry: createFakeExtensionRegistry(),
          extensionPolicy: createFakeExtensionPolicy(),
          extensionHealth: createExtensionHealth(createFakeClock()),
          extensionHostControl: createFakeExtensionHostControl(),
          extensionInstaller: createFakeExtensionInstaller(),
          extensionReloader: createFakeExtensionReloader(),
          repositoryStore,
          snapshotFetcher: git.fetcher,
        },
        config,
      );

    const first = await boot();
    const dto = await first.repositories.add({ url: URL_SQL });
    await first.close();

    // убитый хост: недокачанная операция и снимок без записи, например после `add`
    await writeFiles(libraryRoot, {
      '.staging/op9/sql2/course_manifest.json': '{}',
      'repositories/ghost/course/course_manifest.json': '{}',
    });
    git.calls.length = 0;
    const second = await boot();
    // восстановление в сеть не ходит; проверка обновлений читает только ссылки (`resolve`), снимков не качает
    expect(git.calls.filter((call) => !call.startsWith('resolve'))).toEqual([]);
    // `checkedAt` мог уже появиться: проверка идёт в фоне
    expect(await second.repositories.list()).toMatchObject([dto]);
    expect(
      (await second.library.listCourses()).items.map(({ id }) => id),
    ).toEqual(['base', 'sql']);
    expect(await exists(join(libraryRoot, 'repositories', 'ghost'))).toBe(
      false,
    );
    expect(await exists(join(libraryRoot, '.staging'))).toBe(false);
    await second.close();
  });
});

const URL_JS = 'https://example.com/acme/js';
const ID_JS = 'example.com-acme-js';

const resolveCalls = (t: Opened) =>
  t.git.calls.filter((call) => call.startsWith('resolve')).length;

describe('repositories.checkUpdates (course-updates)', () => {
  it('marks a repository whose server commit differs and reads only refs (R1, R3, R6)', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    const added = await t.engine.repositories.add({ url: URL_SQL });
    expect(added).not.toHaveProperty('availableCommit');
    expect(added).not.toHaveProperty('checkedAt');
    expect(await t.engine.repositories.list()).toEqual([added]);

    remote(t, URL_SQL, course('sql', 2), 2);
    const fetches = t.git.calls.filter((call) => call.startsWith('fetch'));
    const [checked] = await t.engine.repositories.checkUpdates();

    expect(checked).toMatchObject({
      id: ID_SQL,
      commit: sha(1),
      availableCommit: sha(2),
      checkedAt: t.clock.now(),
    });
    expect(await t.engine.repositories.list()).toEqual([checked]);
    expect(t.git.calls.filter((call) => call.startsWith('fetch'))).toEqual(
      fetches,
    );
    expect(await t.courseIds()).toEqual(['base', 'sql']);
    expect(
      t.events.filter(({ type }) => type === 'repository-updates-checked'),
    ).toEqual([{ type: 'repository-updates-checked', available: [ID_SQL] }]);
  });

  it('offers nothing when the server commit equals the loaded one (R1, R6)', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    await t.engine.repositories.add({ url: URL_SQL });

    const [checked] = await t.engine.repositories.checkUpdates();
    expect(checked).not.toHaveProperty('availableCommit');
    expect(checked?.checkedAt).toBe(t.clock.now());
    expect(
      t.events.filter(({ type }) => type === 'repository-updates-checked'),
    ).toEqual([{ type: 'repository-updates-checked', available: [] }]);
  });

  it('skips an unreachable repository, keeps its previous result and checks the rest (R2)', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    remote(t, URL_JS, course('js'));
    await t.engine.repositories.add({ url: URL_SQL });
    await t.engine.repositories.add({ url: URL_JS });
    remote(t, URL_SQL, course('sql', 2), 2);
    remote(t, URL_JS, course('js', 2), 2);
    await t.engine.repositories.checkUpdates();
    t.clock.advance(5000);

    const sql = t.git.remotes.get(URL_SQL);
    const js = t.git.remotes.get(URL_JS);
    if (sql === undefined || js === undefined) throw new Error('remote');
    sql.resolveError = new GitFetchError('network', 'down');
    js.commit = sha(3);
    const before = t.logs.length;
    const items = await t.engine.repositories.checkUpdates();

    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    expect(byId[ID_SQL]).toMatchObject({
      availableCommit: sha(2),
      checkedAt: t.clock.now() - 5000,
    });
    expect(byId[ID_JS]).toMatchObject({
      availableCommit: sha(3),
      checkedAt: t.clock.now(),
    });
    expect(t.logs.slice(before).map(({ level }) => level)).toContain('warn');
    expect(
      t.events
        .filter(({ type }) => type === 'repository-updates-checked')
        .at(-1),
    ).toEqual({
      type: 'repository-updates-checked',
      available: [ID_JS, ID_SQL],
    });
  });

  it('neither fails nor publishes when no repository could be checked (R2, R6)', async () => {
    const t = await open();
    expect(await t.engine.repositories.checkUpdates()).toEqual([]);

    remote(t, URL_SQL, course('sql'));
    await t.engine.repositories.add({ url: URL_SQL });
    const sql = t.git.remotes.get(URL_SQL);
    if (sql === undefined) throw new Error('remote');
    sql.resolveError = new GitFetchError('timeout', 'slow');

    const [item] = await t.engine.repositories.checkUpdates();
    expect(item?.status).toBe('ready');
    expect(item).not.toHaveProperty('checkedAt');
    expect(
      t.events.filter(({ type }) => type === 'repository-updates-checked'),
    ).toEqual([]);
  });

  it('does not check a repository with a running operation (R2)', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    const dto = await t.engine.repositories.add({ url: URL_SQL });
    remote(t, URL_SQL, course('sql', 2), 2);
    const gate = t.git.block();
    const updating = t.engine.repositories.update(dto.id);
    await gate.started;
    const resolved = resolveCalls(t);

    const [item] = await t.engine.repositories.checkUpdates();
    expect(item).toMatchObject({ status: 'updating' });
    expect(item).not.toHaveProperty('checkedAt');
    expect(resolveCalls(t)).toBe(resolved);

    gate.release();
    await updating;
  });

  it('update clears the mark, also when the server was already at the loaded commit (R4)', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    const dto = await t.engine.repositories.add({ url: URL_SQL });
    remote(t, URL_SQL, course('sql', 2), 2);
    await t.engine.repositories.checkUpdates();

    const { changed, repository } = await t.engine.repositories.update(dto.id);
    expect(changed).toBe(true);
    expect(repository.commit).toBe(sha(2));
    expect(repository).not.toHaveProperty('availableCommit');
    const [listed] = await t.engine.repositories.list();
    expect(listed).not.toHaveProperty('availableCommit');
    expect(listed).not.toHaveProperty('checkedAt');

    // сервер откатился: отметка снова только по свежей проверке
    remote(t, URL_SQL, course('sql', 2), 2);
    await t.engine.repositories.checkUpdates();
    const again = await t.engine.repositories.update(dto.id);
    expect(again.changed).toBe(false);
    expect(again.repository).not.toHaveProperty('availableCommit');
  });

  it('a rejected update keeps the mark: the loaded commit is unchanged (R4)', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    const dto = await t.engine.repositories.add({ url: URL_SQL });
    t.git.remotes.set(URL_SQL, {
      commit: sha(2),
      files: { 'bad/course_manifest.json': '{' },
    });
    await t.engine.repositories.checkUpdates();
    expect((await failure(t.engine.repositories.update(dto.id))).code).toBe(
      'REPOSITORY_REJECTED',
    );
    const [item] = await t.engine.repositories.list();
    expect(item).toMatchObject({ availableCommit: sha(2), status: 'error' });
  });

  it('remove forgets the check: a repository added again starts clean (R4)', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    const dto = await t.engine.repositories.add({ url: URL_SQL });
    remote(t, URL_SQL, course('sql', 2), 2);
    await t.engine.repositories.checkUpdates();
    await t.engine.repositories.remove(dto.id);

    remote(t, URL_SQL, course('sql'), 1);
    const added = await t.engine.repositories.add({ url: URL_SQL });
    expect(added).not.toHaveProperty('availableCommit');
    const [item] = await t.engine.repositories.list();
    expect(item).not.toHaveProperty('availableCommit');
    expect(item).not.toHaveProperty('checkedAt');
  });

  it('does not keep a result obtained for a commit that was replaced meanwhile (R3)', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    const dto = await t.engine.repositories.add({ url: URL_SQL });
    remote(t, URL_SQL, course('sql', 2), 2);
    await t.engine.repositories.checkUpdates();
    // загруженный коммит догнал серверный, не пройдя через `update` (например, повторное добавление)
    await t.store.put({
      id: dto.id,
      url: dto.url,
      ref: dto.ref,
      commit: sha(2),
      fetchedAt: dto.fetchedAt,
      courseIds: dto.courseIds,
    });
    const [item] = await t.engine.repositories.list();
    expect(item?.commit).toBe(sha(2));
    expect(item).not.toHaveProperty('availableCommit');
  });
});

describe('startup update check (course-updates R5)', () => {
  const record = {
    id: ID_SQL,
    url: URL_SQL,
    ref: null,
    commit: sha(1),
    fetchedAt: 1,
    courseIds: ['sql'],
  };

  it('runs in the background after opening and publishes the result', async () => {
    const git = createFakeGit();
    git.remotes.set(URL_SQL, { commit: sha(2), files: {} });
    const store = createMemoryRepositoryStore();
    await store.put(record);
    const t = await open({ git, store });

    await vi.waitFor(() =>
      expect(
        t.events.filter(({ type }) => type === 'repository-updates-checked'),
      ).toEqual([{ type: 'repository-updates-checked', available: [ID_SQL] }]),
    );
    const [item] = await t.engine.repositories.list();
    expect(item?.availableCommit).toBe(sha(2));
    expect(git.calls.every((call) => call.startsWith('resolve'))).toBe(true);
  });

  it('does not delay opening while the server is slow and survives its failure', async () => {
    const git = createFakeGit();
    git.remotes.set(URL_SQL, { commit: sha(2), files: {} });
    const pending = deferred<never>();
    const slow: FakeGit = {
      ...git,
      fetcher: { ...git.fetcher, resolve: () => pending.promise },
    };
    const store = createMemoryRepositoryStore();
    await store.put(record);

    const t = await open({ git: slow, store });
    const [item] = await t.engine.repositories.list();
    expect(item).not.toHaveProperty('checkedAt');

    pending.reject(new GitFetchError('network', 'offline'));
    await vi.waitFor(() =>
      expect(t.logs.some(({ level }) => level === 'warn')).toBe(true),
    );
    expect(await t.engine.repositories.list()).toHaveLength(1);
  });
});

/** Три курса: `b` зависит от `a`, `c` самостоятельный; повторяет разметку `renderLibrary` (каталог = id курса). */
const trio = (extra: string[] = []): CourseLibrary =>
  buildLibrary({
    courses: [
      { id: 'a', lessons: [{ id: 'l0', exercises: 1 }] },
      { id: 'b', dependencies: ['a'], lessons: [{ id: 'l0', exercises: 1 }] },
      { id: 'c', lessons: [{ id: 'l0', exercises: 2 }] },
      ...extra.map((id) => ({
        id,
        lessons: [{ id: 'l0', exercises: 1 }],
      })),
    ],
  });

const withRootFiles = (library: CourseLibrary) => ({
  ...filesOf(library),
  'README.md': 'About\n',
  LICENSE: 'MIT\n',
});

const dirOf = (t: Opened, ...path: string[]) =>
  join(t.libraryRoot, 'repositories', ID_SQL, ...path);

/** В `.staging` только снимки предпросмотров (по числу `count`), без `git-tmp`. */
const expectOnlyHeld = async (t: Opened, count: number) => {
  expect(
    await readdir(join(t.libraryRoot, '.staging')).catch(() => []),
  ).toHaveLength(count);
  expect(await readdir(join(t.dataDir, 'git-tmp')).catch(() => [])).toEqual([]);
};

describe('repositories.preview (course-selection R1)', () => {
  const preview = (t: Opened) =>
    t.engine.repositories.preview({ url: `${URL_SQL}.git` });

  it('lists every course of the commit with its requirements and changes nothing', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    const before = await t.courseIds();
    const result = await preview(t);
    expect(result).toMatchObject({ url: URL_SQL, ref: null });
    expect(result.commit).toBe(sha(1));
    expect(result.courses).toEqual([
      {
        id: 'a',
        title: 'Course a',
        path: 'a',
        lessonCount: 1,
        requires: [],
        errors: 0,
        warnings: 0,
        messages: [],
        installed: false,
        inLibrary: false,
      },
      expect.objectContaining({ id: 'b', requires: ['a'] }),
      expect.objectContaining({ id: 'c', requires: [], lessonCount: 1 }),
    ]);
    expect(await t.courseIds()).toEqual(before);
    expect(await t.store.list()).toEqual([]);
    expect(await exists(join(t.libraryRoot, 'repositories'))).toBe(false);
    expect(t.events.some(({ type }) => type === 'library-reloaded')).toBe(
      false,
    );
    expect(phasesOf(t.events)).toEqual([
      'resolve',
      'fetch',
      'export',
      'validate',
    ]);
    await expectOnlyHeld(t, 1);
  });

  it('attributes scanner errors to the course that owns the file and flags courses already in the library', async () => {
    const t = await open();
    t.git.remotes.set(URL_SQL, {
      commit: sha(1),
      files: {
        ...filesOf(trio(['base'])),
        'c/l0/e0/exercise_manifest.json': '{',
      },
    });
    const result = await preview(t);
    const byId = Object.fromEntries(result.courses.map((c) => [c.id, c]));
    expect(byId['c']?.errors).toBeGreaterThan(0);
    expect(byId['c']?.messages.length).toBeGreaterThan(0);
    expect(byId['a']?.errors).toBe(0);
    expect(byId['b']?.errors).toBe(0);
    expect(byId['base']).toMatchObject({ inLibrary: true, installed: false });
    expect(byId['a']?.inLibrary).toBe(false);
  });

  it('marks the courses the registered repository already installed', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    await t.engine.repositories.add({ url: URL_SQL, courseIds: ['a', 'c'] });
    const result = await preview(t);
    expect(
      result.courses.map(({ id, installed, inLibrary }) => [
        id,
        installed,
        inLibrary,
      ]),
    ).toEqual([
      ['a', true, false],
      ['b', false, false],
      ['c', true, false],
    ]);
  });

  it('returns an empty list for a repository without courses', async () => {
    const t = await open();
    t.git.remotes.set(URL_SQL, { commit: sha(1), files: { 'README.md': 'x' } });
    expect((await preview(t)).courses).toEqual([]);
    await expectOnlyHeld(t, 1);
  });

  it('validates its input and reports network failures like add', async () => {
    const t = await open();
    const invalid = await failure(
      t.engine.repositories.preview({ url: 'ftp://example.com/x' }),
    );
    expect(invalid).toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { field: 'url' },
    });
    expect(t.git.calls).toEqual([]);
    const missing = await failure(preview(t));
    expect(missing).toMatchObject({
      code: 'GIT_FETCH_FAILED',
      details: { reason: 'not-found' },
    });
    await expectClean(t);
  });

  it('is cancelled by repositories.cancel and cleans up', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    const gate = t.git.block();
    const running = failure(preview(t));
    await gate.started;
    expect(await t.engine.repositories.cancel(ID_SQL)).toBe(true);
    expect(await running).toMatchObject({
      code: 'GIT_FETCH_FAILED',
      details: { reason: 'cancelled' },
    });
    await expectClean(t);
  });

  it('does not make a registered repository look like it is updating', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    await t.engine.repositories.add({ url: URL_SQL });
    const gate = t.git.block();
    const running = preview(t);
    await gate.started;
    const [listed] = await t.engine.repositories.list();
    expect(listed?.status).toBe('ready');
    gate.release();
    await running;
  });
});

describe('repositories.add with courseIds (course-selection R2, R3)', () => {
  it('installs only the chosen courses and keeps the rest of the commit', async () => {
    const t = await open();
    t.git.remotes.set(URL_SQL, {
      commit: sha(1),
      files: withRootFiles(trio()),
    });
    const dto = await t.engine.repositories.add({
      url: URL_SQL,
      courseIds: ['a', 'c'],
    });
    expect(dto.courseIds).toEqual(['a', 'c']);
    expect(dto.skippedCourseIds).toEqual(['b']);
    expect(await t.courseIds()).toEqual(['a', 'base', 'c']);
    expect(await exists(dirOf(t, 'a'))).toBe(true);
    expect(await exists(dirOf(t, 'c'))).toBe(true);
    expect(await exists(dirOf(t, 'b'))).toBe(false);
    expect(await readFile(dirOf(t, 'LICENSE'), 'utf8')).toBe('MIT\n');
    expect(await t.store.list()).toEqual([
      expect.objectContaining({
        selected: ['a', 'c'],
        skippedCourseIds: ['b'],
      }),
    ]);
    await expectClean(t);
  });

  it('installs everything and records no selection without courseIds', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    const dto = await t.engine.repositories.add({ url: URL_SQL });
    expect(dto.courseIds).toEqual(['a', 'b', 'c']);
    expect(dto.skippedCourseIds).toEqual([]);
    const [record] = await t.store.list();
    expect(record).not.toHaveProperty('selected');
    expect(record).not.toHaveProperty('skippedCourseIds');
  });

  it('rejects an empty or repeating selection before any network call', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    for (const courseIds of [[], ['a', 'a'], ['']]) {
      const error = await failure(
        t.engine.repositories.add({ url: URL_SQL, courseIds }),
      );
      expect(error).toMatchObject({
        code: 'INVALID_ARGUMENT',
        details: { field: 'courseIds' },
      });
    }
    expect(t.git.calls).toEqual([]);
  });

  it('rejects unknown courses and a selection that misses a requirement without changing anything', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    const unknown = await failure(
      t.engine.repositories.add({ url: URL_SQL, courseIds: ['a', 'zzz'] }),
    );
    expect(unknown).toMatchObject({
      code: 'REPOSITORY_REJECTED',
      details: { reason: 'unknown-course', courseIds: ['zzz'] },
    });
    const missing = await failure(
      t.engine.repositories.add({ url: URL_SQL, courseIds: ['b'] }),
    );
    expect(missing).toMatchObject({
      code: 'REPOSITORY_REJECTED',
      details: {
        reason: 'missing-requirement',
        requirements: { b: ['a'] },
      },
    });
    expect(await t.courseIds()).toEqual(['base']);
    expect(await t.store.list()).toEqual([]);
    expect(await exists(join(t.libraryRoot, 'repositories', ID_SQL))).toBe(
      false,
    );
    await expectClean(t);
  });

  it('is not blocked by errors in a course that was not chosen, but rejects them in a chosen one', async () => {
    const t = await open();
    t.git.remotes.set(URL_SQL, {
      commit: sha(1),
      files: { ...filesOf(trio()), 'c/l0/e0/exercise_manifest.json': '{' },
    });
    const dto = await t.engine.repositories.add({
      url: URL_SQL,
      courseIds: ['a', 'b'],
    });
    expect(dto.courseIds).toEqual(['a', 'b']);
    expect(dto.skippedCourseIds).toEqual(['c']);
    await t.engine.repositories.remove(dto.id);

    const error = await failure(
      t.engine.repositories.add({ url: URL_SQL, courseIds: ['a', 'c'] }),
    );
    expect(error).toMatchObject({
      code: 'REPOSITORY_REJECTED',
      details: { reason: 'invalid-library' },
    });
    expect(await t.courseIds()).toEqual(['base']);
  });

  it('treats a nested course as requiring the course around it', async () => {
    const t = await open();
    const outer = filesOf(
      buildLibrary({
        courses: [{ id: 'outer', lessons: [{ id: 'l0', exercises: 1 }] }],
      }),
    );
    const inner = filesOf(
      buildLibrary({
        courses: [{ id: 'inner', lessons: [{ id: 'l0', exercises: 1 }] }],
      }),
    );
    t.git.remotes.set(URL_SQL, {
      commit: sha(1),
      files: {
        ...outer,
        ...Object.fromEntries(
          Object.entries(inner).map(([path, text]) => [`outer/${path}`, text]),
        ),
      },
    });
    const found = await t.engine.repositories.preview({ url: URL_SQL });
    expect(
      found.courses.map(({ id, path, requires }) => [id, path, requires]),
    ).toEqual([
      ['outer', 'outer', []],
      ['inner', 'outer/inner', ['outer']],
    ]);
    const error = await failure(
      t.engine.repositories.add({ url: URL_SQL, courseIds: ['inner'] }),
    );
    expect(error).toMatchObject({
      details: {
        reason: 'missing-requirement',
        requirements: { inner: ['outer'] },
      },
    });
    const dto = await t.engine.repositories.add({
      url: URL_SQL,
      courseIds: ['outer'],
    });
    expect(dto.courseIds).toEqual(['outer']);
    expect(dto.skippedCourseIds).toEqual(['inner']);
    expect(await exists(dirOf(t, 'outer', 'inner'))).toBe(false);
  });
});

describe('selection survives update and can be changed (course-selection R4, R5)', () => {
  const chosen = async (courseIds: string[]) => {
    const t = await open();
    remote(t, URL_SQL, trio());
    const dto = await t.engine.repositories.add({ url: URL_SQL, courseIds });
    t.git.calls.length = 0;
    return { t, dto };
  };

  it('keeps the selection on update: a new course is listed as not installed', async () => {
    const { t, dto } = await chosen(['a', 'c']);
    remote(t, URL_SQL, trio(['d']), 2);
    const result = await t.engine.repositories.update(dto.id);
    expect(result.changed).toBe(true);
    expect(result.repository.courseIds).toEqual(['a', 'c']);
    expect(result.repository.skippedCourseIds).toEqual(['b', 'd']);
    expect(await t.courseIds()).toEqual(['a', 'base', 'c']);
  });

  it('lets a chosen course disappear upstream and come back, and rejects when nothing is left', async () => {
    const { t, dto } = await chosen(['a', 'c']);
    remote(
      t,
      URL_SQL,
      buildLibrary({
        courses: [{ id: 'a', lessons: [{ id: 'l0', exercises: 1 }] }],
      }),
      2,
    );
    const gone = await t.engine.repositories.update(dto.id);
    expect(gone.repository.courseIds).toEqual(['a']);
    expect(await t.courseIds()).toEqual(['a', 'base']);
    expect((await t.store.list())[0]?.selected).toEqual(['a', 'c']);

    remote(t, URL_SQL, trio(), 3);
    const back = await t.engine.repositories.update(dto.id);
    expect(back.repository.courseIds).toEqual(['a', 'c']);

    remote(
      t,
      URL_SQL,
      buildLibrary({
        courses: [{ id: 'z', lessons: [{ id: 'l0', exercises: 1 }] }],
      }),
      4,
    );
    const error = await failure(t.engine.repositories.update(dto.id));
    expect(error).toMatchObject({
      code: 'REPOSITORY_REJECTED',
      details: { reason: 'no-courses' },
    });
    expect(await t.courseIds()).toEqual(['a', 'base', 'c']);
    expect((await t.store.list())[0]?.lastError).toBeDefined();
  });

  it('keeps installing every course for a repository added without a selection', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    const dto = await t.engine.repositories.add({ url: URL_SQL });
    remote(t, URL_SQL, trio(['d']), 2);
    const result = await t.engine.repositories.update(dto.id);
    expect(result.repository.courseIds).toEqual(['a', 'b', 'c', 'd']);
    expect(result.repository.skippedCourseIds).toEqual([]);
  });

  it('applies a new selection to the same commit: widening, narrowing and no-op', async () => {
    const { t, dto } = await chosen(['a']);
    const wider = await t.engine.repositories.update(dto.id, {
      courseIds: ['a', 'c'],
    });
    expect(wider.changed).toBe(true);
    expect(wider.repository.courseIds).toEqual(['a', 'c']);
    expect(wider.repository.skippedCourseIds).toEqual(['b']);
    expect(await t.courseIds()).toEqual(['a', 'base', 'c']);

    const narrower = await t.engine.repositories.update(dto.id, {
      courseIds: ['c'],
    });
    expect(narrower.repository.courseIds).toEqual(['c']);
    expect(await t.courseIds()).toEqual(['base', 'c']);
    expect(await exists(dirOf(t, 'a'))).toBe(false);

    t.git.calls.length = 0;
    const same = await t.engine.repositories.update(dto.id, {
      courseIds: ['c'],
    });
    expect(same.changed).toBe(false);
    expect(t.git.calls).toEqual([`resolve ${URL_SQL}`]);
    await expectClean(t);
  });

  it('turns a repository without a selection into a chosen one', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    const dto = await t.engine.repositories.add({ url: URL_SQL });
    const result = await t.engine.repositories.update(dto.id, {
      courseIds: ['c'],
    });
    expect(result.changed).toBe(true);
    expect(result.repository.courseIds).toEqual(['c']);
    expect(result.repository.skippedCourseIds).toEqual(['a', 'b']);
  });

  it('validates the new selection and keeps the loaded state when it is refused', async () => {
    const { t, dto } = await chosen(['a']);
    const bad = await failure(
      t.engine.repositories.update(dto.id, { courseIds: ['b'] }),
    );
    expect(bad).toMatchObject({
      details: { reason: 'missing-requirement' },
    });
    const empty = await failure(
      t.engine.repositories.update(dto.id, { courseIds: [] }),
    );
    expect(empty).toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await t.courseIds()).toEqual(['a', 'base']);
    const [record] = await t.store.list();
    expect(record?.selected).toEqual(['a']);
    // отказ по запросу не делает репозиторий «с ошибкой»
    expect(record).not.toHaveProperty('lastError');
    expect((await t.engine.repositories.list())[0]?.status).toBe('ready');
    const unknownId = await failure(
      t.engine.repositories.update('nope', { courseIds: ['a'] }),
    );
    expect(unknownId.code).toBe('NOT_FOUND');
    await expectClean(t);
  });

  it('keeps the learner progress when a course is deselected and chosen again', async () => {
    const { t, dto } = await chosen(['a', 'c']);
    await t.engine.practice.recordAttempt({
      requestId: 'r1',
      exerciseId: 'c::l0::e0',
      grade: 4,
    });
    const progress = await t.engine.practice.getProgress();
    const entries = t.eventStore.entryCount();

    await t.engine.repositories.update(dto.id, { courseIds: ['a'] });
    expect(t.eventStore.entryCount()).toBe(entries);

    await t.engine.repositories.update(dto.id, { courseIds: ['a', 'c'] });
    expect(await t.engine.practice.getProgress()).toEqual(progress);
  });
});

describe('preview token: add and update install from the held snapshot (preview-token R1-R4)', () => {
  const sync = async (t: Opened) => {
    // вытеснение и расход убирают каталоги в фоне
    await vi.waitFor(async () => {
      expect(await readdir(join(t.dataDir, 'git-tmp')).catch(() => [])).toEqual(
        [],
      );
    });
  };

  const stagingCount = async (t: Opened) =>
    (await readdir(join(t.libraryRoot, '.staging')).catch(() => [])).length;

  it('preview returns a token and keeps the snapshot (without the git dir) until it is used', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    const result = await t.engine.repositories.preview({ url: URL_SQL });
    expect(result.previewId).toMatch(/^[a-z0-9-]+$/);
    expect(
      await exists(join(t.libraryRoot, '.staging', result.previewId, ID_SQL)),
    ).toBe(true);
    await expectOnlyHeld(t, 1);
    expect(t.events.some(({ type }) => type === 'library-reloaded')).toBe(
      false,
    );
  });

  it('add with the token does not touch the network and gives what a download gives', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    const { previewId } = await t.engine.repositories.preview({ url: URL_SQL });
    t.git.calls.length = 0;
    t.events.length = 0;

    const dto = await t.engine.repositories.add({
      url: URL_SQL,
      courseIds: ['a', 'c'],
      previewId,
    });
    expect(t.git.calls).toEqual([]);
    expect(dto).toMatchObject({
      courseIds: ['a', 'c'],
      skippedCourseIds: ['b'],
      commit: sha(1),
    });
    expect(await t.courseIds()).toEqual(['a', 'base', 'c']);
    expect(await exists(dirOf(t, 'a'))).toBe(true);
    expect(await exists(dirOf(t, 'b'))).toBe(false);
    expect(phasesOf(t.events)).toEqual(['validate', 'reload']);
    await expectClean(t);
  });

  it('add of a single-course repository without courseIds also uses the token', async () => {
    const t = await open();
    remote(t, URL_SQL, course('sql'));
    const { previewId } = await t.engine.repositories.preview({ url: URL_SQL });
    t.git.calls.length = 0;
    const dto = await t.engine.repositories.add({ url: URL_SQL, previewId });
    expect(t.git.calls).toEqual([]);
    expect(dto.courseIds).toEqual(['sql']);
    expect(await t.courseIds()).toEqual(['base', 'sql']);
    await expectClean(t);
  });

  it('update with the token changes the selection of a registered repository without any network call', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    const dto = await t.engine.repositories.add({
      url: URL_SQL,
      courseIds: ['a'],
    });
    const { previewId, courses } = await t.engine.repositories.preview({
      url: URL_SQL,
    });
    expect(courses.find(({ id }) => id === 'a')?.installed).toBe(true);
    t.git.calls.length = 0;
    const result = await t.engine.repositories.update(dto.id, {
      courseIds: ['a', 'c'],
      previewId,
    });
    expect(t.git.calls).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.repository.courseIds).toEqual(['a', 'c']);
    expect(await t.courseIds()).toEqual(['a', 'base', 'c']);
    await expectClean(t);
  });

  it('update with the token and an unchanged commit and selection is a no-op that drops the snapshot', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    const dto = await t.engine.repositories.add({
      url: URL_SQL,
      courseIds: ['a'],
    });
    const { previewId } = await t.engine.repositories.preview({ url: URL_SQL });
    t.git.calls.length = 0;
    const result = await t.engine.repositories.update(dto.id, {
      courseIds: ['a'],
      previewId,
    });
    expect(result.changed).toBe(false);
    expect(t.git.calls).toEqual([]);
    await expectClean(t);
  });

  it('uses the commit the learner saw, even if the server moved on', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    const { previewId } = await t.engine.repositories.preview({ url: URL_SQL });
    remote(t, URL_SQL, trio(['d']), 2);
    const dto = await t.engine.repositories.add({
      url: URL_SQL,
      courseIds: ['a'],
      previewId,
    });
    expect(dto.commit).toBe(sha(1));
    expect(dto.skippedCourseIds).toEqual(['b', 'c']);
  });

  it('a token is spent by the first add that uses it, also when that add is refused', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    const { previewId } = await t.engine.repositories.preview({ url: URL_SQL });
    const refused = await failure(
      t.engine.repositories.add({ url: URL_SQL, courseIds: ['b'], previewId }),
    );
    expect(refused.details).toMatchObject({ reason: 'missing-requirement' });
    await sync(t);
    expect(await stagingCount(t)).toBe(0);

    t.git.calls.length = 0;
    const dto = await t.engine.repositories.add({
      url: URL_SQL,
      courseIds: ['a', 'b'],
      previewId,
    });
    expect(t.git.calls).toEqual([`resolve ${URL_SQL}`, `fetch ${URL_SQL}`]);
    expect(dto.courseIds).toEqual(['a', 'b']);
  });

  it('an unknown token is not an error: the repository is downloaded', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    const dto = await t.engine.repositories.add({
      url: URL_SQL,
      courseIds: ['a'],
      previewId: 'no-such-token',
    });
    expect(dto.courseIds).toEqual(['a']);
    expect(t.git.calls).toContain(`fetch ${URL_SQL}`);
  });

  it('a token of another address is ignored and stays usable for its own', async () => {
    const t = await open();
    const other = 'https://example.com/acme/other';
    remote(t, URL_SQL, trio());
    remote(t, other, course('x'));
    const { previewId } = await t.engine.repositories.preview({ url: URL_SQL });
    t.git.calls.length = 0;
    await t.engine.repositories.add({ url: other, previewId });
    expect(t.git.calls).toEqual([`resolve ${other}`, `fetch ${other}`]);
    expect(await stagingCount(t)).toBe(1);

    t.git.calls.length = 0;
    await t.engine.repositories.add({
      url: URL_SQL,
      courseIds: ['a'],
      previewId,
    });
    expect(t.git.calls).toEqual([]);
  });

  it('a token expires after PREVIEW_TTL_MS: the snapshot is removed and the repository is downloaded', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    const { previewId } = await t.engine.repositories.preview({ url: URL_SQL });
    t.clock.advance(PREVIEW_TTL_MS);
    t.git.calls.length = 0;
    await t.engine.repositories.add({
      url: URL_SQL,
      courseIds: ['a'],
      previewId,
    });
    expect(t.git.calls).toContain(`fetch ${URL_SQL}`);
    await sync(t);
    expect(await stagingCount(t)).toBe(0);
  });

  it('an unused snapshot is removed by the timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const t = await open();
      remote(t, URL_SQL, trio());
      await t.engine.repositories.preview({ url: URL_SQL });
      expect(await stagingCount(t)).toBe(1);
      await vi.advanceTimersByTimeAsync(PREVIEW_TTL_MS);
      await vi.waitFor(async () => expect(await stagingCount(t)).toBe(0));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps at most MAX_HELD_PREVIEWS snapshots, the oldest goes first, and a new preview of the same address replaces the old one', async () => {
    const t = await open();
    const urls = [1, 2, 3].map((n) => `https://example.com/acme/r${n}`);
    for (const url of urls) remote(t, url, course(`c${urls.indexOf(url)}`));
    const tokens: string[] = [];
    for (const url of urls) {
      tokens.push((await t.engine.repositories.preview({ url })).previewId);
    }
    await vi.waitFor(async () =>
      expect(await stagingCount(t)).toBe(MAX_HELD_PREVIEWS),
    );
    t.git.calls.length = 0;
    await t.engine.repositories.add({ url: urls[0]!, previewId: tokens[0]! });
    expect(t.git.calls).toContain(`fetch ${urls[0]}`);
    t.git.calls.length = 0;
    await t.engine.repositories.add({ url: urls[2]!, previewId: tokens[2]! });
    expect(t.git.calls).toEqual([]);

    const again = await t.engine.repositories.preview({ url: urls[1]! });
    expect(again.previewId).not.toBe(tokens[1]);
    await vi.waitFor(async () => expect(await stagingCount(t)).toBe(1));
  });

  it('closing the engine removes the held snapshots', async () => {
    const t = await open();
    remote(t, URL_SQL, trio());
    await t.engine.repositories.preview({ url: URL_SQL });
    expect(await stagingCount(t)).toBe(1);
    await t.engine.close();
    await vi.waitFor(async () => expect(await stagingCount(t)).toBe(0));
  });
});
