import { MATERIAL_WIDTH_RANGE } from '@dolphy-app/engine-contract';

/** Панель теории не занимает больше этой доли рабочей области. */
export const MAX_SHARE = 0.6;
export const KEY_STEP_PX = 16;
export const KEY_STEP_LARGE_PX = 64;

/** Наибольшая ширина панели при рабочей области `available` px. */
export const maxWidth = (available: number): number =>
  Math.max(
    MATERIAL_WIDTH_RANGE.min,
    Math.min(MATERIAL_WIDTH_RANGE.max, Math.floor(available * MAX_SHARE)),
  );

/** Ширина в допустимых границах, целая: движок хранит только целые px. */
export const clampWidth = (width: number, available: number): number =>
  Math.round(
    Math.min(maxWidth(available), Math.max(MATERIAL_WIDTH_RANGE.min, width)),
  );

/**
 * Клавиатура на разделителе: новая ширина или `null`, если клавиша не наша.
 * `←` сужает панель, `→` расширяет (граница слева направо), `Home`/`End` — края.
 */
export const widthFromKey = (
  key: string,
  shift: boolean,
  current: number,
  available: number,
): number | null => {
  const step = shift ? KEY_STEP_LARGE_PX : KEY_STEP_PX;
  switch (key) {
    case 'ArrowLeft':
      return clampWidth(current - step, available);
    case 'ArrowRight':
      return clampWidth(current + step, available);
    case 'Home':
      return MATERIAL_WIDTH_RANGE.min;
    case 'End':
      return maxWidth(available);
    default:
      return null;
  }
};
