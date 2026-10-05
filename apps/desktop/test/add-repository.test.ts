import { effectScope } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type {
  EngineEvent,
  LearningEngine,
  RepositoryCourseDto,
  RepositoryDto,
  RepositoryPreviewDto,
} from '@dolphy-app/engine-contract';
import { useAddRepository } from '@/pages/courses/model/add-repository.ts';

const repo = (courseIds: string[]): RepositoryDto => ({
  id: 'acme',
  url: 'https://x.test/acme',
  ref: null,
  commit: 'a'.repeat(40),
  fetchedAt: 0,
  status: 'ready',
  courseIds,
  skippedCourseIds: [],
});

const course = (
  id: string,
  patch: Partial<RepositoryCourseDto> = {},
): RepositoryCourseDto => ({
  id,
  title: `Course ${id}`,
  path: id,
  lessonCount: 1,
  requires: [],
  errors: 0,
  warnings: 0,
  messages: [],
  installed: false,
  inLibrary: false,
  ...patch,
});

const listing = (courses: RepositoryCourseDto[]): RepositoryPreviewDto => ({
  url: 'https://x.test/acme',
  ref: null,
  commit: 'a'.repeat(40),
  courses,
});

const rpcError = (code: string, details?: Record<string, unknown>) =>
  Object.assign(new Error('engine'), { code, retryable: false, details });

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

const createFake = (
  options: {
    preview?: (deferred: Deferred<RepositoryPreviewDto>) => void;
    add?: (deferred: Deferred<RepositoryDto>) => void;
  } = {},
) => {
  const listeners = new Set<(event: EngineEvent) => void>();
  const cancel = vi.fn(() => Promise.resolve(true));
  const addCalls: unknown[] = [];
  const previewCalls: unknown[] = [];
  const engine = {
    subscribe: (listener: (event: EngineEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    repositories: {
      cancel,
      preview: (req: unknown) => {
        previewCalls.push(req);
        return new Promise<RepositoryPreviewDto>((resolve, reject) => {
          options.preview?.({ resolve, reject });
        });
      },
      add: (req: unknown) => {
        addCalls.push(req);
        return new Promise<RepositoryDto>((resolve, reject) => {
          options.add?.({ resolve, reject });
        });
      },
    },
  } as unknown as LearningEngine;
  const emit = (event: EngineEvent) => {
    for (const listener of listeners) listener(event);
  };
  return { engine, emit, cancel, addCalls, previewCalls };
};

const mount = (engine: LearningEngine) =>
  effectScope().run(() => useAddRepository(engine))!;

const previewing = (courses: RepositoryCourseDto[]) => ({
  preview: ({ resolve }: Deferred<RepositoryPreviewDto>) =>
    resolve(listing(courses)),
});

describe('useAddRepository', () => {
  it('невалидный ввод отвергается без обращения к движку', async () => {
    const fake = createFake();
    const model = mount(fake.engine);
    model.url.value = 'ssh://git@host/x';
    model.branch.value = 'a b';
    expect(await model.submit()).toEqual({ status: 'invalid' });
    expect(model.urlIssue.value).toBe('url-scheme');
    expect(model.refIssue.value).toBe('ref-spaces');
    expect(fake.previewCalls).toEqual([]);
    expect(fake.addCalls).toEqual([]);
  });

  it('репозиторий с одним курсом добавляется сразу, без выбора', async () => {
    const fake = createFake({
      ...previewing([course('c1')]),
      add: ({ resolve }) => resolve(repo(['c1'])),
    });
    const model = mount(fake.engine);
    model.url.value = ' https://x.test/acme ';
    expect(await model.submit()).toMatchObject({ status: 'added' });
    expect(fake.previewCalls).toEqual([{ url: 'https://x.test/acme' }]);
    expect(fake.addCalls).toEqual([{ url: 'https://x.test/acme' }]);
    expect(model.step.value).toBe('source');
    model.branch.value = ' v1 ';
    await model.submit();
    expect(fake.previewCalls[1]).toEqual({
      url: 'https://x.test/acme',
      ref: 'v1',
    });
    expect(fake.addCalls[1]).toEqual({ url: 'https://x.test/acme', ref: 'v1' });
  });

  it('несколько курсов: шаг выбора со всеми доступными курсами отмеченными', async () => {
    const fake = createFake(
      previewing([
        course('a'),
        course('b', { errors: 2, messages: ['broken'] }),
        course('c', { inLibrary: true }),
        course('d', { requires: ['b'] }),
        course('e'),
      ]),
    );
    const model = mount(fake.engine);
    model.url.value = 'https://x.test/acme';
    expect(await model.submit()).toEqual({ status: 'choose' });
    expect(model.step.value).toBe('courses');
    expect([...model.selected.value]).toEqual(['a', 'e']);
    expect(fake.addCalls).toEqual([]);
  });

  it('отметка курса отмечает нужные ему курсы; нужный отмеченному не снимается', async () => {
    const fake = createFake(
      previewing([course('a'), course('b', { requires: ['a'] }), course('c')]),
    );
    const model = mount(fake.engine);
    model.url.value = 'https://x.test/acme';
    await model.submit();
    model.clear();
    expect(model.canConfirm.value).toBe(false);
    model.toggle('b');
    expect([...model.selected.value].sort()).toEqual(['a', 'b']);
    model.toggle('a');
    expect([...model.selected.value].sort()).toEqual(['a', 'b']);
    model.toggle('b');
    model.toggle('a');
    expect([...model.selected.value]).toEqual([]);
    model.selectAll();
    expect([...model.selected.value].sort()).toEqual(['a', 'b', 'c']);
  });

  it('«Добавить» передаёт отмеченные курсы; «Назад» возвращает к адресу', async () => {
    const fake = createFake({
      ...previewing([course('a'), course('b'), course('c')]),
      add: ({ resolve }) => resolve(repo(['a', 'c'])),
    });
    const model = mount(fake.engine);
    model.url.value = 'https://x.test/acme';
    model.branch.value = 'v2';
    await model.submit();
    model.toggle('b');
    model.back();
    expect(model.step.value).toBe('source');
    expect(model.preview.value).toBeNull();
    expect(await model.confirm()).toEqual({ status: 'invalid' });

    await model.submit();
    model.toggle('b');
    const outcome = await model.confirm();
    expect(outcome).toMatchObject({ status: 'added' });
    expect(fake.addCalls).toEqual([
      { url: 'https://x.test/acme', ref: 'v2', courseIds: ['a', 'c'] },
    ]);
  });

  it('отказ добавления на шаге выбора остаётся на шаге выбора', async () => {
    const fake = createFake({
      ...previewing([course('a'), course('b')]),
      add: ({ reject }) =>
        reject(
          rpcError('REPOSITORY_REJECTED', {
            reason: 'missing-requirement',
            requirements: { b: ['a'] },
          }),
        ),
    });
    const model = mount(fake.engine);
    model.url.value = 'https://x.test/acme';
    await model.submit();
    expect(await model.confirm()).toEqual({ status: 'failed' });
    expect(model.step.value).toBe('courses');
    expect(model.error.value).toMatchObject({
      key: 'repository.error.rejected.missing-requirement',
      messages: ['b → a'],
    });
  });

  it('репозиторий без курсов и уже добавленный не доходят до выбора', async () => {
    const empty = createFake(previewing([]));
    const model = mount(empty.engine);
    model.url.value = 'https://x.test/acme';
    expect(await model.submit()).toEqual({ status: 'failed' });
    expect(model.error.value?.key).toBe('repository.error.rejected.no-courses');
    expect(model.step.value).toBe('source');

    const known = createFake(
      previewing([course('a', { installed: true }), course('b')]),
    );
    const again = mount(known.engine);
    again.url.value = 'https://x.test/acme';
    expect(await again.submit()).toEqual({ status: 'failed' });
    expect(again.error.value?.key).toBe('repository.error.exists');
    expect(known.addCalls).toEqual([]);
  });

  it('прогресс берётся из событий первой операции', async () => {
    let finish!: (value: RepositoryPreviewDto) => void;
    const fake = createFake({
      preview: ({ resolve }) => {
        finish = resolve;
      },
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
    finish(listing([course('a'), course('b')]));
    await done;
    expect(model.progress.value).toBeNull();
    expect(model.running.value).toBe(false);
  });

  it('отмена до первого события уходит в cancel(id) с первым событием', async () => {
    let reject!: (reason: unknown) => void;
    const fake = createFake({
      preview: (deferred) => {
        reject = deferred.reject;
      },
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

  it('отмена добавления на шаге выбора вызывает cancel сразу и один раз', async () => {
    let reject!: (reason: unknown) => void;
    const fake = createFake({
      ...previewing([course('a'), course('b')]),
      add: (deferred) => {
        reject = deferred.reject;
      },
    });
    const model = mount(fake.engine);
    model.url.value = 'https://x.test/acme';
    await model.submit();
    const done = model.confirm();
    fake.emit({ type: 'repository-progress', id: 'acme', phase: 'fetch' });
    model.cancel();
    model.cancel();
    expect(fake.cancel).toHaveBeenCalledExactlyOnceWith('acme');
    reject(new Error('aborted'));
    expect(await done).toEqual({ status: 'cancelled' });
    expect(model.step.value).toBe('courses');
  });

  it('ошибка движка превращается в описание для показа', async () => {
    const fake = createFake({
      preview: ({ reject }) =>
        reject(rpcError('GIT_FETCH_FAILED', { reason: 'not-found' })),
    });
    const model = mount(fake.engine);
    model.url.value = 'https://x.test/acme';
    expect(await model.submit()).toEqual({ status: 'failed' });
    expect(model.error.value?.key).toBe('repository.error.fetch.not-found');
    expect(model.running.value).toBe(false);
  });
});
