import { describe, expect, it } from 'vitest';
import { moduleUrlOf } from '@/shared/lib/extension-url.ts';

const client = (revision: string) => ({
  url: 'dolphy-ext://a.b/client.mjs',
  revision,
});

describe('moduleUrlOf', () => {
  it('keeps the address for bundled extensions (empty revision)', () => {
    expect(moduleUrlOf(client(''))).toBe('dolphy-ext://a.b/client.mjs');
  });

  it('puts the revision in the query so an updated module is not served from the module cache', () => {
    expect(moduleUrlOf(client('abc123'))).toBe(
      'dolphy-ext://a.b/client.mjs?v=abc123',
    );
    expect(moduleUrlOf(client('abc123'))).not.toBe(
      moduleUrlOf(client('def456')),
    );
  });

  it('a retry attempt gets its own address, with or without a revision', () => {
    expect(moduleUrlOf(client(''), 2)).toBe(
      'dolphy-ext://a.b/client.mjs?retry=2',
    );
    expect(moduleUrlOf(client('r1'), 1)).toBe(
      'dolphy-ext://a.b/client.mjs?v=r1&retry=1',
    );
  });
});
