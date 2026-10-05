/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import { russianPluralRule } from '@/shared/i18n';

type Tree = { [key: string]: Tree | string };

const leaves = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [`${prefix}${key}`]
      : leaves(value, `${prefix}${key}.`),
  );

// `ru.ts` и `en.ts` каждого слайса, оболочки и shared: имя экспорта совпадает с языком
const files = import.meta.glob('../src/**/i18n/**/{ru,en}.ts', {
  eager: true,
}) as Record<string, Record<string, Tree>>;

describe('message catalogs', () => {
  it('finds the catalogs of every slice', () => {
    expect(Object.keys(files).length).toBeGreaterThan(20);
  });

  it('every message compiles: a stray @, { or | would throw when the text is shown', () => {
    const broken: string[] = [];
    for (const [path, module] of Object.entries(files)) {
      const locale = path.endsWith('/ru.ts') ? 'ru' : 'en';
      const tree = module[locale];
      if (!tree) continue;
      const i18n = createI18n({
        legacy: false,
        locale,
        messages: { [locale]: tree },
        pluralRules: { ru: russianPluralRule },
        missingWarn: false,
        fallbackWarn: false,
      });
      for (const key of leaves(tree)) {
        try {
          i18n.global.t(key, { n: 2, count: 2 }, 2);
        } catch (error) {
          broken.push(`${path} ${key}: ${String(error).split('\n')[0]}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
