import { EXTENSION_RPC_LIMITS } from '@dolphy-app/extension-api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { messageOf, registrarOf } from './registrar-harness.ts';

const ID = 'acme.rpc';

const contract = (name: string) => ({
  name,
  input: z.object({ who: z.string() }),
  output: z.object({ greeting: z.string() }),
});

const answer = ({ who }: { who: string }) => ({ greeting: `hi ${who}` });

describe('server.handle', () => {
  it('запоминает обработчик и схемы, имя попадает в снимок', () => {
    const { registrar, s } = registrarOf(ID);
    const hello = contract('greeting.say-hello');

    s.handle(hello, answer);
    s.handle(contract('greeting.say-bye'), answer);

    expect(registrar.snapshot().rpcs).toEqual([
      'greeting.say-hello',
      'greeting.say-bye',
    ]);
    const entry = registrar.handlers.rpcs.get('greeting.say-hello');
    expect(entry?.contract.input).toBe(hello.input);
    expect(entry?.contract.output).toBe(hello.output);
    expect(entry?.handler({ who: 'Ann' })).toEqual({ greeting: 'hi Ann' });
  });

  it('снимок сериализуем: схемы и обработчики в нём не уходят', () => {
    const { registrar, s } = registrarOf(ID);
    s.handle(contract('greeting.say-hello'), answer);

    expect(structuredClone(registrar.snapshot())).toEqual(registrar.snapshot());
  });

  it.each([
    ['без точки', 'greeting'],
    ['заглавная буква', 'Greeting.say'],
    ['дефис в первом сегменте', 'my-greeting.say'],
    ['пустой сегмент', 'greeting..say'],
    ['длиннее предела', `a.${'b'.repeat(EXTENSION_RPC_LIMITS.nameLength)}`],
  ])('имя «%s» отвергается, ошибка называет правило', (_title, name) => {
    const { registrar, s } = registrarOf(ID);

    expect(messageOf(() => s.handle(contract(name), answer))).toContain('name');
    expect(registrar.snapshot().rpcs).toEqual([]);
  });

  it('имя на границе допустимой длины принимается', () => {
    const { registrar, s } = registrarOf(ID);
    const longest = `a.${'b'.repeat(EXTENSION_RPC_LIMITS.nameLength - 2)}`;

    s.handle(contract(longest), answer);

    expect(registrar.snapshot().rpcs).toEqual([longest]);
  });

  it('повторное имя отвергается и называет его', () => {
    const { registrar, s } = registrarOf(ID);
    s.handle(contract('greeting.say-hello'), answer);

    const message = messageOf(() =>
      s.handle(contract('greeting.say-hello'), () => ({ greeting: 'second' })),
    );

    expect(message).toContain("rpc 'greeting.say-hello'");
    expect(message).toContain('duplicate');
    expect(
      registrar.handlers.rpcs.get('greeting.say-hello')?.handler({ who: 'x' }),
    ).toEqual({ greeting: 'hi x' });
  });

  it('больше EXTENSION_RPC_LIMITS.rpcs обработчиков отвергается', () => {
    const { registrar, s } = registrarOf(ID);
    for (let index = 0; index < EXTENSION_RPC_LIMITS.rpcs; index++) {
      s.handle(contract(`bulk.item-${index}`), answer);
    }

    expect(messageOf(() => s.handle(contract('bulk.over'), answer))).toContain(
      `at most ${EXTENSION_RPC_LIMITS.rpcs} rpcs`,
    );
    expect(registrar.snapshot().rpcs).toHaveLength(EXTENSION_RPC_LIMITS.rpcs);
  });

  it.each([
    ['не объект', 'greeting.say-hello'],
    ['без схем', { name: 'greeting.say-hello' }],
    [
      'схема не zod',
      { name: 'greeting.say-hello', input: {}, output: z.string() },
    ],
  ])('контракт «%s» отвергается', (_title, value) => {
    const { s } = registrarOf(ID);

    expect(() => s.handle(value as never, answer)).toThrow();
  });

  it('обработчик не функция — ошибка регистрации', () => {
    const { s } = registrarOf(ID);

    expect(
      messageOf(() => s.handle(contract('greeting.say-hello'), 'no' as never)),
    ).toContain('handler must be a function');
  });

  it('dispose снимает обработчик и освобождает имя; чужой dispose не трогает новую запись', async () => {
    const { registrar, s } = registrarOf(ID);
    const first = s.handle(contract('greeting.say-hello'), answer);

    await first.dispose();
    expect(registrar.snapshot().rpcs).toEqual([]);
    s.handle(contract('greeting.say-hello'), () => ({ greeting: 'again' }));
    await first.dispose();

    expect(registrar.snapshot().rpcs).toEqual(['greeting.say-hello']);
  });

  it('после seal регистрация бросает', () => {
    const { registrar, s } = registrarOf(ID);
    registrar.seal();

    expect(
      messageOf(() => s.handle(contract('greeting.say-hello'), answer)),
    ).toContain('server() has already finished');
  });
});
