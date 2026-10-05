export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Side = 'top' | 'bottom' | 'start' | 'end';

export interface Placement {
  left: number;
  top: number;
  /** Сторона цели или `dock` — угол окна, когда рядом с целью места нет. */
  side: Side | 'dock';
  /** Площадь, на которую карточка всё же накрывает цель (0 — не накрывает). */
  overlap: number;
}

/** Зазор между подсвеченной областью и карточкой, px. */
export const GAP = 16;
/** Отступ карточки от краёв окна, px. */
export const MARGIN = 12;

const OPPOSITE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  start: 'end',
  end: 'start',
};
const ACROSS: Record<Side, [Side, Side]> = {
  top: ['end', 'start'],
  bottom: ['end', 'start'],
  start: ['bottom', 'top'],
  end: ['bottom', 'top'],
};

const overlapOf = (a: Box, b: Box): number =>
  Math.max(
    0,
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left),
  ) *
  Math.max(
    0,
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top),
  );

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Куда поставить карточку шага, чтобы она не закрывала подсвеченную цель:
 * сначала желаемая сторона, затем противоположная и боковые; если ни с одной
 * стороны места нет (цель на пол-окна), карточка уходит в угол окна, где она
 * закрывает цель меньше всего. Первая позиция без перекрытия побеждает.
 */
export const placeCard = (
  target: Box,
  card: Size,
  viewport: Size,
  preferred: Side = 'bottom',
): Placement => {
  const maxLeft = viewport.width - card.width - MARGIN;
  const maxTop = viewport.height - card.height - MARGIN;
  const centerX = target.left + target.width / 2 - card.width / 2;
  const centerY = target.top + target.height / 2 - card.height / 2;

  const at = (side: Side | 'dock', left: number, top: number): Placement => {
    const x = clamp(left, MARGIN, maxLeft);
    const y = clamp(top, MARGIN, maxTop);
    return {
      left: x,
      top: y,
      side,
      overlap: overlapOf({ left: x, top: y, ...card }, target),
    };
  };
  const onSide = (side: Side): Placement => {
    switch (side) {
      case 'bottom':
        return at(side, centerX, target.top + target.height + GAP);
      case 'top':
        return at(side, centerX, target.top - GAP - card.height);
      case 'end':
        return at(side, target.left + target.width + GAP, centerY);
      default:
        return at(side, target.left - GAP - card.width, centerY);
    }
  };

  const sides: Side[] = [preferred, OPPOSITE[preferred], ...ACROSS[preferred]];
  const candidates: Placement[] = [
    ...sides.map(onSide),
    at('dock', maxLeft, maxTop),
    at('dock', MARGIN, maxTop),
    at('dock', maxLeft, MARGIN),
    at('dock', MARGIN, MARGIN),
  ];
  // стороны, чьё место карточка заняла лишь после сдвига, перекрытием себя выдают
  return candidates.reduce((best, next) =>
    best.overlap === 0 || next.overlap >= best.overlap ? best : next,
  );
};
