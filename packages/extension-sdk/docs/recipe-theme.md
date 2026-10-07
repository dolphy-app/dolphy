# Recipe: a theme

A theme is data that the client part registers: no server part, no `main.mjs`.
This recipe is the `theme` template
(`npx @dolphy-app/create-extension <dir> --id acme.hello --template theme`).
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
  "tags": ["theme"]
}
```

The manifest holds the identity only; the colors are in the code.

## The code

File `src/theme.ts` (theme):

```ts
import type { ThemeRegistration } from '@dolphy-app/extension-sdk';

// the allowed color and variable keys are `THEME_COLOR_KEYS` and
// `THEME_VARIABLE_KEYS` of '@dolphy-app/extension-sdk'
export const midnight: ThemeRegistration = {
  id: 'acme.hello',
  label: 'Midnight',
  dark: true,
  colors: {
    background: '#101820',
    surface: '#1B2733',
    'on-background': '#E6EDF3',
    'on-surface': '#E6EDF3',
    primary: '#FFB000',
    'on-primary': '#101820',
  },
  variables: { 'border-opacity': 0.2 },
};
```

File `src/index.ts` (theme):

```ts
import { defineClient } from '@dolphy-app/extension-sdk';
import { midnight } from './theme.ts';

// runs in the app window: a theme is data, there is no server part
export const client = defineClient((c) => {
  c.addTheme(midnight);
});
```

- `client.addTheme(registration)` adds a tile to Settings → Appearance next to
  System, Light and Dark. `id` is the extension id or starts with it and a dot,
  and is not `system`, `light` or `dark`; `label` is a `LocalizedText` of 1–60
  characters; `dark` says whether the theme is dark, which picks the base colors
  of the interface that `colors` then override.
- `colors` are `#rrggbb` or `#rrggbbaa` values for a fixed list of roles
  (`background`, `surface`, `primary`, the `on-…` colors for text drawn on them,
  `error`, `success`…). The list is `THEME_COLOR_KEYS` of the SDK; a key outside
  it fails the registration. Pair every background with a readable text color.
- `variables` are optional tokens from `THEME_VARIABLE_KEYS`; here
  `border-opacity`, a number from 0 to 1.
- The build of this project writes `extension.json` and `client.mjs` to
  `dist-ext`: there is no `server` export, so no `main.mjs`.

## The test

File `test/theme.test.ts` (theme):

```ts
import { createTestClient } from '@dolphy-app/extension-sdk/testing';
import { describe, expect, it } from 'vitest';
import { client } from '../src/index.ts';
import { midnight } from '../src/theme.ts';

const colors = midnight.colors;

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
  it('the client adds the theme', async () => {
    const running = await createTestClient(client, { extensionId: 'acme.hello' });
    expect(running.themes).toEqual([midnight]);
    await running.dispose();
  });

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
    expect(midnight.dark ? background < text : background > text).toBe(true);
  });
});
```

`createTestClient(client, { extensionId })` runs `client` on a context that
records what it adds, so the test sees the theme in `running.themes`. The rest
checks the WCAG contrast of each text color against its background (at least
4.5:1) and that `dark` agrees with the colors. A failing contrast is a real bug
the learner would see. Keep the test when you change the colors.

## Try and ship

```sh
pnpm install
pnpm test
pnpm dev
```

With `DOLPHY_DEV_EXTENSIONS` pointing at `dist-ext` (see the quick start) the
theme appears as a tile in Settings → Appearance; saving a file is picked up by
the running app. Change the id, the label and the colors; change `tags` and
`description` too, the catalog shows them.
