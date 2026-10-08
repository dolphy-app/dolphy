import { describe, expect, it } from 'vitest';
import { localizedTexts, resolveLocalizedText } from '../src/index.ts';

describe('resolveLocalizedText', () => {
  it('shows a plain string as is in every language', () => {
    expect(resolveLocalizedText('Daily plan', 'ru')).toBe('Daily plan');
    expect(resolveLocalizedText('Daily plan', 'en')).toBe('Daily plan');
  });

  it('takes the text of the language when there is one', () => {
    expect(resolveLocalizedText({ en: 'Plan', ru: 'План' }, 'ru')).toBe('План');
    expect(resolveLocalizedText({ en: 'Plan', ru: 'План' }, 'en')).toBe('Plan');
  });

  it('falls back to en for a missing or unknown language', () => {
    expect(resolveLocalizedText({ en: 'Plan' }, 'ru')).toBe('Plan');
    expect(resolveLocalizedText({ en: 'Plan', ru: 'План' }, 'de')).toBe('Plan');
  });
});

describe('localizedTexts', () => {
  it('lists the string, or every language the text has', () => {
    expect(localizedTexts('Plan')).toEqual(['Plan']);
    expect(localizedTexts({ en: 'Plan' })).toEqual(['Plan']);
    expect(localizedTexts({ en: 'Plan', ru: 'План' })).toEqual([
      'Plan',
      'План',
    ]);
  });
});
