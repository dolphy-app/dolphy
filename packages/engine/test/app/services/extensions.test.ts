import type { ExtensionInfoDto } from '@lms/engine-contract';
import { createFakeExtensionRegistry } from '@lms/testkit';
import { describe, expect, it } from 'vitest';
import { createTestEngine } from '../../helpers/engine.ts';

const info = (overrides: Partial<ExtensionInfoDto>): ExtensionInfoDto => ({
  id: 'lms.sql',
  version: '1.0.0',
  origin: 'bundled',
  state: 'loaded',
  exerciseTypes: ['lms.sql'],
  message: null,
  ...overrides,
});

const open = (items?: ExtensionInfoDto[]) =>
  createTestEngine({
    extensionRegistry: createFakeExtensionRegistry(items),
  });

describe('extensions.list', () => {
  it('returns an empty list for an empty registry', async () => {
    const { engine } = await open();
    expect(await engine.extensions.list()).toEqual([]);
  });

  it('orders by id, then by origin priority bundled < user < dev', async () => {
    const { engine } = await open([
      info({ id: 'b.ext', origin: 'dev' }),
      info({ id: 'a.ext', origin: 'dev' }),
      info({ id: 'a.ext', origin: 'bundled', state: 'overridden' }),
      info({ id: 'a.ext', origin: 'user', state: 'overridden' }),
      info({ id: 'b.ext', origin: 'bundled' }),
    ]);
    const list = await engine.extensions.list();
    expect(list.map(({ id, origin }) => `${id}:${origin}`)).toEqual([
      'a.ext:bundled',
      'a.ext:user',
      'a.ext:dev',
      'b.ext:bundled',
      'b.ext:dev',
    ]);
  });

  it('returns copies: mutating the result does not affect the registry', async () => {
    const { engine } = await open([info({})]);
    const [first] = await engine.extensions.list();
    first?.exerciseTypes.push('evil');
    if (first !== undefined) first.message = 'changed';
    expect(await engine.extensions.list()).toEqual([info({})]);
  });
});
