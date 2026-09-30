import { describe, expect, it } from 'vitest';
import {
  normalizeValue,
  selectedIndices,
  toggleSelection,
} from '../src/choice-model.ts';

describe('choice-model', () => {
  it('радио заменяет выбор', () => {
    expect(toggleSelection([1], 2, false)).toEqual([2]);
  });

  it('чекбокс переключает и сохраняет порядок', () => {
    expect(toggleSelection([3], 1, true)).toEqual([1, 3]);
    expect(toggleSelection([1, 3], 1, true)).toEqual([3]);
  });

  it('selectedIndices берёт отмеченные по порядку', () => {
    expect(selectedIndices([true, false, true])).toEqual([0, 2]);
    expect(selectedIndices([false, false])).toEqual([]);
  });

  it('normalizeValue отбрасывает мусор и дубли', () => {
    expect(normalizeValue([2, 2, 9, -1, 'x', 0], 3)).toEqual([0, 2]);
    expect(normalizeValue(undefined, 3)).toEqual([]);
  });
});
