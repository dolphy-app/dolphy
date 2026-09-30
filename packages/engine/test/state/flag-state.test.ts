import { buildUnitFlag, T0_MS } from '@spirula/testkit';
import { describe, expect, it } from 'vitest';
import { createFlagState } from '../../src/state/flag-state.ts';

const flag = (
  seq: number,
  unitId: string,
  op: 'set' | 'unset' = 'set',
  kind: 'blacklist' | 'review' = 'blacklist',
  extra: { deviceId?: string; at?: number } = {},
) =>
  buildUnitFlag({
    seq,
    unitId,
    op,
    flag: kind,
    at: T0_MS + (extra.at ?? seq) * 1_000,
    ...(extra.deviceId !== undefined && { deviceId: extra.deviceId }),
  });

describe('FlagState (LWW)', () => {
  it('the newest record wins regardless of arrival order', () => {
    const state = createFlagState();
    state.apply(flag(2, 'u', 'unset'));
    state.apply(flag(1, 'u', 'set'));
    expect(state.has('blacklist', 'u')).toBe(false);
    state.apply(flag(3, 'u', 'set'));
    expect(state.has('blacklist', 'u')).toBe(true);
  });

  it('blacklist and review are independent', () => {
    const state = createFlagState();
    state.apply(flag(1, 'u', 'set', 'blacklist'));
    state.apply(flag(2, 'u', 'set', 'review'));
    state.apply(flag(3, 'u', 'unset', 'blacklist'));
    expect(state.isBlacklisted('u')).toBe(false);
    expect(state.entries()).toEqual(['u']);
  });

  it('lists in order of addition; a re-set moves the unit to the end', () => {
    const state = createFlagState();
    state.apply(flag(1, 'a'));
    state.apply(flag(2, 'b'));
    state.apply(flag(3, 'a', 'unset'));
    state.apply(flag(4, 'a'));
    expect(state.list('blacklist')).toEqual(['b', 'a']);
  });

  it('ties on at are decided by deviceId, then seq (T-03)', () => {
    const state = createFlagState();
    state.apply(flag(1, 'u', 'set', 'blacklist', { deviceId: 'a', at: 5 }));
    state.apply(flag(1, 'u', 'unset', 'blacklist', { deviceId: 'b', at: 5 }));
    expect(state.has('blacklist', 'u')).toBe(false);
    state.apply(flag(1, 'v', 'unset', 'blacklist', { deviceId: 'b', at: 5 }));
    state.apply(flag(1, 'v', 'set', 'blacklist', { deviceId: 'a', at: 5 }));
    expect(state.has('blacklist', 'v')).toBe(false);
  });

  it('applying a record twice reports no change', () => {
    const state = createFlagState();
    const entry = flag(1, 'u');
    expect(state.apply(entry)).toBe(true);
    expect(state.apply(entry)).toBe(false);
  });

  it('prefix-like ids are exact members, not patterns (T-05)', () => {
    const state = createFlagState();
    state.apply(flag(1, 'a_b'));
    expect(state.has('blacklist', 'axb')).toBe(false);
    expect(state.has('blacklist', 'a_b')).toBe(true);
    expect(state.has('blacklist', 'A_B')).toBe(false);
  });
});
