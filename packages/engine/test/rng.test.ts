import { createSeededRng } from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import { createRng } from '../src/domain/rng.ts';

const ITEMS = Array.from({ length: 20 }, (_, i) => i);

describe('createRng', () => {
  it('range stays inside [lo, hi)', () => {
    const rng = createSeededRng(1);
    const draws = Array.from({ length: 2_000 }, () => rng.range(3, 7));
    expect(new Set(draws)).toEqual(new Set([3, 4, 5, 6]));
  });

  it('shuffle permutes in place and is reproducible per seed', () => {
    const a = [...ITEMS];
    createSeededRng(5).shuffle(a);
    const b = [...ITEMS];
    createSeededRng(5).shuffle(b);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(ITEMS);
    expect(a).not.toEqual(ITEMS);
  });

  it('sample returns distinct elements, capped by the input size', () => {
    const rng = createSeededRng(2);
    const three = rng.sample(ITEMS, 3);
    expect(new Set(three).size).toBe(3);
    expect(three.every((x) => ITEMS.includes(x))).toBe(true);
    expect(rng.sample(ITEMS, 100)).toHaveLength(ITEMS.length);
    expect(rng.sample(ITEMS, 0)).toEqual([]);
    expect(ITEMS).toHaveLength(20);
  });

  describe('sampleWeighted', () => {
    it('never picks zero-weight items and never repeats', () => {
      const rng = createSeededRng(3);
      for (let trial = 0; trial < 200; trial++) {
        const picked = rng.sampleWeighted(ITEMS, 8, (x) =>
          x % 2 === 0 ? 1 : 0,
        );
        expect(picked).toHaveLength(8);
        expect(new Set(picked).size).toBe(8);
        expect(picked.every((x) => x % 2 === 0)).toBe(true);
      }
      expect(
        rng.sampleWeighted(ITEMS, 50, (x) => (x < 4 ? 1 : 0)),
      ).toHaveLength(4);
    });

    it('prefers heavier items', () => {
      const rng = createSeededRng(4);
      const counts = { light: 0, heavy: 0 };
      for (let trial = 0; trial < 3_000; trial++) {
        const [pick] = rng.sampleWeighted(
          ['light', 'heavy'] as const,
          1,
          (x) => (x === 'heavy' ? 9 : 1),
        );
        counts[pick as 'light' | 'heavy']++;
      }
      expect(counts.heavy).toBeGreaterThan(counts.light * 5);
      expect(counts.light).toBeGreaterThan(0);
    });

    it('rejects invalid weights', () => {
      const rng = createRng(() => 0.5);
      expect(() => rng.sampleWeighted([1], 1, () => Number.NaN)).toThrow(
        RangeError,
      );
      expect(() => rng.sampleWeighted([1], 1, () => -1)).toThrow(RangeError);
    });
  });
});
