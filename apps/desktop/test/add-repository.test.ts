import { effectScope } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type {
  EngineEvent,
  LearningEngine,
  RepositoryDto,
} from '@lms/engine-contract';
import { useAddRepository } from '@/pages/courses/model/add-repository.ts';

const repo = (courseIds: string[]): RepositoryDto => ({
  id: 'acme',
  url: 'https://x.test/acme',
  ref: null,
  commit: 'a'.repeat(40),
  fetchedAt: 0,
  status: 'ready',
  courseIds,
});

const rpcError = (code: string, details?: Record<string, unknown>) =>
  Object.assign(new Error('engine'), { code, retryable: false, details });

const createFake = (
  add: (deferred: {
    resolve: (value: RepositoryDto) => void;
    reject: (reason: unknown) => void;
  }) => void,
) => {
  const listeners = new Set<(event: EngineEvent) => void>();
  const cancel = vi.fn(() => Promise.resolve(true));
  const addCalls: unknown[] = [];
  const engine = {
    subscribe: (listener: (event: EngineEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    repositories: {
      cancel,
      add: (req: unknown) => {
        addCalls.push(req);
        return new Promise<RepositoryDto>((resolve, reject) => {
          add({ resolve, reject });
        });
      },
    },
  } as unknown as LearningEngine;
  const emit = (event: EngineEvent) => {
    for (const listener of listeners) listener(event);
  };
  return { engine, emit, cancel, addCalls };
};

const mount = (engine: LearningEngine) =>
  effectScope().run(() => useAddRepository(engine))!;

describe('useAddRepository', () => {
  it('невалидный ввод отвергается без обращения к движку', async () => {
    const fake = createFake(() => {});
    const model = mount(fake.engine);
    model.url.value = 'ssh://git@host/x';
    model.branch.value = 'a b';
    expect(await model.submit()).toEqual({ status: 'invalid' });
    expect(model.urlIssue.value).toBe('url-scheme');
    expect(model.refIssue.value).toBe('ref-spaces');
    expect(fake.addCalls).toEqual([]);
  });

  it('передаёт url и ref без пробелов; пустой ref не передаёт', async () => {
    const fake = createFake(({ resolve }) => resolve(repo(['c1', 'c2'])));
    const model = mount(fake.engine);
    model.url.value = ' https://x.test/acme ';
    expect(await model.submit()).toMatchObject({ status: 'added' });
    expect(fake.addCalls).toEqual([{ url: 'https://x.test/acme' }]);
    model.branch.value = ' v1 ';
    await model.submit();
    expect(fake.addCalls[1]).toEqual({ url: 'https://x.test/acme', ref: 'v1' });
  });

  it('прогресс берётся из событий первой операции', async () => {
    let finish!: (value: RepositoryDto) => void;
    const fake = createFake(({ resolve }) => {
      finish = resolve;
    });
    const model = mount(fake.engine);
    model.url.value = 'https://x.test/acme';
    const done = model.submit();
    fake.emit({
      type: 'repository-progress',
      id: 'acme',
      phase: 'fetch',
      loaded: 1,
      total: 4,
    });
    fake.emit({ type: 'repository-progress', id: 'other', phase: 'reload' });
    expect(model.progress.value).toMatchObject({ id: 'acme', phase: 'fetch' });
    finish(repo([]));
    await done;
    expect(model.progress.value).toBeNull();
    expect(model.running.value).toBe(false);
  });

  it('отмена до первого события уходит в cancel(id) с первым событием', async () => {
    let reject!: (reason: unknown) => void;
    const fake = createFake((deferred) => {
      reject = deferred.reject;
    });
    const model = mount(fake.engine);
    model.url.value = 'https://x.test/acme';
    const done = model.submit();
    model.cancel();
    expect(fake.cancel).not.toHaveBeenCalled();
    fake.emit({ type: 'repository-progress', id: 'acme', phase: 'resolve' });
    expect(fake.cancel).toHaveBeenCalledExactlyOnceWith('acme');
    reject(rpcError('GIT_FETCH_FAILED', { reason: 'cancelled' }));
    expect(await done).toEqual({ status: 'cancelled' });
    expect(model.error.value).toBeNull();
  });

  it('отмена после первого события вызывает cancel сразу и один раз', async () => {
    let reject!: (reason: unknown) => void;
    const fake = createFake((deferred) => {
      reject = deferred.reject;
    });
    const model = mount(fake.engine);
    model.url.value = 'https://x.test/acme';
    const done = model.submit();
    fake.emit({ type: 'repository-progress', id: 'acme', phase: 'fetch' });
    model.cancel();
    model.cancel();
    expect(fake.cancel).toHaveBeenCalledExactlyOnceWith('acme');
    reject(new Error('aborted'));
    expect(await done).toEqual({ status: 'cancelled' });
  });

  it('ошибка движка превращается в описание для показа', async () => {
    const fake = createFake(({ reject }) =>
      reject(rpcError('GIT_FETCH_FAILED', { reason: 'not-found' })),
    );
    const model = mount(fake.engine);
    model.url.value = 'https://x.test/acme';
    expect(await model.submit()).toEqual({ status: 'failed' });
    expect(model.error.value?.key).toBe('repository.error.fetch.not-found');
    expect(model.running.value).toBe(false);
  });
});
