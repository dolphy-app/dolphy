import { RPC_METHODS } from '@dolphy-app/engine-contract';
import { silentLogger } from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import {
  assertSameKeys,
  createDispatcher,
  schemas,
} from '../src/host/index.ts';
import { createFakeEngine } from './helpers.ts';

describe('RPC_METHODS and the argument schemas', () => {
  it('have the same keys', () => {
    expect(() =>
      assertSameKeys(Object.keys(RPC_METHODS), Object.keys(schemas)),
    ).not.toThrow();
    expect(Object.keys(schemas)).toContain('extensions.invokeRpc');
  });

  it('assertSameKeys names the missing and the extra keys', () => {
    expect(() => assertSameKeys(['a', 'b'], ['b', 'c'])).toThrow(
      'missing [a], extra [c]',
    );
  });

  it('the dispatcher refuses a schema set without a method of the table', () => {
    const partial: Partial<typeof schemas> = { ...schemas };
    delete partial['extensions.invokeRpc'];

    expect(() =>
      createDispatcher({
        engine: createFakeEngine().engine,
        schemas: partial as typeof schemas,
        logger: silentLogger,
      }),
    ).toThrow('missing [extensions.invokeRpc]');
  });
});
