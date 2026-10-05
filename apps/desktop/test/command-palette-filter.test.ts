import { describe, expect, it } from 'vitest';
import type { Command } from '@/shared/lib/command-registry.ts';
import { filterCommands } from '@/widgets/command-palette/lib/filter.ts';

interface Spec {
  id: string;
  extensionId?: string;
  title?: string;
  category?: string;
  enabled?: boolean;
  listed?: boolean;
}

/** Ключ строки — `<extensionId>:<id>`, подпись — id расширения, как у команды расширения. */
const command = (id: string, override: Omit<Spec, 'id'> = {}): Command => {
  const extensionId = override.extensionId ?? 'acme.streak';
  return {
    key: `${extensionId}:${id}`,
    source: 'extension',
    title: override.title ?? id,
    category: override.category,
    description: undefined,
    caption: extensionId,
    icon: undefined,
    defaultBindings: [],
    checked: undefined,
    enabled: override.enabled ?? true,
    listed: override.listed ?? true,
    run: () => undefined,
  };
};

const keys = (list: ReturnType<typeof filterCommands>) =>
  list.map(({ key }) => key);

describe('filterCommands', () => {
  it('команды приложения без подписи находятся по названию и категории', () => {
    const app: Command = {
      ...command('go'),
      key: 'app:go:courses',
      source: 'app',
      title: 'Перейти: Курсы',
      category: 'Переход',
      caption: undefined,
    };
    expect(keys(filterCommands([app], 'КУРС'))).toEqual(['app:go:courses']);
    expect(keys(filterCommands([app], 'переход'))).toEqual(['app:go:courses']);
    expect(filterCommands([app], 'acme')).toEqual([]);
  });

  it('недоступные команды в палитре не показываются, даже без запроса', () => {
    const list = filterCommands(
      [command('shown'), command('hidden', { enabled: false })],
      '',
    );
    expect(keys(list)).toEqual(['acme.streak:shown']);
    expect(
      filterCommands([command('hidden', { enabled: false })], 'hidden'),
    ).toEqual([]);
  });

  it('команды, скрытые из палитры, не показываются ни без запроса, ни по запросу', () => {
    const commands = [
      command('shown'),
      command('hidden', { listed: false, title: 'shown too' }),
    ];
    expect(keys(filterCommands(commands, ''))).toEqual(['acme.streak:shown']);
    expect(keys(filterCommands(commands, 'shown'))).toEqual([
      'acme.streak:shown',
    ]);
  });

  it('поиск без учёта регистра по названию, категории и подписи (id расширения)', () => {
    const commands = [
      command('one', { title: 'Показать СЕРИЮ', category: 'Обучение' }),
      command('two', { title: 'Сбросить', extensionId: 'acme.Timer' }),
      command('three', { title: 'Другое', category: 'Серия' }),
    ];
    expect(keys(filterCommands(commands, 'серию'))).toEqual([
      'acme.streak:one',
    ]);
    expect(keys(filterCommands(commands, 'ОБУЧЕНИЕ'))).toEqual([
      'acme.streak:one',
    ]);
    expect(keys(filterCommands(commands, 'acme.timer'))).toEqual([
      'acme.Timer:two',
    ]);
  });

  it('каждое слово запроса должно совпасть (в любом из полей)', () => {
    const commands = [
      command('one', { title: 'Показать серию', category: 'Обучение' }),
      command('two', { title: 'Показать курсы', category: 'Каталог' }),
    ];
    expect(keys(filterCommands(commands, 'показать обучение'))).toEqual([
      'acme.streak:one',
    ]);
    expect(filterCommands(commands, 'показать несуществующее')).toEqual([]);
  });

  it('лучшее совпадение выше: начало названия, слово, часть названия, категория, расширение', () => {
    const commands = [
      command('ext', { title: 'Zzz', extensionId: 'acme.log' }),
      command('cat', { title: 'Yyy', category: 'Log' }),
      command('part', { title: 'Catalog' }),
      command('word', { title: 'Open log' }),
      command('prefix', { title: 'Log in' }),
    ];
    expect(keys(filterCommands(commands, 'log'))).toEqual([
      'acme.streak:prefix',
      'acme.streak:word',
      'acme.streak:part',
      'acme.streak:cat',
      'acme.log:ext',
    ]);
  });

  it('без запроса: по категории (без категории в конце), затем по названию', () => {
    const commands = [
      command('c', { title: 'Без категории' }),
      command('b', { title: 'Б', category: 'Я' }),
      command('a', { title: 'А', category: 'Я' }),
      command('z', { title: 'Я', category: 'А' }),
    ];
    expect(keys(filterCommands(commands, '  '))).toEqual([
      'acme.streak:z',
      'acme.streak:a',
      'acme.streak:b',
      'acme.streak:c',
    ]);
  });

  it('не меняет исходный массив', () => {
    const commands = [command('b'), command('a')];
    filterCommands(commands, '');
    expect(commands.map(({ key }) => key)).toEqual([
      'acme.streak:b',
      'acme.streak:a',
    ]);
  });
});
