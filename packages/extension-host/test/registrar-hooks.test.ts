import { describe, expect, it, vi } from 'vitest';
import { messageOf, registrarOf } from './registrar-harness.ts';

const ID = 'acme.reg';

describe('before', () => {
  it('снимок хранит имена хуков в порядке регистрации; обработчик остаётся в хосте', () => {
    const { registrar, s } = registrarOf(ID);
    const handler = vi.fn();

    s.before('practice.batch', handler);
    s.before('session.start', () => {});

    expect(registrar.snapshot().hooks).toEqual([
      'practice.batch',
      'session.start',
    ]);
    expect(registrar.handlers.hooks.get('practice.batch')).toBe(handler);
  });

  it('неизвестное имя отклоняется', () => {
    const { registrar, s } = registrarOf(ID);

    expect(
      messageOf(() => s.before('session.end' as never, (() => {}) as never)),
    ).toBe("hook 'session.end': unknown hook");
    expect(registrar.snapshot().hooks).toEqual([]);
  });

  it('повторная регистрация того же хука отклоняется', () => {
    const { s } = registrarOf(ID);
    s.before('session.start', () => {});

    expect(messageOf(() => s.before('session.start', () => {}))).toContain(
      'hook is already registered',
    );
  });

  it('обработчик не функция отклоняется', () => {
    const { registrar, s } = registrarOf(ID);

    expect(messageOf(() => s.before('session.start', 'x' as never))).toContain(
      'handler must be a function',
    );
    expect(registrar.snapshot().hooks).toEqual([]);
  });

  it('Disposable снимает хук, устаревший Disposable не снимает новый', () => {
    const { registrar, s } = registrarOf(ID);
    const first = s.before('session.start', () => {});
    first.dispose();
    expect(registrar.snapshot().hooks).toEqual([]);

    s.before('session.start', () => {});
    first.dispose();

    expect(registrar.snapshot().hooks).toEqual(['session.start']);
  });

  it('после seal регистрация отклоняется', () => {
    const { registrar, s } = registrarOf(ID);
    registrar.seal();

    expect(messageOf(() => s.before('session.start', () => {}))).toContain(
      'server() has already finished',
    );
  });
});
