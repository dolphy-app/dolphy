import { describe, expect, it } from 'vitest';
import { MOUNTABLE, defineMountable, isMountable } from '../src/index.ts';

describe('defineMountable', () => {
  it('builds a branded object that keeps the mount function', () => {
    const mount = () => () => undefined;
    const mountable = defineMountable(mount);

    expect(mountable[MOUNTABLE]).toBe(true);
    expect(mountable.mount).toBe(mount);
    expect(isMountable(mountable)).toBe(true);
  });

  it('is told from a Vue-like component and from other values', () => {
    expect(isMountable({ setup: () => undefined })).toBe(false);
    expect(isMountable(() => undefined)).toBe(false);
    expect(isMountable(null)).toBe(false);
    expect(isMountable({ [MOUNTABLE]: 1 })).toBe(false);
  });

  it('the brand is the registered symbol, so separate bundles agree', () => {
    expect(MOUNTABLE).toBe(Symbol.for('dolphy.extension.mountable'));
    expect(
      isMountable({ [Symbol.for('dolphy.extension.mountable')]: true }),
    ).toBe(true);
  });
});
