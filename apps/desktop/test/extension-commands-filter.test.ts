import { describe, expect, it } from 'vitest';
import type { CommandContributionDto } from '@dolphy-app/engine-contract';
import {
  commandKey,
  filterCommands,
} from '@/features/extension-commands/lib/filter.ts';

const command = (
  id: string,
  override: Partial<CommandContributionDto> = {},
): CommandContributionDto => ({
  id,
  extensionId: 'acme.streak',
  title: id,
  description: null,
  category: null,
  keybinding: null,
  palette: true,
  ...override,
});

const keys = (list: ReturnType<typeof filterCommands>) =>
  list.map(({ key }) => key);

describe('filterCommands', () => {
  it('ключ строки — расширение и id команды', () => {
    expect(commandKey(command('a.b', { extensionId: 'x.y' }))).toBe('x.y:a.b');
  });

  it('команды с palette:false в палитре не показываются, даже без запроса', () => {
    const list = filterCommands(
      [command('shown'), command('hidden', { palette: false })],
      '',
    );
    expect(keys(list)).toEqual(['acme.streak:shown']);
    expect(
      filterCommands([command('hidden', { palette: false })], 'hidden'),
    ).toEqual([]);
  });

  it('поиск без учёта регистра по названию, категории и id расширения', () => {
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
    expect(commands.map(({ id }) => id)).toEqual(['b', 'a']);
  });
});
