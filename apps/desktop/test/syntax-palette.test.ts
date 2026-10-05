import { describe, expect, it } from 'vitest';
import { DARK_THEME, LIGHT_THEME } from '@/shared/lib/builtin-themes.ts';
import {
  MIN_CONTRAST,
  SYNTAX_SOURCES,
  contrast,
  parseHex,
  syntaxCssVars,
  syntaxPalette,
  toHex,
  withContrast,
} from '@/shared/lib/syntax-palette.ts';
import type { RGB } from '@/shared/lib/syntax-palette.ts';

const rgb = (hex: string): RGB => parseHex(hex) as RGB;

const worstContrast = (
  colors: Record<string, unknown>,
  dark: boolean,
): number => {
  const palette = syntaxPalette(colors, dark);
  const background = rgb(String(colors['surface-variant']));
  return Math.min(
    ...Object.values(palette).map((hex) => contrast(rgb(hex), background)),
  );
};

describe('parseHex', () => {
  it('reads #rgb, #rrggbb and #rrggbbaa (alpha is dropped)', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('#4F46E5')).toEqual({ r: 79, g: 70, b: 229 });
    expect(parseHex('#4F46E5cc')).toEqual({ r: 79, g: 70, b: 229 });
  });

  it.each(['red', '#12', '#12345', 'rgb(0,0,0)', '', null, 7])(
    'rejects %j',
    (value) => {
      expect(parseHex(value)).toBeNull();
    },
  );
});

describe('contrast', () => {
  it('is 21 for black on white, 1 for equal colors', () => {
    expect(contrast(rgb('#000000'), rgb('#ffffff'))).toBeCloseTo(21, 5);
    expect(contrast(rgb('#336699'), rgb('#336699'))).toBeCloseTo(1, 5);
  });
});

describe('withContrast', () => {
  const white = rgb('#ffffff');
  const black = rgb('#000000');

  it('keeps a color that is already readable', () => {
    const color = rgb('#1d4ed8');
    expect(withContrast(color, white, black)).toEqual(color);
  });

  it('darkens as little as needed toward the text color', () => {
    const color = rgb('#d97706');
    const fixed = withContrast(color, white, black);
    expect(contrast(fixed, white)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    // не дальше нужного: заметно светлее чистого текста
    expect(contrast(fixed, white)).toBeLessThan(MIN_CONTRAST + 0.3);
  });

  it('keeps hue and saturation: only lightness changes', () => {
    const hue = ({ r, g, b }: RGB): number => {
      const max = Math.max(r, g, b);
      const delta = max - Math.min(r, g, b);
      if (max === r) return (((g - b) / delta + 6) % 6) * 60;
      if (max === g) return ((b - r) / delta + 2) * 60;
      return ((r - g) / delta + 4) * 60;
    };
    for (const hex of ['#7cc6d9', '#9bc53d', '#f2b134', '#c9b458']) {
      const color = rgb(hex);
      const fixed = withContrast(color, rgb('#f3e8cc'), rgb('#3b2f1e'));
      expect(Math.abs(hue(fixed) - hue(color)), hex).toBeLessThan(4);
    }
  });

  it('lightens on a dark background', () => {
    const fixed = withContrast(rgb('#334455'), rgb('#101820'), rgb('#eeeeee'));
    expect(contrast(fixed, rgb('#101820'))).toBeGreaterThanOrEqual(
      MIN_CONTRAST,
    );
    expect(fixed.r + fixed.g + fixed.b).toBeGreaterThan(0x33 + 0x44 + 0x55);
  });

  it('falls back to the text color when even it is too weak', () => {
    const gray = rgb('#888888');
    expect(withContrast(rgb('#aaaaaa'), white, gray)).toEqual(gray);
  });
});

describe('syntaxPalette', () => {
  it('reads AA contrast on the code background in both built-in themes', () => {
    expect(
      worstContrast(LIGHT_THEME.colors as Record<string, unknown>, false),
    ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(
      worstContrast(DARK_THEME.colors as Record<string, unknown>, true),
    ).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it('follows the accents of the theme: another primary gives another keyword color', () => {
    const base = DARK_THEME.colors as Record<string, unknown>;
    const a = syntaxPalette({ ...base, primary: '#ff0066' }, true);
    const b = syntaxPalette({ ...base, primary: '#00aaff' }, true);
    expect(a.keyword).not.toBe(b.keyword);
    expect(a.string).toBe(b.string);
  });

  it('stays readable on a hostile extension theme (pale accents on a pale background)', () => {
    const colors = {
      'surface-variant': '#fff7d6',
      'on-surface': '#2b2b2b',
      primary: '#ffee99',
      success: '#eeff99',
      warning: '#ffe699',
      info: '#ddff99',
      secondary: '#fff199',
      'on-surface-variant': '#f5e8b0',
    };
    expect(worstContrast(colors, false)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it('keeps accents apart on a pale theme instead of merging them into one brown', () => {
    const palette = syntaxPalette(
      {
        'surface-variant': '#f3e8cc',
        'on-surface': '#3b2f1e',
        primary: '#e0a000',
        success: '#9bc53d',
        warning: '#f2b134',
        info: '#7cc6d9',
        secondary: '#c9b458',
        'on-surface-variant': '#8a7a5c',
      },
      false,
    );
    // голубой и зелёный остаются голубым и зелёным, а не серо-коричневым
    const { property, string, keyword } = palette;
    expect(rgb(property).b).toBeGreaterThan(rgb(property).r + 40);
    expect(rgb(string).g).toBeGreaterThan(rgb(string).b + 40);
    expect(new Set([property, string, keyword]).size).toBe(3);
  });

  it('uses the text color for an accent the theme does not define', () => {
    const palette = syntaxPalette(
      { 'surface-variant': '#101010', 'on-surface': '#eeeeee' },
      true,
    );
    expect(Object.keys(palette).sort()).toEqual(
      Object.keys(SYNTAX_SOURCES).sort(),
    );
    for (const color of Object.values(palette)) {
      expect(color).toBe(toHex(rgb('#eeeeee')));
    }
  });

  it('survives empty or broken theme colors', () => {
    for (const dark of [false, true]) {
      const palette = syntaxPalette({ 'surface-variant': 'nonsense' }, dark);
      for (const color of Object.values(palette)) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});

describe('syntaxCssVars', () => {
  it('names the variables --sh-<token>', () => {
    const vars = syntaxCssVars(
      syntaxPalette(LIGHT_THEME.colors as Record<string, unknown>, false),
    );
    expect(Object.keys(vars).sort()).toEqual(
      Object.keys(SYNTAX_SOURCES)
        .map((token) => `--sh-${token}`)
        .sort(),
    );
  });
});

describe('built-in themes: text on filled accents', () => {
  const pairs = [
    ['primary', 'on-primary'],
    ['secondary', 'on-secondary'],
  ] as const;

  it.each([
    ['light', LIGHT_THEME],
    ['dark', DARK_THEME],
  ])(
    '%s: text on primary and secondary fills is at least AA',
    (_name, theme) => {
      const colors = theme.colors as Record<string, unknown>;
      for (const [fill, text] of pairs) {
        expect(
          contrast(rgb(String(colors[fill])), rgb(String(colors[text]))),
          `${text} on ${fill}`,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    },
  );
});
