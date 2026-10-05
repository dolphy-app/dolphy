import { effectScope } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type {
  EngineEvent,
  LearningEngine,
  RepositoryCourseDto,
  RepositoryDto,
  RepositoryPreviewDto,
} from '@dolphy-app/engine-contract';
import {
  blockedCourses,
  installedIds,
  requiredBy,
  selectableIds,
  toggleCourse,
} from '@/entities/repository';
import { useRepositoryCourses } from '@/pages/settings/model/repository-courses.ts';
import { createTestQueryCache } from './support/query-cache.ts';

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

const sorted = (ids: Iterable<string>) => [...ids].sort();

describe('blockedCourses', () => {
  it('блокирует курсы с ошибками и с конфликтом id, а по цепочке requires — и зависящие от них', () => {
    const courses = [
      course('broken', { errors: 1 }),
      course('taken', { inLibrary: true }),
      course('needs-broken', { requires: ['broken'] }),
      course('deep', { requires: ['needs-broken'] }),
      course('ok'),
    ];
    expect([...blockedCourses(courses)]).toEqual([
      ['broken', 'errors'],
      ['taken', 'in-library'],
      ['needs-broken', 'requires-blocked'],
      ['deep', 'requires-blocked'],
    ]);
    expect(sorted(selectableIds(courses))).toEqual(['ok']);
  });

  it('предупреждения курс не блокируют', () => {
    expect(blockedCourses([course('a', { warnings: 3 })]).size).toBe(0);
  });
});

describe('toggleCourse', () => {
  const courses = [
    course('a'),
    course('b', { requires: ['a'] }),
    course('c', { requires: ['b'] }),
    course('x', { errors: 1 }),
  ];

  it('отмечает курс вместе со всей цепочкой нужных', () => {
    expect(sorted(toggleCourse(courses, new Set(), 'c'))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('не снимает курс, пока отмечен курс, которому он нужен', () => {
    const all = new Set(['a', 'b', 'c']);
    expect(sorted(toggleCourse(courses, all, 'a'))).toEqual(['a', 'b', 'c']);
    expect(sorted(toggleCourse(courses, all, 'c'))).toEqual(['a', 'b']);
    expect(requiredBy(courses, all).get('a')).toEqual(['b']);
  });

  it('недоступный курс не отмечается', () => {
    expect([...toggleCourse(courses, new Set(), 'x')]).toEqual([]);
  });

  it('не меняет переданное множество', () => {
    const before = new Set(['a']);
    toggleCourse(courses, before, 'b');
    expect([...before]).toEqual(['a']);
  });
});

describe('installedIds', () => {
  it('возвращает установленные курсы, которые ещё можно поставить', () => {
    expect(
      sorted(
        installedIds([
          course('a', { installed: true }),
          course('b', { installed: true, errors: 1 }),
          course('c'),
        ]),
      ),
    ).toEqual(['a']);
  });
});

const repository: RepositoryDto = {
  id: 'acme',
  url: 'https://x.test/acme',
  ref: 'v1',
  commit: 'a'.repeat(40),
  fetchedAt: 0,
  status: 'ready',
  courseIds: ['a'],
  skippedCourseIds: ['b', 'c'],
};

interface Pending {
  resolve: (value: RepositoryPreviewDto) => void;
  reject: (reason: unknown) => void;
}

const createFake = () => {
  const listeners = new Set<(event: EngineEvent) => void>();
  const pending: Pending[] = [];
  const cancel = vi.fn(() => Promise.resolve(true));
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
          pending.push({ resolve, reject });
        });
      },
    },
  } as unknown as LearningEngine;
  const emit = (event: EngineEvent) => {
    for (const listener of listeners) listener(event);
  };
  return { engine, pending, cancel, previewCalls, emit };
};

const listing = (courses: RepositoryCourseDto[]): RepositoryPreviewDto => ({
  url: repository.url,
  ref: 'v1',
  commit: 'b'.repeat(40),
  courses,
  previewId: 'p1',
});

const mount = (engine: LearningEngine) =>
  effectScope().run(() =>
    useRepositoryCourses(engine, createTestQueryCache()),
  )!;

describe('useRepositoryCourses', () => {
  it('просматривает репозиторий с его веткой и отмечает установленные курсы', async () => {
    const fake = createFake();
    const model = mount(fake.engine);
    const loading = model.load(repository);
    expect(model.loading.value).toBe(true);
    expect(fake.previewCalls).toEqual([{ url: repository.url, ref: 'v1' }]);
    fake.pending[0]?.resolve(
      listing([
        course('a', { installed: true }),
        course('b', { requires: ['a'] }),
      ]),
    );
    await loading;
    expect(model.loading.value).toBe(false);
    expect([...model.selected.value]).toEqual(['a']);
    expect(model.canApply.value).toBe(false);
    model.toggle('b');
    expect(model.changed.value).toBe(true);
    expect(model.canApply.value).toBe(true);
    model.clear();
    expect(model.canApply.value).toBe(false);
  });

  it('ветку по умолчанию не передаёт', async () => {
    const fake = createFake();
    const model = mount(fake.engine);
    void model.load({ ...repository, ref: null });
    expect(fake.previewCalls).toEqual([{ url: repository.url }]);
  });

  it('прогресс берётся из событий этого репозитория', async () => {
    const fake = createFake();
    const model = mount(fake.engine);
    const loading = model.load(repository);
    fake.emit({
      type: 'repository-progress',
      id: 'other',
      phase: 'fetch',
    });
    expect(model.progress.value).toBeNull();
    fake.emit({ type: 'repository-progress', id: 'acme', phase: 'fetch' });
    expect(model.progress.value).toMatchObject({ phase: 'fetch' });
    fake.pending[0]?.resolve(listing([course('a', { installed: true })]));
    await loading;
    expect(model.progress.value).toBeNull();
  });

  it('закрытие во время загрузки отменяет её и отбрасывает результат', async () => {
    const fake = createFake();
    const model = mount(fake.engine);
    const loading = model.load(repository);
    model.reset();
    expect(fake.cancel).toHaveBeenCalledExactlyOnceWith('acme');
    fake.pending[0]?.resolve(listing([course('a', { installed: true })]));
    await loading;
    expect(model.preview.value).toBeNull();
    expect(model.target.value).toBeNull();
    expect(model.loading.value).toBe(false);
  });

  it('ошибка предпросмотра показывается, отмена — нет', async () => {
    const fake = createFake();
    const model = mount(fake.engine);
    const failed = model.load(repository);
    fake.pending[0]?.reject(
      Object.assign(new Error('x'), {
        code: 'GIT_FETCH_FAILED',
        retryable: false,
        details: { reason: 'network' },
      }),
    );
    await failed;
    expect(model.error.value?.key).toBe('repository.error.fetch.network');
    expect(model.canApply.value).toBe(false);

    const cancelled = model.load(repository);
    fake.pending[1]?.reject(
      Object.assign(new Error('x'), {
        code: 'GIT_FETCH_FAILED',
        retryable: false,
        details: { reason: 'cancelled' },
      }),
    );
    await cancelled;
    expect(model.error.value).toBeNull();
  });
});

describe('useRepositoryCourses и кэш предпросмотра', () => {
  it('повторное открытие «Курсы…» того же репозитория не вызывает preview', async () => {
    const fake = createFake();
    const cache = createTestQueryCache();
    const first = effectScope().run(() =>
      useRepositoryCourses(fake.engine, cache),
    )!;
    const loading = first.load(repository);
    fake.pending[0]?.resolve(listing([course('a', { installed: true })]));
    await loading;
    first.reset();

    const second = effectScope().run(() =>
      useRepositoryCourses(fake.engine, cache),
    )!;
    await second.load(repository);
    expect(fake.previewCalls).toHaveLength(1);
    expect([...second.selected.value]).toEqual(['a']);
  });
});
