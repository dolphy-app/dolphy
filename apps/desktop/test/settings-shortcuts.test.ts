import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import {
  buildShortcutRows,
  defaultWhenOf,
  filterShortcutRows,
  groupShortcutRows,
  useShortcuts,
} from '@/pages/settings/model/shortcuts.ts';
import {
  appCommand,
  extensionCommand,
  setupKeybindings,
} from './support/keybindings-fakes.ts';

const NOT_TYPING = '!inputFocus && !modalOpen';
const word = (id: string) => id;

const setup = () => {
  const language = ref<'ru' | 'en'>('ru');
  const ctx = setupKeybindings({
    commands: [
      appCommand('app:palette.open', {
        title: () => (language.value === 'ru' ? 'Открыть палитру' : 'Open'),
        category: () => (language.value === 'ru' ? 'Приложение' : 'App'),
        keybindings: [{ key: 'Mod+K' }],
        listed: false,
      }),
      appCommand('app:go:courses', {
        title: () => (language.value === 'ru' ? 'Курсы' : 'Courses'),
        category: () => (language.value === 'ru' ? 'Переход' : 'Go'),
        keybindings: [{ key: 'Mod+2', when: NOT_TYPING }],
      }),
      appCommand('app:theme:dark', { title: 'Тёмная', category: 'Тема' }),
      extensionCommand('extension:acme:go', {
        title: 'Поприветствовать',
        category: 'Acme',
        caption: 'acme',
      }),
      appCommand('app:loose', { title: 'Без категории' }),
    ],
    extensions: [{ command: 'extension:acme:go', key: 'Mod+Shift+G' }],
  });
  const input = { registry: ctx.registry, keybindings: ctx.keybindings, word };
  return { ...ctx, language, input, rows: () => buildShortcutRows(input) };
};

const row = (rows: ReturnType<typeof buildShortcutRows>, key: string) =>
  rows.find((item) => item.key === key)!;

describe('таблица сочетаний: строки', () => {
  it('содержит все команды приложения и расширений, в том числе скрытые из палитры и без привязок', () => {
    const { rows } = setup();
    expect(rows().map(({ key }) => key)).toEqual([
      'app:palette.open',
      'app:go:courses',
      'app:theme:dark',
      'extension:acme:go',
      'app:loose',
    ]);
  });

  it('привязка: подпись по частям цепочки, озвучивание, условие и источник', () => {
    const { rows } = setup();
    expect(row(rows(), 'app:go:courses')).toMatchObject({
      source: 'default',
      customized: false,
      bindings: [
        {
          keys: 'Ctrl+2',
          strokes: ['Ctrl+2'],
          spoken: 'control 2',
          when: NOT_TYPING,
          source: 'default',
          entry: { key: 'Mod+2', when: NOT_TYPING },
        },
      ],
    });
    expect(row(rows(), 'extension:acme:go')).toMatchObject({
      source: 'extension',
      caption: 'acme',
      commandSource: 'extension',
      bindings: [{ keys: 'Ctrl+Shift+G', when: null, source: 'extension' }],
    });
    expect(row(rows(), 'app:theme:dark')).toMatchObject({
      source: null,
      bindings: [],
    });
  });

  it('цепочка — по одной подписи на нажатие', async () => {
    const { keybindings, rows } = setup();
    await keybindings.save({
      'app:theme:dark': [{ key: 'Mod+K Mod+D', when: NOT_TYPING }],
    });
    expect(row(rows(), 'app:theme:dark').bindings[0]).toMatchObject({
      strokes: ['Ctrl+K', 'Ctrl+D'],
      keys: 'Ctrl+K Ctrl+D',
    });
  });

  it('набор пользователя: источник «user», строка изменена; пустой набор — «user» без привязок', async () => {
    const { keybindings, rows } = setup();
    await keybindings.save({
      'app:go:courses': [{ key: 'Mod+Shift+2', when: null }],
      'extension:acme:go': [],
    });
    expect(row(rows(), 'app:go:courses')).toMatchObject({
      customized: true,
      source: 'user',
      bindings: [{ source: 'user', when: null }],
    });
    expect(row(rows(), 'extension:acme:go')).toMatchObject({
      customized: true,
      source: 'user',
      bindings: [],
    });
  });

  it('пересечения называют другую команду и победителя', () => {
    const { rows, setExtensions } = setup();
    setExtensions([{ command: 'extension:acme:go', key: 'Mod+2' }]);
    expect(row(rows(), 'app:go:courses').conflicts).toEqual([
      {
        otherKey: 'extension:acme:go',
        otherTitle: 'Поприветствовать',
        otherKeys: 'Ctrl+2',
        kind: 'same',
        wins: true,
      },
    ]);
    expect(row(rows(), 'extension:acme:go').conflicts).toEqual([
      {
        otherKey: 'app:go:courses',
        otherTitle: 'Курсы',
        otherKeys: 'Ctrl+2',
        kind: 'same',
        wins: false,
      },
    ]);
    expect(row(rows(), 'app:theme:dark').conflicts).toEqual([]);
  });
});

describe('таблица сочетаний: поиск, фильтры, группы', () => {
  const filters = { query: '', changedOnly: false, conflictsOnly: false };
  const keysOf = (rows: ReturnType<typeof buildShortcutRows>) =>
    rows.map(({ key }) => key);

  it('поиск: каждое слово есть в названии, категории, клавишах (подпись и запись) или ключе команды', () => {
    const { rows } = setup();
    const find = (query: string) =>
      keysOf(filterShortcutRows(rows(), { ...filters, query }));
    expect(find('курс')).toEqual(['app:go:courses']);
    expect(find('ПЕРЕХОД')).toEqual(['app:go:courses']);
    expect(find('ctrl+shift+g')).toEqual(['extension:acme:go']);
    expect(find('Mod+2')).toEqual(['app:go:courses']);
    expect(find('theme:dark')).toEqual(['app:theme:dark']);
    expect(find('acme')).toEqual(['extension:acme:go']);
    expect(find('курс acme')).toEqual([]);
    expect(find('  ')).toHaveLength(5);
  });

  it('фильтры «изменённые» и «только с пересечениями»', async () => {
    const { rows, keybindings, setExtensions } = setup();
    setExtensions([{ command: 'extension:acme:go', key: 'Mod+2' }]);
    expect(
      keysOf(filterShortcutRows(rows(), { ...filters, conflictsOnly: true })),
    ).toEqual(['app:go:courses', 'extension:acme:go']);
    await keybindings.save({
      'app:theme:dark': [{ key: 'Mod+D', when: NOT_TYPING }],
    });
    expect(
      keysOf(filterShortcutRows(rows(), { ...filters, changedOnly: true })),
    ).toEqual(['app:theme:dark']);
    expect(
      keysOf(
        filterShortcutRows(rows(), {
          query: 'dark',
          changedOnly: true,
          conflictsOnly: true,
        }),
      ),
    ).toEqual([]);
  });

  it('группы по категориям в порядке регистрации, без категории — последними', () => {
    const { rows } = setup();
    expect(
      groupShortcutRows(rows()).map(({ category, rows: items }) => [
        category,
        keysOf(items),
      ]),
    ).toEqual([
      ['Приложение', ['app:palette.open']],
      ['Переход', ['app:go:courses']],
      ['Тема', ['app:theme:dark']],
      ['Acme', ['extension:acme:go']],
      [undefined, ['app:loose']],
    ]);
  });

  it('useShortcuts следует за языком, реестром и фильтрами', () => {
    const { input, language, registry } = setup();
    const shortcuts = useShortcuts(input);
    expect(shortcuts.groups.value.map(({ category }) => category)).toContain(
      'Переход',
    );
    language.value = 'en';
    expect(shortcuts.groups.value.map(({ category }) => category)).toContain(
      'Go',
    );
    shortcuts.filters.query = 'courses';
    expect(
      shortcuts.groups.value.flatMap(({ rows }) => rows.map(({ key }) => key)),
    ).toEqual(['app:go:courses']);
    shortcuts.filters.query = '';
    const dispose = registry.register(appCommand('app:new', { title: 'New' }));
    expect(shortcuts.rows.value).toHaveLength(6);
    dispose();
    expect(shortcuts.rows.value).toHaveLength(5);
    expect(shortcuts.customizedCount.value).toBe(0);
  });
});

describe('условие по умолчанию в диалоге', () => {
  it('у команды с привязками — условие действующей; у новой привязки команды приложения — не при вводе; у расширения — пусто', () => {
    const { rows } = setup();
    expect(defaultWhenOf(row(rows(), 'app:go:courses'))).toBe(NOT_TYPING);
    // у палитры условия нет: подставляется пустое, а не умолчание «не при вводе»
    expect(defaultWhenOf(row(rows(), 'app:palette.open'))).toBe('');
    expect(defaultWhenOf(row(rows(), 'app:theme:dark'))).toBe(NOT_TYPING);
    expect(defaultWhenOf(row(rows(), 'extension:acme:go'))).toBe('');
    const noBindings = row(rows(), 'app:loose');
    expect(defaultWhenOf({ ...noBindings, commandSource: 'extension' })).toBe(
      '',
    );
  });
});
