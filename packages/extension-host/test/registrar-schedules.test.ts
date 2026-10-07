import { describe, expect, it, vi } from 'vitest';
import { messageOf, registrarOf } from './registrar-harness.ts';

const ID = 'acme.sched';

const daily = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.morning`,
  every: 'daily',
  at: '09:00',
  ...patch,
});
const hourly = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.tick`,
  every: 'hourly',
  ...patch,
});

const register = (...entries: Record<string, unknown>[]) => {
  const harness = registrarOf(ID);
  for (const entry of entries) {
    harness.s.schedule(entry as never, async () => {});
  }
  return harness;
};

const rejection = (entry: Record<string, unknown>): string =>
  messageOf(() => register(entry));

describe('schedule', () => {
  it('daily хранит время, hourly — null; порядок снимка — порядок вызовов', () => {
    const { registrar } = register(
      daily({ at: '21:30' }),
      hourly(),
      daily({ id: `${ID}.noon`, at: '12:00' }),
    );

    expect(registrar.snapshot().schedules).toEqual([
      { id: `${ID}.morning`, every: 'daily', at: '21:30' },
      { id: `${ID}.tick`, every: 'hourly', at: null },
      { id: `${ID}.noon`, every: 'daily', at: '12:00' },
    ]);
  });

  it('обработчик остаётся в хосте', () => {
    const { registrar, s } = registrarOf(ID);
    const handler = vi.fn();

    s.schedule(hourly() as never, handler);

    expect(registrar.handlers.schedules.get(`${ID}.tick`)?.handler).toBe(
      handler,
    );
  });

  it.each([
    ['00:00', true],
    ['23:59', true],
    ['9:00', false],
    ['24:00', false],
    ['12:60', false],
    ['12:5', false],
    ['noon', false],
    ['', false],
  ])('at %j: допустимо = %s', (at, ok) => {
    const attempt = () => register(daily({ at }));

    if (ok) expect(attempt).not.toThrow();
    else expect(messageOf(attempt)).toContain('at');
  });

  it.each([
    ['daily без at', daily({ at: undefined }), 'at'],
    ['hourly с at', hourly({ at: '10:00' }), 'at'],
    ['неизвестный every', daily({ every: 'weekly' }), 'every'],
    ['нет every', daily({ every: undefined }), 'every'],
    [
      'id вне пространства расширения',
      daily({ id: 'other.morning' }),
      "id must be 'acme.sched'",
    ],
    ['лишний ключ', daily({ title: 'Morning' }), 'title'],
  ])('отклоняет: %s', (_name, entry, fragment) => {
    expect(rejection(entry)).toContain(fragment);
  });

  it('отклоняет не функцию вместо обработчика', () => {
    const { s } = registrarOf(ID);

    expect(
      messageOf(() => s.schedule(hourly() as never, 'tick' as never)),
    ).toContain('handler must be a function');
  });

  it('повтор id и более 4 расписаний', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_value, index) =>
        daily({ id: `${ID}.s${index}` }),
      );

    expect(messageOf(() => register(daily(), daily()))).toContain(
      `duplicate schedule '${ID}.morning'`,
    );
    expect(() => register(...many(4))).not.toThrow();
    expect(messageOf(() => register(...many(5)))).toContain(
      'at most 4 schedules',
    );
  });

  it('Disposable убирает расписание из снимка и обработчиков', () => {
    const { registrar, s } = register(hourly());
    const handle = s.schedule(daily() as never, async () => {});

    handle.dispose();

    expect(registrar.snapshot().schedules.map(({ id }) => id)).toEqual([
      `${ID}.tick`,
    ]);
    expect(registrar.handlers.schedules.has(`${ID}.morning`)).toBe(false);
  });
});
