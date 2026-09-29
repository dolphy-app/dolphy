import type { Precision } from '../scoring/types.ts';

const identity = (x: number) => x;

/**
 * Округление эмулируемой точности: `Math.fround` для двойника `f32` (сверка с
 * Rust), тождество для продукции `f64` (engine-ts-testing.md §4).
 */
export const roundOf = (precision: Precision): ((x: number) => number) =>
  precision === 'f32' ? Math.fround : identity;
