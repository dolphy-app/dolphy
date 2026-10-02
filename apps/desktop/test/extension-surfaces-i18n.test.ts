import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';
import { ru as appRu } from '@/app/i18n/ru.ts';
import { en as appEn } from '@/app/i18n/en.ts';
import { messages as commandsMessages } from '@/features/extension-commands/i18n/index.ts';
import { messages as panelMessages } from '@/pages/extension-panel/i18n/index.ts';
import { messages as paletteMessages } from '@/widgets/command-palette/i18n/index.ts';
import { russianPluralRule } from '@/shared/i18n/plural.ts';

type Tree = { [key: string]: Tree | string };

const keysOf = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [`${prefix}${key}`]
      : keysOf(value, `${prefix}${key}.`),
  );

const SLICES: [string, { ru: Tree; en: Tree }][] = [
  ['features/extension-commands', commandsMessages as never],
  ['pages/extension-panel', panelMessages as never],
  ['widgets/command-palette', paletteMessages as never],
  ['app (nav)', { ru: appRu as never, en: appEn as never }],
];

describe('строки команд и панелей расширений', () => {
  it.each(SLICES)(
    '%s: ключи ru и en совпадают, значения не пустые',
    (_name, slice) => {
      expect(keysOf(slice.en).sort()).toEqual(keysOf(slice.ru).sort());
      for (const locale of ['ru', 'en'] as const) {
        for (const key of keysOf(slice[locale])) {
          const value = key
            .split('.')
            .reduce<Tree | string>(
              (node, part) =>
                typeof node === 'string' ? node : (node[part] ?? ''),
              slice[locale],
            );
          expect(value, `${locale}:${key}`).not.toBe('');
        }
      }
    },
  );

  it('пункты меню для панелей и палитры есть в обоих языках', () => {
    for (const nav of [appRu.nav, appEn.nav]) {
      expect(nav.extensions).toBeTruthy();
      expect(nav.commands).toBeTruthy();
    }
  });

  it('число найденных команд: четыре формы по-русски и три по-английски', () => {
    const { ru, en } = paletteMessages;
    expect(ru.commandPalette.count.split('|')).toHaveLength(4);
    expect(en.commandPalette.count.split('|')).toHaveLength(3);
  });

  it('формы выбираются по числу', () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'ru',
      messages: paletteMessages,
      pluralRules: { ru: russianPluralRule },
    });
    const count = (locale: 'ru' | 'en', n: number) => {
      i18n.global.locale.value = locale;
      return i18n.global.t('commandPalette.count', { n }, n);
    };
    expect(count('ru', 0)).toBe('Команд нет');
    expect(count('ru', 1)).toBe('Найдена 1 команда');
    expect(count('ru', 3)).toBe('Найдено 3 команды');
    expect(count('ru', 5)).toBe('Найдено 5 команд');
    expect(count('ru', 21)).toBe('Найдена 21 команда');
    expect(count('en', 0)).toBe('No commands');
    expect(count('en', 1)).toBe('1 command found');
    expect(count('en', 7)).toBe('7 commands found');
  });
});
