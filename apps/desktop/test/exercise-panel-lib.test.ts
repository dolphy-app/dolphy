import { describe, expect, it } from 'vitest';
import { stripLeadingTitle } from '@/widgets/exercise-panel/lib/material.ts';
import {
  HEADLINE_MAX_CHARS,
  splitPrompt,
} from '@/widgets/exercise-panel/lib/prompt.ts';

describe('splitPrompt', () => {
  it('a short first paragraph is the headline, code stays in the rest', () => {
    expect(splitPrompt('Что выведет код?\n\n```js\nconsole.log(1);\n```')).toEqual({
      lead: 'Что выведет код?',
      rest: '```js\nconsole.log(1);\n```',
      headline: true,
    });
  });

  it('a long first paragraph is body text, not a headline', () => {
    const long = `${'Напишите функцию, которая '.repeat(8)}.`;
    expect(long.length).toBeGreaterThan(HEADLINE_MAX_CHARS);
    expect(splitPrompt(`${long}\n\nПример.`)).toMatchObject({
      lead: long,
      rest: 'Пример.',
      headline: false,
    });
  });

  it('a multi-line first block is not a headline', () => {
    expect(splitPrompt('строка один\nстрока два\n\nдальше').headline).toBe(
      false,
    );
  });

  it.each(['```js\nx;\n```', '- пункт\n- пункт', '# Заголовок\n\nтекст'])(
    'a prompt that starts with a block (%j) has no lead',
    (source) => {
      expect(splitPrompt(source)).toEqual({
        lead: '',
        rest: source,
        headline: false,
      });
    },
  );

  it('a one-line prompt has an empty rest', () => {
    expect(splitPrompt('  Чем const отличается от let?\n')).toEqual({
      lead: 'Чем const отличается от let?',
      rest: '',
      headline: true,
    });
  });
});

describe('stripLeadingTitle', () => {
  it('drops only the first level-one heading at the very start', () => {
    expect(stripLeadingTitle('# Замыкания\n\nТекст\n\n# Ещё\n')).toBe(
      'Текст\n\n# Ещё\n',
    );
  });

  it('keeps material that starts with something else', () => {
    expect(stripLeadingTitle('Вступление\n\n# Не в начале')).toBe(
      'Вступление\n\n# Не в начале',
    );
    expect(stripLeadingTitle('## Раздел\n\nТекст')).toBe('## Раздел\n\nТекст');
  });

  it('a title-only material becomes empty', () => {
    expect(stripLeadingTitle('# Только заголовок')).toBe('');
  });
});
