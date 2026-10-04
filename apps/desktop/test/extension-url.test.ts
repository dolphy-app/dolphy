import { describe, expect, it } from 'vitest';
import { moduleUrlOf } from '@/shared/lib/extension-url.ts';

describe('moduleUrlOf', () => {
  it('keeps the address for bundled extensions (empty revision)', () => {
    expect(
      moduleUrlOf({
        rendererUrl: 'dolphy-ext://dolphy.sql/view.mjs',
        revision: '',
      }),
    ).toBe('dolphy-ext://dolphy.sql/view.mjs');
  });

  it('puts the revision in the query so an updated module is not served from the module cache', () => {
    const url = (revision: string) =>
      moduleUrlOf({ rendererUrl: 'dolphy-ext://a.b/view.mjs', revision });
    expect(url('abc123')).toBe('dolphy-ext://a.b/view.mjs?v=abc123');
    expect(url('abc123')).not.toBe(url('def456'));
  });
});
