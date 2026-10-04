import { INITIAL_VERSION } from './common.ts';
import type { TemplateModule } from './common.ts';

const manifestJson = (id: string): string => `{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "${id}",
  "version": "${INITIAL_VERSION}",
  "apiVersion": 1,
  "name": "Midnight",
  "description": "A dark color theme with an amber accent for the Dolphy app.",
  "author": "your-github-login",
  "tags": ["theme"],
  "contributes": {
    "themes": [
      {
        "id": "${id}",
        "label": "Midnight",
        "dark": true,
        "colors": {
          "background": "#101820",
          "surface": "#1B2733",
          "on-background": "#E6EDF3",
          "on-surface": "#E6EDF3",
          "primary": "#FFB000",
          "on-primary": "#101820"
        },
        "variables": { "border-opacity": 0.2 }
      }
    ]
  }
}
`;

const themeTestTs = (
  id: string,
): string => `import { describe, expect, it } from 'vitest';
import manifest from '../extension.json';

const [theme] = manifest.contributes.themes;
const colors: Record<string, string> = theme.colors;

// WCAG relative luminance of a #rrggbb color
const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (foreground: string, background: string): number => {
  const [light, dark] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  ) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

describe('${id}: theme', () => {
  it.each([
    ['on-surface', 'surface'],
    ['on-background', 'background'],
    ['on-primary', 'primary'],
  ])('%s on %s has a contrast of at least 4.5:1', (foreground, background) => {
    expect(contrast(colors[foreground] as string, colors[background] as string))
      .toBeGreaterThanOrEqual(4.5);
  });

  it('a dark theme has a dark background and a light text', () => {
    const background = luminance(colors['background'] as string);
    const text = luminance(colors['on-background'] as string);
    expect(theme.dark ? background < text : background > text).toBe(true);
  });
});
`;

export const theme: TemplateModule = {
  summary: [
    'A Dolphy extension: a color theme ("Midnight"). A theme is data only, so',
    'there is no code to build; the test checks the text contrast.',
  ],
  layout: [
    '- `extension.json` — the manifest: the theme `colors` (allowed keys are',
    '  listed in the Dolphy extension guide) and `variables`;',
    '- `test/theme.test.ts` — checks the contrast of the text colors',
    '  (`vitest`); there is no `src/`, a theme has no code.',
  ],
  files: (id) => ({
    'extension.json': manifestJson(id),
    'test/theme.test.ts': themeTestTs(id),
  }),
};
