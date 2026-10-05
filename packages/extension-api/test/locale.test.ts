import { describe, expect, it } from 'vitest';
import {
  LOCALE_LIMITS,
  localizableStrings,
  localizeManifest,
  parseLocaleTable,
  parseLocaleText,
  placeholderKey,
  placeholderKeys,
  resolveText,
} from '../src/index.ts';

const tables = {
  ru: { greeting: 'Привет', onlyRu: 'Только по-русски' },
  en: { greeting: 'Hello', onlyEn: 'Only English' },
};

describe('resolveText', () => {
  it('returns a plain string as is, even if it contains a key', () => {
    expect(resolveText('Hello', tables, 'ru')).toBe('Hello');
    expect(resolveText('say %greeting% now', tables, 'ru')).toBe(
      'say %greeting% now',
    );
    expect(resolveText('%greeting', tables, 'ru')).toBe('%greeting');
  });

  it('takes the text of the current language first', () => {
    expect(resolveText('%greeting%', tables, 'ru')).toBe('Привет');
    expect(resolveText('%greeting%', tables, 'en')).toBe('Hello');
  });

  it('falls back to en, then to the placeholder', () => {
    expect(resolveText('%onlyEn%', tables, 'ru')).toBe('Only English');
    expect(resolveText('%onlyRu%', tables, 'ru')).toBe('Только по-русски');
    expect(resolveText('%onlyRu%', tables, 'en')).toBe('%onlyRu%');
    expect(resolveText('%nowhere%', tables, 'ru')).toBe('%nowhere%');
  });

  it('uses en for a language without a table or an unknown language', () => {
    expect(resolveText('%greeting%', { en: tables.en }, 'ru')).toBe('Hello');
    expect(resolveText('%greeting%', tables, 'de')).toBe('Hello');
  });

  it('leaves the placeholder without tables', () => {
    expect(resolveText('%greeting%', undefined, 'en')).toBe('%greeting%');
    expect(resolveText('%greeting%', {}, 'en')).toBe('%greeting%');
  });

  it('does not read inherited properties as keys', () => {
    expect(resolveText('%constructor%', tables, 'en')).toBe('%constructor%');
    expect(resolveText('%toString%', tables, 'en')).toBe('%toString%');
  });

  it('accepts an empty translation as a translation', () => {
    expect(resolveText('%x%', { ru: { x: '' }, en: { x: 'X' } }, 'ru')).toBe(
      '',
    );
  });
});

describe('placeholderKey', () => {
  it.each(['%a%', '%a.b-c_D9%', `%${'k'.repeat(64)}%`])('reads %s', (value) => {
    expect(placeholderKey(value)).not.toBeNull();
  });

  it.each(['', '%%', 'a%b%', '%a b%', '%a%%', ' %a%', `%${'k'.repeat(65)}%`])(
    'does not read %j',
    (value) => {
      expect(placeholderKey(value)).toBeNull();
    },
  );
});

describe('parseLocaleTable', () => {
  it('accepts a flat object of strings', () => {
    expect(parseLocaleTable({ a: 'A', 'b.c-d_1': 'B' })).toEqual({
      ok: true,
      table: { a: 'A', 'b.c-d_1': 'B' },
    });
  });

  it.each([
    ['an array', ['a']],
    ['null', null],
    ['a string', 'a'],
  ])('rejects %s', (_name, value) => {
    expect(parseLocaleTable(value).ok).toBe(false);
  });

  it('reports a nested value, a bad key and a long value', () => {
    const result = parseLocaleTable({
      ok: 'fine',
      nested: { a: 'b' },
      'bad key': 'x',
      long: 'x'.repeat(LOCALE_LIMITS.valueLength + 1),
    });
    expect(result).toEqual({
      ok: false,
      issues: [
        "'nested' must be a string",
        "key 'bad key' must match /^[A-Za-z0-9_.-]{1,64}$/",
        `'long' is longer than ${LOCALE_LIMITS.valueLength} characters`,
      ],
    });
  });

  it('rejects more keys than the limit and accepts exactly the limit', () => {
    const make = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => [`k${i}`, 'v']),
      );
    expect(parseLocaleTable(make(LOCALE_LIMITS.keys)).ok).toBe(true);
    expect(parseLocaleTable(make(LOCALE_LIMITS.keys + 1)).ok).toBe(false);
  });
});

describe('parseLocaleText', () => {
  it('reports invalid JSON', () => {
    const result = parseLocaleText('{ "a": ');
    expect(result.ok).toBe(false);
  });

  it('measures the file in bytes, not characters', () => {
    // 'я' is two bytes in UTF-8: the text is under the limit in characters only
    const value = 'я'.repeat(LOCALE_LIMITS.valueLength);
    const json = JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 70 }, (_, i) => [`k${i}`, value]),
      ),
    );
    expect(json.length).toBeLessThan(LOCALE_LIMITS.fileBytes);
    expect(parseLocaleText(json)).toMatchObject({ ok: false });
  });

  it('parses a valid file', () => {
    expect(parseLocaleText('{"a":"A"}')).toEqual({
      ok: true,
      table: { a: 'A' },
    });
  });
});

const manifest = {
  id: 'acme.pack',
  name: '%name%',
  description: 'Plain description',
  contributes: {
    commands: [
      { id: 'acme.pack.go', title: '%cmd.go%', category: '%cat%' },
      { id: 'acme.pack.stay', title: 'Plain' },
    ],
    settings: [
      {
        id: 'acme.pack.mode',
        type: 'enum',
        label: '%mode%',
        group: '%group%',
        options: [
          { value: 'a', label: '%opt.a%' },
          { value: 'b', label: 'B' },
        ],
      },
    ],
    exerciseTypes: [{ id: 'acme.pack.quiz', title: '%quiz%' }],
    // not localizable: ids and values stay as written
    themes: [{ id: '%theme-id%', label: '%theme%' }],
  },
};

describe('localizableStrings', () => {
  it('lists every localizable field with its path, and nothing else', () => {
    expect(localizableStrings(manifest).map(({ path }) => path)).toEqual([
      'name',
      'description',
      'contributes.exerciseTypes.0.title',
      'contributes.themes.0.label',
      'contributes.settings.0.label',
      'contributes.settings.0.group',
      'contributes.settings.0.options.0.label',
      'contributes.settings.0.options.1.label',
      'contributes.commands.0.title',
      'contributes.commands.0.category',
      'contributes.commands.1.title',
    ]);
  });

  it('tolerates a raw manifest of any shape', () => {
    expect(localizableStrings(null)).toEqual([]);
    expect(localizableStrings({ contributes: 3, name: 4 })).toEqual([]);
    expect(
      localizableStrings({ contributes: { commands: [null, 1] } }),
    ).toEqual([]);
  });
});

describe('placeholderKeys', () => {
  it('returns distinct keys in manifest order', () => {
    expect(
      placeholderKeys({ name: '%a%', description: '%a%', contributes: {} }),
    ).toEqual(['a']);
    expect(placeholderKeys(manifest)).toEqual([
      'name',
      'quiz',
      'theme',
      'mode',
      'group',
      'opt.a',
      'cmd.go',
      'cat',
    ]);
  });
});

describe('localizeManifest', () => {
  const full = {
    ru: { name: 'Имя', 'opt.a': 'Вариант А' },
    en: {
      name: 'Name',
      'cmd.go': 'Go',
      cat: 'Category',
      mode: 'Mode',
      group: 'Group',
      'opt.a': 'Option A',
      quiz: 'Quiz',
      theme: 'Theme',
    },
  };

  it('replaces placeholders in the localizable fields only', () => {
    const result = localizeManifest(manifest, full, 'en');
    expect(result.name).toBe('Name');
    expect(result.description).toBe('Plain description');
    expect(result.contributes.commands[0]).toEqual({
      id: 'acme.pack.go',
      title: 'Go',
      category: 'Category',
    });
    expect(result.contributes.settings[0]?.options[0]?.label).toBe('Option A');
    // an id is never localized
    expect(result.contributes.themes[0]?.id).toBe('%theme-id%');
  });

  it('uses the language, then en, and leaves the source untouched', () => {
    const result = localizeManifest(manifest, full, 'ru');
    expect(result.name).toBe('Имя');
    expect(result.contributes.commands[0]?.title).toBe('Go');
    expect(manifest.name).toBe('%name%');
  });

  it('keeps a placeholder without a text', () => {
    expect(localizeManifest(manifest, {}, 'en').name).toBe('%name%');
  });
});
