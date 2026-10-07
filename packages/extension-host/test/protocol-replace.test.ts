import { EMPTY_SERVER_REGISTRATION } from '@dolphy-app/extension-api';
import { describe, expect, it } from 'vitest';
import {
  extMessageSchema,
  replaceExtensionsResultSchema,
} from '../src/protocol.ts';
import { candidateOf } from './helpers.ts';

const ID = 'acme.surf';

const replace = (extensions: unknown[]) => ({
  id: '1',
  method: 'replaceExtensions',
  params: { extensions },
});

const accepts = (message: unknown): boolean =>
  extMessageSchema.safeParse(message).success;

describe('протокол: replaceExtensions', () => {
  it('принимает набор кандидатов, в том числе без кода и пустой', () => {
    expect(
      accepts(
        replace([
          candidateOf(ID),
          candidateOf('acme.data', { mainPath: null }),
          candidateOf('acme.dev', { origin: 'dev', clientPath: '/x/c.mjs' }),
        ]),
      ),
    ).toBe(true);
    expect(accepts(replace([]))).toBe(true);
  });

  it.each([
    'id',
    'version',
    'dir',
    'revision',
    'origin',
    'mainPath',
    'clientPath',
    'dependencies',
    'warnings',
  ])('набор, где у кандидата нет поля %s, отвергается целиком', (key) => {
    const rest = Object.fromEntries(
      Object.entries(candidateOf(ID)).filter(([name]) => name !== key),
    );

    expect(accepts(replace([candidateOf('acme.other'), rest]))).toBe(false);
  });

  it('отвергает неизвестное происхождение и лишние ключи сообщения', () => {
    expect(accepts(replace([{ ...candidateOf(ID), origin: 'remote' }]))).toBe(
      false,
    );
    expect(accepts({ ...replace([candidateOf(ID)]), extra: 1 })).toBe(false);
    expect(accepts({ id: '1', method: 'replaceExtensions', params: {} })).toBe(
      false,
    );
  });

  it('принимает вызов invokeCommand с аргументами и без них, отвергает лишние ключи', () => {
    const call = (params: Record<string, unknown>) =>
      accepts({ id: '1', method: 'invokeCommand', params });
    const base = { extensionId: ID, commandId: `${ID}.run` };

    expect(call(base)).toBe(true);
    expect(call({ ...base, args: { a: [1] } })).toBe(true);
    expect(call({ ...base, extra: 1 })).toBe(false);
    expect(call({ extensionId: ID })).toBe(false);
  });
});

describe('протокол: ответ на replaceExtensions', () => {
  const parse = (value: unknown) =>
    replaceExtensionsResultSchema.safeParse(value).success;

  it('принимает регистрацию и ошибку по каждому расширению', () => {
    expect(
      parse({
        registrations: {
          [ID]: { ok: true, registration: EMPTY_SERVER_REGISTRATION },
          'acme.bad': { ok: false, error: 'main.mjs does not export server' },
        },
      }),
    ).toBe(true);
  });

  it.each([
    ['ошибка без текста', { 'acme.bad': { ok: false } }],
    ['успех без регистрации', { [ID]: { ok: true } }],
    ['успех с ошибкой', { [ID]: { ok: true, registration: {}, error: 'x' } }],
    ['регистрация не объект', { [ID]: { ok: true, registration: 1 } }],
  ])('отвергает: %s', (_name, registrations) => {
    expect(parse({ registrations })).toBe(false);
  });
});
