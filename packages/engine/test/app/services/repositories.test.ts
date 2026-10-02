import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { EngineEvent, RepositoryPhase } from '@dolphy-app/engine-contract';
import {
  buildLibrary,
  createFakeClock,
  createFakeExerciseTypes,
  createFakeExtensionInstaller,
  createFakeExtensionPolicy,
  createFakeExtensionRegistry,
  createFakeExtensionCommands,
  createFakeExtensionReloader,
  createFakeGradePolicies,
  createSeededRng,
  createTestIds,
  renderLibrary,
} from '@dolphy-app/testkit';
import type { CourseLibrary } from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import {
  EngineError,
  createEngine,
  recoverRepositories,
} from '../../../src/app/index.ts';
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

/** Нет ни `.staging`/`.trash`, ни `git-tmp`: операция убрала за собой. */
const expectClean = async (t: Opened) => {
  for (const dir of [
    join(t.libraryRoot, '.staging'),
    join(t.libraryRoot, '.trash'),
    join(t.dataDir, 'git-tmp'),
  ]) {
    expect(await readdir(dir).catch(() => [])).toEqual([]);
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
          extensionRegistry: createFakeExtensionRegistry(),
          extensionPolicy: createFakeExtensionPolicy(),
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
    expect(git.calls).toEqual([]); // сети при запуске нет
    expect(await second.repositories.list()).toEqual([dto]);
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
