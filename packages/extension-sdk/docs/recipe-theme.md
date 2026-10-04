# Recipe: a theme

A theme is data: no TypeScript, no `main.mjs`. This recipe is the `theme`
template (`npx @dolphy-app/create-extension <dir> --id acme.hello --template theme`).
The files below are exactly what the generator writes for the id `acme.hello`.
See [quick-start.md](quick-start.md) for the commands.

## The manifest

File `extension.json` (theme):

```json
{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "acme.hello",
  "version": "0.1.0",
  "apiVersion": 1,
  "name": "Midnight",
  "description": "A dark color theme with an amber accent for the Dolphy app.",
  "author": "your-github-login",
  "tags": ["theme"],
  "contributes": {
    "themes": [
      {
        "id": "acme.hello",
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
```

- `contributes.themes[]` has an `id` (not `system`, `light` or `dark`), a
  `label` of 1–60 characters and `dark`, which says whether the theme is dark
  and so picks the base colors of the interface that `colors` then override.
- `colors` are `#rrggbb` or `#rrggbbaa` values for a fixed list of roles
  (`background`, `surface`, `primary`, the `on-…` colors for text drawn on them,
  `error`, `success`…). A key outside the list is rejected by `pnpm validate`.
  Pair every background with a readable text color.
- `variables` are optional tokens from a fixed list; here `border-opacity`, a
  number from 0 to 1.
- `build` of a project with no code writes only `extension.json` to `dist-ext`.

## The test

File `test/theme.test.ts` (theme):

```ts
import { describe, expect, it } from 'vitest';
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

describe('acme.hello: theme', () => {
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
```

A project with no code still has something worth testing. The test reads the
manifest and checks the WCAG contrast of each text color against its background
(at least 4.5:1) and that `dark` agrees with the colors. A failing contrast is a
real bug the learner would see, and the test also gives `vitest run` a file to
run. Keep the test when you change the colors.

## Try and ship

```sh
pnpm install
pnpm test
pnpm dev
```

With `DOLPHY_DEV_EXTENSIONS` pointing at `dist-ext` (see the quick start) the
theme appears as a tile in Settings → Appearance next to System, Light and
Dark; saving `extension.json` is picked up by the running app. Change the id, the label and the colors; change `tags` and
`description` too, the catalog shows them.
