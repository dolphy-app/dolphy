import { MATERIAL_WIDTH_RANGE } from '@dolphy-app/engine-contract';

export const KEY_STEP_PX = 16;
export const KEY_STEP_LARGE_PX = 64;

/**
 * Наибольшая ширина панели при рабочей области `available` px: вся область,
 * чтобы теорию можно было раскрыть для чтения (упражнение при этом скрыто).
 */
export const maxWidth = (available: number): number =>
  Math.max(
    MATERIAL_WIDTH_RANGE.min,
    Math.min(MATERIAL_WIDTH_RANGE.max, Math.floor(available)),
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
