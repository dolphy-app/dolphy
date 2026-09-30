import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';
import { messages as settingsMessages } from '@/pages/settings/i18n/index.ts';
import { russianPluralRule } from '@/shared/i18n';

type Tree = { [key: string]: Tree | string };

const keysOf = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [`${prefix}${key}`]
      : keysOf(value, `${prefix}${key}.`),
  );

const extensions = (locale: 'ru' | 'en') =>
  settingsMessages[locale].settings.extensions as unknown as Tree;

const PLURAL_KEYS = [
  'count',
  'catalog.found',
  'install.titleUpdateAll',
] as const;

const leaf = (locale: 'ru' | 'en', path: string): string =>
  path
    .split('.')
    .reduce<Tree | string>(
      (node, key) => (typeof node === 'string' ? node : (node[key] ?? '')),
      extensions(locale),
    ) as string;

describe('строки «Расширения»', () => {
  it('ключи ru и en совпадают', () => {
    expect(keysOf(extensions('en')).sort()).toEqual(
      keysOf(extensions('ru')).sort(),
    );
  });

  it('у числительных четыре формы по-русски и три по-английски', () => {
    for (const key of PLURAL_KEYS) {
      expect(leaf('ru', key).split('|'), key).toHaveLength(4);
      expect(leaf('en', key).split('|'), key).toHaveLength(3);
    }
  });

  it('формы выбираются по числу', () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'ru',
      messages: settingsMessages,
      pluralRules: { ru: russianPluralRule },
    });
    const found = (locale: 'ru' | 'en', n: number) => {
      i18n.global.locale.value = locale;
      return i18n.global.t('settings.extensions.catalog.found', { n }, n);
    };
    expect(found('ru', 0)).toBe('ничего не найдено');
    expect(found('ru', 1)).toBe('Найдено: 1 расширение');
    expect(found('ru', 3)).toBe('Найдено: 3 расширения');
    expect(found('ru', 5)).toBe('Найдено: 5 расширений');
    expect(found('ru', 21)).toBe('Найдено: 21 расширение');
    expect(found('en', 0)).toBe('nothing found');
    expect(found('en', 1)).toBe('Found: 1 extension');
    expect(found('en', 4)).toBe('Found: 4 extensions');
  });
});
