import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { EXTENSION_ICONS } from '@dolphy-app/extension-api';
import {
  EXTENSION_ICON_GLYPHS,
  extensionIconOf,
} from '@/shared/config/extension-icons.ts';

const stylesheet = readFileSync(
  createRequire(import.meta.url).resolve(
    '@mdi/font/css/materialdesignicons.css',
  ),
  'utf8',
);

describe('значки расширений', () => {
  it('список закрыт: 24 имени, каждому соответствует свой символ окна, а лишних символов нет', () => {
    expect(EXTENSION_ICONS).toHaveLength(24);
    expect(Object.keys(EXTENSION_ICON_GLYPHS).sort()).toEqual(
      [...EXTENSION_ICONS].sort(),
    );
    const glyphs = Object.values(EXTENSION_ICON_GLYPHS);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it.each(Object.entries(EXTENSION_ICON_GLYPHS))(
    '%s рисуется символом %s, который есть в шрифте иконок',
    (_name, glyph) => {
      expect(stylesheet).toContain(`.${glyph}::before`);
    },
  );

  it('неизвестное имя (в том числе «наследственные» ключи объекта) даёт символ по умолчанию', () => {
    const fallback = EXTENSION_ICON_GLYPHS.puzzle;
    for (const name of ['', 'rocket', 'mdi-fire', 'constructor', '__proto__']) {
      expect(extensionIconOf(name)).toBe(fallback);
    }
    expect(extensionIconOf('fire')).toBe(EXTENSION_ICON_GLYPHS.fire);
  });
});
