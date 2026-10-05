import { describe, expect, it } from 'vitest';
import {
  GAP,
  MARGIN,
  placeCard,
} from '@/features/onboarding-tour/lib/placement.ts';
import type { Box } from '@/features/onboarding-tour/lib/placement.ts';

const viewport = { width: 1280, height: 768 };
const card = { width: 352, height: 234 };

const intersects = (a: Box, b: Box) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;
const boxOf = (placement: { left: number; top: number }): Box => ({
  left: placement.left,
  top: placement.top,
  ...card,
});

describe('tour card placement', () => {
  it('goes to the preferred side with a gap when there is room', () => {
    const target = { left: 300, top: 100, width: 400, height: 60 };
    const placement = placeCard(target, card, viewport, 'bottom');
    expect(placement.side).toBe('bottom');
    expect(placement.top).toBe(target.top + target.height + GAP);
    expect(placement.overlap).toBe(0);
  });

  it('flips to the opposite side when the preferred one does not fit', () => {
    const target = { left: 300, top: 600, width: 400, height: 60 };
    const placement = placeCard(target, card, viewport, 'bottom');
    expect(placement.side).toBe('top');
    expect(placement.top).toBe(target.top - GAP - card.height);
  });

  it('moves beside a target that is too tall to sit above or below', () => {
    const target = { left: 266, top: 206, width: 492, height: 436 };
    const placement = placeCard(target, card, viewport, 'bottom');
    expect(placement.side).toBe('end');
    expect(placement.overlap).toBe(0);
    expect(placement.left).toBe(target.left + target.width + GAP);
  });

  it('docks in a corner when nothing fits beside the target and covers it as little as possible', () => {
    const narrow = { width: 900, height: 568 };
    const target = { left: 266, top: 270, width: 608, height: 436 };
    const placement = placeCard(target, card, narrow, 'bottom');
    const others = [
      placeCard(target, card, narrow, 'top'),
      placeCard(target, card, narrow, 'end'),
    ];
    for (const other of others) {
      expect(placement.overlap).toBeLessThanOrEqual(other.overlap);
    }
    expect(placement.left).toBeGreaterThanOrEqual(MARGIN);
    expect(placement.top).toBeGreaterThanOrEqual(MARGIN);
  });

  it('never leaves the window', () => {
    const targets: Box[] = [
      { left: 0, top: 0, width: 50, height: 50 },
      { left: 1230, top: 718, width: 50, height: 50 },
      { left: 1100, top: 20, width: 190, height: 48 },
    ];
    for (const target of targets) {
      for (const side of ['top', 'bottom', 'start', 'end'] as const) {
        const placement = placeCard(target, card, viewport, side);
        expect(placement.left).toBeGreaterThanOrEqual(MARGIN);
        expect(placement.top).toBeGreaterThanOrEqual(MARGIN);
        expect(placement.left + card.width).toBeLessThanOrEqual(
          viewport.width - MARGIN,
        );
        expect(placement.top + card.height).toBeLessThanOrEqual(
          viewport.height - MARGIN,
        );
      }
    }
  });

  it('reports no overlap exactly when the card does not touch the target', () => {
    const target = { left: 6, top: 83, width: 227, height: 60 };
    for (const side of ['top', 'bottom', 'start', 'end'] as const) {
      const placement = placeCard(target, card, viewport, side);
      expect(placement.overlap === 0).toBe(
        !intersects(boxOf(placement), target),
      );
    }
  });

  it('keeps clear of a target at the left edge by placing the card on its right', () => {
    const target = { left: 6, top: 83, width: 227, height: 60 };
    const placement = placeCard(target, card, viewport, 'end');
    expect(placement.side).toBe('end');
    expect(placement.left).toBe(target.left + target.width + GAP);
  });
});
