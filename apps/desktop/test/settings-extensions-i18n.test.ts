import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';
import {
  EXTENSION_DIAGNOSTIC_CODES,
  LOG_LEVELS,
} from '@dolphy-app/engine-contract';
import { EXTENSION_TAGS } from '@dolphy-app/extension-api';
import { EVENT_MESSAGE_KEYS } from '@/pages/settings/lib/catalog.ts';
import { GROUPS } from '@/pages/settings/lib/tags.ts';
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
  'data.keys',
  'health.failures',
  'log.count',
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

  it('каждый код диагностики имеет текст на обоих языках', () => {
    for (const locale of ['ru', 'en'] as const) {
      for (const code of EXTENSION_DIAGNOSTIC_CODES) {
        expect(
          leaf(locale, `diagnostic.${code}`),
          `${locale} ${code}`,
        ).not.toBe('');
      }
    }
  });

  it('каждый уровень журнала имеет подпись на обоих языках', () => {
    for (const locale of ['ru', 'en'] as const) {
      for (const level of LOG_LEVELS) {
        expect(
          leaf(locale, `log.level.${level}`),
          `${locale} ${level}`,
        ).not.toBe('');
      }
    }
  });

  it('теги, группы и события имеют название на обоих языках', () => {
    for (const locale of ['ru', 'en'] as const) {
      for (const tag of EXTENSION_TAGS) {
        expect(leaf(locale, `tags.${tag}`), `${locale} ${tag}`).not.toBe('');
      }
      for (const group of GROUPS) {
        expect(leaf(locale, `groups.${group}`), group).not.toBe('');
      }
      for (const key of Object.values(EVENT_MESSAGE_KEYS)) {
        expect(leaf(locale, `events.${key}`), key).not.toBe('');
      }
    }
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
