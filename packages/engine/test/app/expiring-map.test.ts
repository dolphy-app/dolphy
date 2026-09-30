import { createFakeClock } from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import { createExpiringMap } from '../../src/app/index.ts';

const HOUR_MS = 3_600_000;

describe('createExpiringMap', () => {
  it('entries expire after ttlMs', () => {
    const clock = createFakeClock();
    const map = createExpiringMap<string>({
      capacity: 10,
      ttlMs: 24 * HOUR_MS,
      clock,
    });
    map.set('a', 'A');
    clock.advance(24 * HOUR_MS - 1);
    expect(map.get('a')).toBe('A');
    clock.advance(1);
    expect(map.get('a')).toBeUndefined();
    expect(map.size).toBe(0);
  });

  it('evicts the oldest entry when the capacity is reached', () => {
    const clock = createFakeClock();
    const map = createExpiringMap<number>({
      capacity: 3,
      ttlMs: HOUR_MS,
      clock,
    });
    for (const [index, key] of ['a', 'b', 'c', 'd'].entries()) {
      map.set(key, index);
    }
    expect(map.get('a')).toBeUndefined();
    expect(['b', 'c', 'd'].map((key) => map.get(key))).toEqual([1, 2, 3]);
    expect(map.size).toBe(3);
  });

  it('expired entries do not count against the capacity', () => {
    const clock = createFakeClock();
    const map = createExpiringMap<number>({ capacity: 2, ttlMs: 10, clock });
    map.set('a', 1);
    clock.advance(5);
    map.set('b', 2);
    clock.advance(6); // 'a' истёк, 'b' жив
    map.set('c', 3);
    expect(map.get('b')).toBe(2);
    expect(map.get('c')).toBe(3);
  });

  it('overwriting a key refreshes it without evicting others', () => {
    const clock = createFakeClock();
    const map = createExpiringMap<number>({
      capacity: 2,
      ttlMs: HOUR_MS,
      clock,
    });
    map.set('a', 1);
    map.set('b', 2);
    map.set('a', 3);
    expect(map.get('a')).toBe(3);
    expect(map.get('b')).toBe(2);
    map.set('c', 4); // самый старый теперь 'b'
    expect(map.get('b')).toBeUndefined();
    expect(map.get('a')).toBe(3);
  });

  it('delete removes an entry', () => {
    const clock = createFakeClock();
    const map = createExpiringMap<number>({
      capacity: 2,
      ttlMs: HOUR_MS,
      clock,
    });
    map.set('a', 1);
    expect(map.delete('a')).toBe(true);
    expect(map.delete('a')).toBe(false);
    expect(map.get('a')).toBeUndefined();
  });
});
