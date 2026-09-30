import { describe, expect, it } from 'vitest';
import {
  describeRepositoryError,
  progressPercent,
  reduceProgress,
  clearProgress,
  shortCommit,
  toEngineError,
  validateRepositoryRef,
  validateRepositoryUrl,
} from '@/entities/repository';

describe('validateRepositoryUrl', () => {
  it('принимает http и https', () => {
    expect(
      validateRepositoryUrl('https://github.com/acme/course.git'),
    ).toBeNull();
    expect(validateRepositoryUrl(' http://example.org/repo ')).toBeNull();
  });

  it('отвергает пустой, некорректный, чужую схему и учётные данные', () => {
    expect(validateRepositoryUrl('  ')).toBe('url-empty');
    expect(validateRepositoryUrl('github.com/acme')).toBe('url-invalid');
    expect(validateRepositoryUrl('ssh://git@github.com/acme/c')).toBe(
      'url-scheme',
    );
    expect(validateRepositoryUrl('file:///tmp/repo')).toBe('url-scheme');
    expect(validateRepositoryUrl('https://user@github.com/a/b')).toBe(
      'url-credentials',
    );
    expect(validateRepositoryUrl('https://user:pw@github.com/a/b')).toBe(
      'url-credentials',
    );
  });
});

describe('validateRepositoryRef', () => {
  it('пустой ref — ветка по умолчанию', () => {
    expect(validateRepositoryRef('')).toBeNull();
    expect(validateRepositoryRef('  ')).toBeNull();
    expect(validateRepositoryRef('v1.2/release')).toBeNull();
  });

  it('отвергает пробелы и «..»', () => {
    expect(validateRepositoryRef('my branch')).toBe('ref-spaces');
    expect(validateRepositoryRef('a..b')).toBe('ref-dotdot');
  });
});

describe('describeRepositoryError', () => {
  const error = (
    code: Parameters<typeof describeRepositoryError>[0]['code'],
    details?: Record<string, unknown>,
  ) => ({
    code,
    message: 'engine text',
    retryable: false,
    ...(details && { details }),
  });

  it('GIT_FETCH_FAILED различает причины по details.reason', () => {
    expect(
      describeRepositoryError(error('GIT_FETCH_FAILED', { reason: 'timeout' }))
        .key,
    ).toBe('repository.error.fetch.timeout');
    expect(
      describeRepositoryError(error('GIT_FETCH_FAILED', { reason: 'nope' })),
    ).toMatchObject({
      key: 'repository.error.fetch.unknown',
      messages: ['engine text'],
    });
  });

  it('отмена пользователем помечена и не считается ошибкой показа', () => {
    const view = describeRepositoryError(
      error('GIT_FETCH_FAILED', { reason: 'cancelled' }),
    );
    expect(view.cancelled).toBe(true);
  });

  it('INVALID_ARGUMENT привязывается к полю', () => {
    expect(
      describeRepositoryError(error('INVALID_ARGUMENT', { field: 'ref' })),
    ).toMatchObject({ key: 'repository.error.invalid', field: 'ref' });
    expect(
      describeRepositoryError(error('INVALID_ARGUMENT')).field,
    ).toBeUndefined();
  });

  it('REPOSITORY_REJECTED: причина — ключ, диагностики — как есть', () => {
    const view = describeRepositoryError(
      error('REPOSITORY_REJECTED', {
        reason: 'reload-rejected',
        summary: 'summary',
        path: 'a/b',
        diagnostics: [{ message: 'E_ID_DUPLICATE x' }, { message: 'second' }],
      }),
    );
    expect(view).toMatchObject({
      key: 'repository.error.rejected.reload-rejected',
      path: 'a/b',
      messages: ['E_ID_DUPLICATE x', 'second'],
    });
  });

  it('REPOSITORY_REJECTED без диагностик показывает summary', () => {
    expect(
      describeRepositoryError(
        error('REPOSITORY_REJECTED', {
          reason: 'no-courses',
          summary: 'empty',
        }),
      ).messages,
    ).toEqual(['empty']);
  });

  it('REPOSITORY_EXISTS и неизвестный код', () => {
    expect(describeRepositoryError(error('REPOSITORY_EXISTS')).key).toBe(
      'repository.error.exists',
    );
    expect(describeRepositoryError(error('STORE_BUSY'))).toMatchObject({
      key: 'repository.error.unknown',
      messages: ['engine text'],
    });
  });
});

describe('toEngineError', () => {
  it('берёт код и details у ошибки RPC, остальное — INTERNAL', () => {
    const rpc = Object.assign(new Error('m'), {
      code: 'REPOSITORY_EXISTS',
      retryable: false,
      details: { id: 'x' },
    });
    expect(toEngineError(rpc)).toMatchObject({
      code: 'REPOSITORY_EXISTS',
      details: { id: 'x' },
    });
    expect(toEngineError(new Error('boom'))).toMatchObject({
      code: 'INTERNAL',
      message: 'boom',
    });
  });
});

describe('прогресс', () => {
  it('процент определён только при известном total', () => {
    const base = { id: 'r', phase: 'fetch' as const };
    expect(progressPercent(base)).toBeNull();
    expect(progressPercent({ ...base, loaded: 5 })).toBeNull();
    expect(progressPercent({ ...base, loaded: 0, total: 0 })).toBeNull();
    expect(progressPercent({ ...base, loaded: 1, total: 4 })).toBe(25);
    expect(progressPercent({ ...base, loaded: 9, total: 4 })).toBe(100);
  });

  it('новое событие заменяет прежнее, счётчики этапа не переносятся', () => {
    let state = reduceProgress(
      {},
      {
        type: 'repository-progress',
        id: 'a',
        phase: 'fetch',
        loaded: 1,
        total: 2,
      },
    );
    state = reduceProgress(state, {
      type: 'repository-progress',
      id: 'a',
      phase: 'export',
    });
    expect(state['a']).toEqual({ id: 'a', phase: 'export' });
    expect(clearProgress(state, 'a')).toEqual({});
  });

  it('короткий коммит — 7 символов', () => {
    expect(shortCommit('0123456789abcdef')).toBe('0123456');
  });
});
