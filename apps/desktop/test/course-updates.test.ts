import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  EngineEvent,
  LearningEngine,
  RepositoryDto,
} from '@dolphy-app/engine-contract';
import {
  checkOutcome,
  announcementStep,
  updateByCourse,
  updateKey,
  updatesOf,
} from '@/features/course-updates/lib/updates.ts';
import { createCourseUpdates } from '@/features/course-updates/model/course-updates.ts';
import { ROUTE } from '@/shared/config/routes.ts';

const sha = (n: number) => n.toString(16).padStart(40, '0');

const repo = (
  id: string,
  extra: Partial<RepositoryDto> = {},
): RepositoryDto => ({
  id,
  url: `https://x.test/${id}`,
  ref: null,
  commit: sha(1),
  fetchedAt: 0,
  status: 'ready',
  courseIds: [`${id}-a`, `${id}-b`],
  ...extra,
});

const MICROTASK_ROUNDS = 10;
const flush = async () => {
  for (let round = 0; round < MICROTASK_ROUNDS; round++)
    await Promise.resolve();
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createFake = (initial: RepositoryDto[]) => {
  const listeners = new Set<(event: EngineEvent) => void>();
  const state = {
    stored: initial,
    list: (): Promise<RepositoryDto[]> => Promise.resolve(state.stored),
    checkUpdates: (): Promise<RepositoryDto[]> => Promise.resolve(state.stored),
    update: (): Promise<unknown> => Promise.resolve({}),
  };
  const engine = {
    subscribe: (listener: (event: EngineEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    repositories: {
      list: () => state.list(),
      checkUpdates: () => state.checkUpdates(),
      update: () => state.update(),
    },
  } as unknown as LearningEngine;
  const emit = (event: EngineEvent) => {
    for (const listener of listeners) listener(event);
  };
  return { engine, state, emit, listeners };
};

const NAMES = new Map([
  ['a-a', 'Alpha A'],
  ['a-b', 'Alpha B'],
]);

const mount = (engine: LearningEngine) =>
  effectScope().run(() =>
    createCourseUpdates(engine, { courseNames: () => NAMES }),
  )!;

describe('course updates helpers', () => {
  it('updatesOf keeps only repositories with availableCommit, in list order', () => {
    const list = [
      repo('a', { availableCommit: sha(2) }),
      repo('b'),
      repo('c', { availableCommit: sha(3) }),
    ];
    expect(updatesOf(list).map(({ repository }) => repository.id)).toEqual([
      'a',
      'c',
    ]);
  });

  it('updateByCourse maps every course of an updated repository', () => {
    const map = updateByCourse(
      updatesOf([repo('a', { availableCommit: sha(2) }), repo('b')]),
    );
    expect([...map.keys()]).toEqual(['a-a', 'a-b']);
    expect(map.get('a-a')?.availableCommit).toBe(sha(2));
  });

  it('a newer server commit is a different update', () => {
    const [first] = updatesOf([repo('a', { availableCommit: sha(2) })]);
    const [again] = updatesOf([repo('a', { availableCommit: sha(2) })]);
    const [newer] = updatesOf([repo('a', { availableCommit: sha(3) })]);
    expect(updateKey(first!)).toBe(updateKey(again!));
    expect(updateKey(first!)).not.toBe(updateKey(newer!));
  });

  it('checkOutcome tells found, up to date and unreachable apart', () => {
    const before = [repo('a', { checkedAt: 10 }), repo('b')];
    expect(
      checkOutcome(before, [
        repo('a', { checkedAt: 20, availableCommit: sha(2) }),
        repo('b'),
      ]),
    ).toEqual({ kind: 'found', count: 1 });
    expect(
      checkOutcome(before, [
        repo('a', { checkedAt: 20 }),
        repo('b', { checkedAt: 20 }),
      ]),
    ).toEqual({ kind: 'upToDate' });
    // `a` не ответил: `checkedAt` остался прежним
    expect(
      checkOutcome(before, [
        repo('a', { checkedAt: 10 }),
        repo('b', { checkedAt: 20 }),
      ]),
    ).toEqual({ kind: 'unreachable' });
    expect(checkOutcome(before, [repo('a'), repo('b')])).toEqual({
      kind: 'unreachable',
    });
  });

  it('an update known from an earlier check is not a finding when the server did not answer', () => {
    const stale = repo('a', { checkedAt: 10, availableCommit: sha(2) });
    expect(checkOutcome([stale], [stale])).toEqual({ kind: 'unreachable' });
    // отвечает один из двух: находка засчитывается только ответившему
    const other = repo('b', { checkedAt: 10 });
    expect(
      checkOutcome(
        [stale, other],
        [stale, repo('b', { checkedAt: 20, availableCommit: sha(3) })],
      ),
    ).toEqual({ kind: 'found', count: 1 });
  });

  describe('announcementStep', () => {
    const [a, b] = updatesOf([
      repo('a', { availableCommit: sha(2) }),
      repo('b', { availableCommit: sha(3) }),
    ]);

    it('shows pending updates on an ordinary screen', () => {
      expect(announcementStep(ROUTE.dailyPlan, [], [a!])).toEqual({
        shown: [a],
        announce: [],
      });
      expect(announcementStep(ROUTE.settingsLibrary, [], [a!])).toEqual({
        shown: [a],
        announce: [],
      });
      expect(announcementStep(undefined, [], [])).toEqual({
        shown: [],
        announce: [],
      });
    });

    it('keeps the shown batch while it is on screen: new findings wait', () => {
      expect(announcementStep(ROUTE.dailyPlan, [a!], [a!, b!])).toEqual({
        shown: [a],
        announce: [],
      });
    });

    it('counts everything as announced on the courses screen: the banner is there', () => {
      expect(announcementStep(ROUTE.courses, [a!], [b!])).toEqual({
        shown: [],
        announce: [a, b],
      });
    });

    it.each([ROUTE.session, ROUTE.placement])(
      'hides the notice during %s without marking it announced',
      (name) => {
        expect(announcementStep(name, [a!], [a!, b!])).toEqual({
          shown: [],
          announce: [],
        });
        expect(announcementStep(name, [], [a!])).toEqual({
          shown: [],
          announce: [],
        });
      },
    );
  });
});

describe('createCourseUpdates', () => {
  it('reads the list on creation and resolves courses to their update', async () => {
    const fake = createFake([
      repo('a', { availableCommit: sha(2), checkedAt: 5 }),
      repo('b'),
    ]);
    const store = mount(fake.engine);
    await flush();
    expect(store.repositories.value).toHaveLength(2);
    expect(store.updates.value.map(({ repository }) => repository.id)).toEqual([
      'a',
    ]);
    expect(store.updateOf('a-b')?.repository.id).toBe('a');
    expect(store.updateOf('b-a')).toBeUndefined();
    expect(store.updateOf('base')).toBeUndefined();
  });

  it('names courses from the library and falls back to the id', () => {
    const store = mount(createFake([]).engine);
    expect(store.courseName('a-a')).toBe('Alpha A');
    expect(store.courseName('ghost')).toBe('ghost');
  });

  it.each(['repository-updates-checked', 'library-reloaded'] as const)(
    're-reads the list after %s',
    async (type) => {
      const fake = createFake([repo('a')]);
      const store = mount(fake.engine);
      await flush();
      expect(store.updates.value).toEqual([]);

      fake.state.stored = [repo('a', { availableCommit: sha(2) })];
      fake.emit(
        type === 'library-reloaded'
          ? { type, revision: 'r', errors: 0, warnings: 0 }
          : { type, available: ['a'] },
      );
      await flush();
      expect(store.updates.value).toHaveLength(1);
    },
  );

  it('ignores an outdated list response', async () => {
    const fake = createFake([]);
    const first = deferred<RepositoryDto[]>();
    const second = deferred<RepositoryDto[]>();
    const pending = [first, second];
    fake.state.list = () => pending.shift()!.promise;
    const store = mount(fake.engine);
    fake.emit({ type: 'repository-updates-checked', available: [] });
    await flush();
    second.resolve([repo('new')]);
    await flush();
    first.resolve([repo('stale')]);
    await flush();
    expect(store.repositories.value.map(({ id }) => id)).toEqual(['new']);
  });

  it('keeps the previous list when reading fails', async () => {
    const fake = createFake([repo('a')]);
    const store = mount(fake.engine);
    await flush();
    fake.state.list = () => Promise.reject(new Error('down'));
    await store.reconnected();
    expect(store.repositories.value.map(({ id }) => id)).toEqual(['a']);
  });

  it('dispose unsubscribes from engine events', () => {
    const fake = createFake([]);
    const store = mount(fake.engine);
    expect(fake.listeners.size).toBe(1);
    store.dispose();
    expect(fake.listeners.size).toBe(0);
  });
});

describe('createCourseUpdates.check', () => {
  it('returns the outcome, publishes the fresh list and tracks the running check', async () => {
    const fake = createFake([repo('a', { checkedAt: 1 })]);
    const store = mount(fake.engine);
    await flush();
    const gate = deferred<RepositoryDto[]>();
    fake.state.checkUpdates = () => gate.promise;

    const running = store.check();
    expect(store.checking.value).toBe(true);
    expect(await store.check()).toBeNull(); // вторая проверка не запускается

    gate.resolve([repo('a', { checkedAt: 2, availableCommit: sha(2) })]);
    expect(await running).toEqual({ kind: 'found', count: 1 });
    expect(store.checking.value).toBe(false);
    expect(store.updates.value).toHaveLength(1);
  });

  it('keeps the outcome for the screen until it is cleared; a failed call is shown as unreachable', async () => {
    const fake = createFake([repo('a', { checkedAt: 1 })]);
    const store = mount(fake.engine);
    await flush();
    expect(store.outcome.value).toBeNull();

    fake.state.checkUpdates = () =>
      Promise.resolve([repo('a', { checkedAt: 2 })]);
    await store.check();
    expect(store.outcome.value).toEqual({ kind: 'upToDate' });
    store.clearOutcome();
    expect(store.outcome.value).toBeNull();

    fake.state.checkUpdates = () => Promise.reject(new Error('closed'));
    await store.check();
    expect(store.outcome.value).toEqual({ kind: 'unreachable' });
  });

  it('reports unreachable when the call itself fails and allows another check', async () => {
    const fake = createFake([repo('a')]);
    const store = mount(fake.engine);
    await flush();
    fake.state.checkUpdates = () => Promise.reject(new Error('port closed'));
    expect(await store.check()).toEqual({ kind: 'unreachable' });
    expect(store.checking.value).toBe(false);
  });

  it('a check answer wins over a list read started before it', async () => {
    const fake = createFake([repo('a')]);
    const store = mount(fake.engine);
    await flush();
    const read = deferred<RepositoryDto[]>();
    fake.state.list = () => read.promise;
    fake.emit({
      type: 'library-reloaded',
      revision: 'r',
      errors: 0,
      warnings: 0,
    });
    await flush();
    fake.state.checkUpdates = () =>
      Promise.resolve([repo('a', { checkedAt: 2, availableCommit: sha(2) })]);
    await store.check();
    read.resolve([repo('a')]);
    await flush();
    expect(store.updates.value).toHaveLength(1);
  });
});

describe('createCourseUpdates.update', () => {
  it('blocks other updates while one runs, shows progress and clears it after', async () => {
    const fake = createFake([
      repo('a', { availableCommit: sha(2) }),
      repo('b', { availableCommit: sha(3) }),
    ]);
    const store = mount(fake.engine);
    await flush();
    const gate = deferred<unknown>();
    fake.state.update = () => gate.promise;

    const running = store.update('a');
    expect(store.pendingId.value).toBe('a');
    await store.update('b'); // игнорируется
    fake.emit({
      type: 'repository-progress',
      id: 'a',
      phase: 'fetch',
      loaded: 1,
      total: 2,
    });
    expect(store.progress.value['a']?.phase).toBe('fetch');

    fake.state.stored = [
      repo('a', { commit: sha(2) }),
      repo('b', { availableCommit: sha(3) }),
    ];
    gate.resolve({});
    await running;
    expect(store.pendingId.value).toBeNull();
    expect(store.progress.value).toEqual({});
    expect(store.failure.value).toBeNull();
    // пометка ушла после перечитывания списка
    expect(store.updates.value.map(({ repository }) => repository.id)).toEqual([
      'b',
    ]);
  });

  it('keeps a rejection for the banner and clears it on the next update', async () => {
    const fake = createFake([repo('a', { availableCommit: sha(2) })]);
    const store = mount(fake.engine);
    await flush();
    fake.state.update = () =>
      Promise.reject({
        code: 'GIT_FETCH_FAILED',
        message: 'x',
        details: { reason: 'network' },
      });
    await store.update('a');
    expect(store.failure.value).toMatchObject({
      id: 'a',
      view: { key: 'repository.error.fetch.network' },
    });
    expect(store.updates.value).toHaveLength(1); // обновление всё ещё доступно

    fake.state.update = () => Promise.resolve({});
    await store.update('a');
    expect(store.failure.value).toBeNull();
  });

  it('does not report a cancelled update as a failure', async () => {
    const fake = createFake([repo('a', { availableCommit: sha(2) })]);
    const store = mount(fake.engine);
    await flush();
    fake.state.update = () =>
      Promise.reject({
        code: 'GIT_FETCH_FAILED',
        message: 'cancelled',
        details: { reason: 'cancelled' },
      });
    await store.update('a');
    expect(store.failure.value).toBeNull();
  });
});

describe('createCourseUpdates announcements', () => {
  it('offers an update until it is announced, and again for a newer server commit', async () => {
    const fake = createFake([repo('a', { availableCommit: sha(2) })]);
    const store = mount(fake.engine);
    await flush();
    expect(store.unannounced.value).toHaveLength(1);

    store.markAnnounced(store.unannounced.value);
    expect(store.unannounced.value).toEqual([]);

    // повторная проверка с тем же коммитом сервера ничего не возвращает
    fake.emit({ type: 'repository-updates-checked', available: ['a'] });
    await flush();
    expect(store.unannounced.value).toEqual([]);

    fake.state.stored = [repo('a', { availableCommit: sha(3) })];
    fake.emit({ type: 'repository-updates-checked', available: ['a'] });
    await flush();
    expect(store.unannounced.value).toHaveLength(1);
  });

  it('a window opened after the check still gets the announcement', async () => {
    const store = mount(
      createFake([repo('a', { availableCommit: sha(2), checkedAt: 1 })]).engine,
    );
    await flush();
    expect(
      store.unannounced.value.map(({ repository }) => repository.id),
    ).toEqual(['a']);
  });
});
