import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  EngineEvent,
  LearningEngine,
  RemoveRepositoryOptions,
  RepositoryDto,
  UpdateRepositoryOptions,
  UpdateRepositoryResult,
} from '@dolphy-app/engine-contract';
import { useRepositories } from '@/pages/settings/model/repositories.ts';

const repo = (id: string, courses = 1): RepositoryDto => ({
  id,
  url: `https://x.test/${id}`,
  ref: null,
  commit: 'a'.repeat(40),
  fetchedAt: 0,
  status: 'ready',
  courseIds: Array.from({ length: courses }, (_, i) => `${id}-${i}`),
  skippedCourseIds: [],
});

const MICROTASK_ROUNDS = 10;
const flush = async () => {
  for (let round = 0; round < MICROTASK_ROUNDS; round++)
    await Promise.resolve();
};

type UpdateArgs = [id: string, options?: UpdateRepositoryOptions];

const createFake = (initial: RepositoryDto[]) => {
  let stored = initial;
  const removed: Array<RemoveRepositoryOptions | undefined> = [];
  const listeners = new Set<(event: EngineEvent) => void>();
  const state = {
    update: (...args: UpdateArgs): Promise<UpdateRepositoryResult> =>
      Promise.resolve({ changed: false, repository: repo(args[0]) }),
    remove: (): Promise<void> => Promise.resolve(),
  };
  const engine = {
    subscribe: (listener: (event: EngineEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    repositories: {
      list: () => Promise.resolve(stored),
      update: (...args: UpdateArgs) => state.update(...args),
      remove: async (id: string, options?: RemoveRepositoryOptions) => {
        removed.push(options);
        await state.remove();
        stored = stored.filter((item) => item.id !== id);
      },
      cancel: () => Promise.resolve(true),
    },
  } as unknown as LearningEngine;
  const emit = (event: EngineEvent) => {
    for (const listener of listeners) listener(event);
  };
  return { engine, state, emit, removed };
};

const mount = (engine: LearningEngine) =>
  effectScope().run(() => useRepositories(engine))!;

describe('useRepositories', () => {
  it('загружает список', async () => {
    const model = mount(createFake([repo('a'), repo('b')]).engine);
    await flush();
    expect(model.loaded.value).toBe(true);
    expect(model.items.value.map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('update без изменений — «актуально», с изменениями — число курсов', async () => {
    const fake = createFake([repo('a')]);
    const model = mount(fake.engine);
    await flush();
    await model.update('a');
    expect(model.notice.value).toEqual({ kind: 'upToDate' });
    fake.state.update = (id) =>
      Promise.resolve({ changed: true, repository: repo(id, 3) });
    await model.update('a');
    expect(model.notice.value).toEqual({ kind: 'updated', courses: 3 });
  });

  it('update с выбором курсов передаёт courseIds, без выбора — только id', async () => {
    const fake = createFake([repo('a')]);
    const calls: unknown[][] = [];
    fake.state.update = (...args) => {
      calls.push(args);
      return Promise.resolve({ changed: true, repository: repo('a', 2) });
    };
    const model = mount(fake.engine);
    await flush();
    await model.update('a', ['a-0', 'a-1']);
    await model.update('a', ['a-0'], 'p1');
    await model.update('a');
    expect(calls).toEqual([
      ['a', { courseIds: ['a-0', 'a-1'] }],
      ['a', { courseIds: ['a-0'], previewId: 'p1' }],
      ['a'],
    ]);
    expect(model.notice.value).toEqual({ kind: 'updated', courses: 2 });
  });

  it('пока идёт действие, другие блокируются; прогресс чистится после', async () => {
    const fake = createFake([repo('a'), repo('b')]);
    let finish!: () => void;
    fake.state.update = (id) =>
      new Promise((resolve) => {
        finish = () => resolve({ changed: false, repository: repo(id) });
      });
    const model = mount(fake.engine);
    await flush();
    const running = model.update('a');
    expect(model.busy.value).toBe(true);
    expect(model.pendingId.value).toBe('a');
    await model.remove('b'); // игнорируется, пока идёт другое действие
    expect(model.items.value).toHaveLength(2);
    fake.emit({
      type: 'repository-progress',
      id: 'a',
      phase: 'fetch',
      loaded: 1,
      total: 2,
    });
    expect(model.progress.value['a']?.phase).toBe('fetch');
    finish();
    await running;
    expect(model.busy.value).toBe(false);
    expect(model.progress.value).toEqual({});
  });

  it('remove обновляет список и сообщает об удалении; прогресс по умолчанию остаётся', async () => {
    const fake = createFake([repo('a'), repo('b')]);
    const model = mount(fake.engine);
    await flush();
    await model.remove('a');
    expect(model.items.value.map(({ id }) => id)).toEqual(['b']);
    expect(model.notice.value).toEqual({ kind: 'removed' });
    expect(fake.removed).toEqual([{ removeProgress: false }]);
  });

  it('remove с removeProgress передаёт опцию движку и сообщает об удалении с прогрессом', async () => {
    const fake = createFake([repo('a')]);
    const model = mount(fake.engine);
    await flush();
    await model.remove('a', true);
    expect(fake.removed).toEqual([{ removeProgress: true }]);
    expect(model.notice.value).toEqual({ kind: 'removedWithProgress' });
  });

  it('отказ update показывается ошибкой и список перечитывается', async () => {
    const fake = createFake([repo('a')]);
    fake.state.update = () =>
      Promise.reject(
        Object.assign(new Error('x'), {
          code: 'REPOSITORY_REJECTED',
          retryable: false,
          details: { reason: 'reload-rejected', summary: 's' },
        }),
      );
    const model = mount(fake.engine);
    await flush();
    await model.update('a');
    expect(model.error.value?.key).toBe(
      'repository.error.rejected.reload-rejected',
    );
    expect(model.notice.value).toBeNull();
  });

  it('отмена пользователем не показывается ошибкой', async () => {
    const fake = createFake([repo('a')]);
    fake.state.update = () =>
      Promise.reject(
        Object.assign(new Error('x'), {
          code: 'GIT_FETCH_FAILED',
          retryable: true,
          details: { reason: 'cancelled' },
        }),
      );
    const model = mount(fake.engine);
    await flush();
    await model.update('a');
    expect(model.error.value).toBeNull();
  });

  it('library-reloaded перечитывает список', async () => {
    const fake = createFake([repo('a')]);
    const model = mount(fake.engine);
    await flush();
    await model.remove('a');
    fake.emit({ type: 'library-reloaded' } as EngineEvent);
    await flush();
    expect(model.items.value).toEqual([]);
  });
});
