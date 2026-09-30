import { describe, expect, it } from 'vitest';
import { resolveLocale } from '@/shared/i18n/locale.ts';
import { russianPluralRule } from '@/shared/i18n/plural.ts';

describe('resolveLocale', () => {
  it('явный язык из настроек важнее системного', () => {
    expect(resolveLocale('ru', 'en-US')).toBe('ru');
    expect(resolveLocale('en', 'ru-RU')).toBe('en');
  });

  it('system берёт основной подтег языка системы', () => {
    expect(resolveLocale('system', 'ru-RU')).toBe('ru');
    expect(resolveLocale('system', 'RU')).toBe('ru');
    expect(resolveLocale('system', 'en-GB')).toBe('en');
  });

  it('неподдерживаемый язык системы — английский', () => {
    expect(resolveLocale('system', 'de-DE')).toBe('en');
    expect(resolveLocale('system', '')).toBe('en');
  });
});

describe('russianPluralRule (сообщение из четырёх форм)', () => {
  const FORMS = 4;
  const formOf = (count: number) => russianPluralRule(count, FORMS);
  const ZERO = 0;
  const ONE = 1;
  const FEW = 2;
  const MANY = 3;

  it('ноль, один, несколько, много', () => {
    expect(formOf(0)).toBe(ZERO);
    expect(formOf(1)).toBe(ONE);
    expect(formOf(2)).toBe(FEW);
    expect(formOf(4)).toBe(FEW);
    expect(formOf(5)).toBe(MANY);
    expect(formOf(20)).toBe(MANY);
  });

  it('11–19 всегда «много», хвост 1 и 2–4 после двадцати — как у малых чисел', () => {
    for (const count of [11, 12, 14, 19, 111, 112]) {
      expect(formOf(count)).toBe(MANY);
    }
    expect(formOf(21)).toBe(ONE);
    expect(formOf(101)).toBe(ONE);
    expect(formOf(22)).toBe(FEW);
    expect(formOf(104)).toBe(FEW);
  });

  it('без формы «ноль» (три варианта) «много» заменяет на «несколько»', () => {
    expect(russianPluralRule(5, 3)).toBe(FEW);
  });
});
