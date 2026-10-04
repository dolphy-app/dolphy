/**
 * Цвета подсветки кода из цветов темы. Темы расширений задают только свои
 * `THEME_COLOR_KEYS`, поэтому отдельных цветов синтаксиса нет: палитра
 * выводится из акцентов темы, а затем у каждого цвета меняется только
 * светлота (тон и насыщенность сохраняются) ровно настолько, чтобы контраст с
 * фоном блока кода был не ниже AA (4.5:1). Подмешивать цвет текста нельзя:
 * бледные акценты сливались бы в один серо-коричневый. Так подсветка
 * подстраивается под любую тему, в том числе стороннюю.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Что окрашивает каждый цвет подсветки (класс `sh__token--<тип>`). */
export const SYNTAX_SOURCES = {
  keyword: 'primary',
  string: 'success',
  class: 'warning',
  property: 'info',
  entity: 'secondary',
  comment: 'on-surface-variant',
} as const;

export type SyntaxToken = keyof typeof SYNTAX_SOURCES;
export type SyntaxPalette = Record<SyntaxToken, string>;

export const MIN_CONTRAST = 4.5;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** `#rgb`, `#rrggbb` или `#rrggbbaa` (прозрачность отбрасывается); иначе `null`. */
export const parseHex = (value: unknown): RGB | null => {
  if (typeof value !== 'string') return null;
  const match = HEX.exec(value.trim());
  const digits = match?.[1];
  if (digits === undefined) return null;
  const full =
    digits.length === 3
      ? [...digits].map((digit) => digit + digit).join('')
      : digits.slice(0, 6);
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
};

const channel = (value: number): string =>
  Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, '0');

export const toHex = ({ r, g, b }: RGB): string =>
  `#${channel(r)}${channel(g)}${channel(b)}`;

const linear = (value: number): number => {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};

const luminance = ({ r, g, b }: RGB): number =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** Контраст WCAG двух цветов, от 1 до 21. */
export const contrast = (a: RGB, b: RGB): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

interface HSL {
  /** Градусы, 0…360. */
  h: number;
  s: number;
  l: number;
}

const toHsl = ({ r, g, b }: RGB): HSL => {
  const [red, green, blue] = [r / 255, g / 255, b / 255] as const;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === red) h = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) h = (blue - red) / delta + 2;
  else h = (red - green) / delta + 4;
  return { h: h * 60, s, l };
};

/** HSL → RGB, округлённый до целых каналов, как в `#rrggbb`. */
const fromHsl = ({ h, s, l }: HSL): RGB => {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - chroma / 2;
  const sector = Math.floor(h / 60) % 6;
  const [r, g, b] = (
    [
      [chroma, x, 0],
      [x, chroma, 0],
      [0, chroma, x],
      [0, x, chroma],
      [x, 0, chroma],
      [chroma, 0, x],
    ] as const
  )[sector] as readonly [number, number, number];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
};

/**
 * Цвет `color` или ближайший к нему по светлоте (тон и насыщенность те же), у
 * которого контраст с `background` не ниже `minimum`. Светлота уходит туда же,
 * куда у `toward` (цвета текста): темнее на светлом фоне, светлее на тёмном.
 * Если и `toward` не дотягивает (плохая тема), возвращается он: хуже текста
 * самой темы подсветка быть не может. Проверяется округлённый цвет, потому что
 * в CSS уйдёт именно он.
 */
export const withContrast = (
  color: RGB,
  background: RGB,
  toward: RGB,
  minimum = MIN_CONTRAST,
): RGB => {
  if (contrast(color, background) >= minimum) return color;
  if (contrast(toward, background) < minimum) return toward;
  const origin = toHsl(color);
  const end = toHsl(toward).l < origin.l ? 0 : 1;
  const at = (share: number): RGB =>
    fromHsl({ ...origin, l: origin.l + (end - origin.l) * share });
  let low = 0;
  let high = 1;
  for (let step = 0; step < 12; step += 1) {
    const middle = (low + high) / 2;
    if (contrast(at(middle), background) >= minimum) high = middle;
    else low = middle;
  }
  const found = at(high);
  return contrast(found, background) >= minimum ? found : toward;
};

const FALLBACK = { light: '#1f2937', dark: '#e5e7eb' } as const;

/**
 * Палитра подсветки для цветов темы Vuetify (`theme.current.colors`).
 * Фон блока кода — `surface-variant`, текст — `on-surface`; недостающие или
 * неверные цвета заменяются чёрным на светлой теме и светлым на тёмной.
 */
export const syntaxPalette = (
  colors: Readonly<Record<string, unknown>>,
  dark: boolean,
): SyntaxPalette => {
  const fallback = parseHex(dark ? FALLBACK.dark : FALLBACK.light) as RGB;
  const background =
    parseHex(colors['surface-variant']) ??
    parseHex(colors['surface']) ??
    parseHex(dark ? '#000000' : '#ffffff') ??
    fallback;
  const text = parseHex(colors['on-surface']) ?? fallback;
  const entries = Object.entries(SYNTAX_SOURCES).map(([token, source]) => {
    const accent = parseHex(colors[source]) ?? text;
    return [token, toHex(withContrast(accent, background, text))] as const;
  });
  return Object.fromEntries(entries) as SyntaxPalette;
};

/** Значения для `style` корня документа: `--sh-<тип>`. */
export const syntaxCssVars = (palette: SyntaxPalette): Record<string, string> =>
  Object.fromEntries(
    Object.entries(palette).map(([token, color]) => [`--sh-${token}`, color]),
  );
