import { describe, expect, it } from 'vitest';
import type {
  CommandContributionDto,
  ExtensionContributesDto,
} from '@dolphy-app/engine-contract';
import { resolveLocalizedText } from '@dolphy-app/extension-api';
import type { LocalizedText } from '@dolphy-app/extension-api';
import {
  COLLAPSED_VALUES,
  contributionGroups,
  hidesContributions,
  visibleValues,
} from '@/pages/settings/model/extensions.ts';
import type {
  ClientContributions,
  ContributionGroup,
  ContributionSources,
  LiveContributions,
} from '@/pages/settings/model/extensions.ts';
import { NO_CONTRIBUTES } from './support/extensions-fakes.ts';

const NO_LIVE: LiveContributions = {
  exerciseTypes: [],
  gradePolicies: [],
  settings: [],
  commands: [],
  importers: [],
  exporters: [],
};

const NO_CLIENTS: ClientContributions = {
  panels: [],
  injections: [],
  themes: [],
  markdownRenderers: [],
  commands: [],
};

const sources = (patch: {
  contributes?: Partial<ExtensionContributesDto>;
  live?: Partial<LiveContributions>;
  clients?: Partial<ClientContributions>;
}): ContributionSources => ({
  extensionId: 'acme',
  contributes: { ...NO_CONTRIBUTES, ...patch.contributes },
  live: { ...NO_LIVE, ...patch.live },
  clients: { ...NO_CLIENTS, ...patch.clients },
});

const ru = (title: LocalizedText) => resolveLocalizedText(title, 'ru');
const en = (title: LocalizedText) => resolveLocalizedText(title, 'en');

const command = (id: string, title: LocalizedText, extensionId = 'acme') =>
  ({ id, extensionId, title }) as CommandContributionDto;

const labels = (groups: ContributionGroup[], point: string) =>
  groups.find((group) => group.point === point)?.items.map((i) => i.label);

describe('contributionGroups', () => {
  it('расширение без вкладов — без групп', () => {
    expect(contributionGroups(sources({}), ru)).toEqual([]);
  });

  it('серверные точки идут в порядке точек; подписи берутся из живых вкладов по id, без подписи текст — id', () => {
    const groups = contributionGroups(
      sources({
        contributes: {
          commands: ['acme.run', 'acme.stop'],
          gradePolicies: ['acme.strict'],
          settings: ['acme'],
          importers: ['acme.csv'],
          exporters: ['acme.json'],
        },
        live: {
          commands: [command('acme.run', 'Запустить')],
          gradePolicies: [
            { id: 'acme.strict', extensionId: 'acme', label: 'Строго' },
          ],
          settings: [
            { id: 'acme', extensionId: 'acme', label: { en: 'Acme' } } as never,
          ],
          importers: [
            { id: 'acme.csv', extensionId: 'acme', title: 'CSV' } as never,
          ],
          exporters: [
            { id: 'acme.json', extensionId: 'acme', title: 'JSON' } as never,
          ],
        },
      }),
      ru,
    );
    expect(groups.map((group) => group.point)).toEqual([
      'gradePolicies',
      'settings',
      'commands',
      'importers',
      'exporters',
    ]);
    expect(labels(groups, 'commands')).toEqual(['Запустить', 'acme.stop']);
    expect(labels(groups, 'gradePolicies')).toEqual(['Строго']);
    expect(labels(groups, 'settings')).toEqual(['Acme']);
    expect(labels(groups, 'importers')).toEqual(['CSV']);
    expect(labels(groups, 'exporters')).toEqual(['JSON']);
  });

  it('подписи чужих расширений не подставляются; текст — на языке окна, запасной — английский', () => {
    const live = {
      commands: [
        command('acme.run', { en: 'Run', ru: 'Запуск' }, 'other'),
        command('acme.go', { en: 'Go' }),
      ],
    };
    const ours = sources({
      contributes: { commands: ['acme.run', 'acme.go'] },
      live,
    });
    expect(labels(contributionGroups(ours, ru), 'commands')).toEqual([
      'acme.run',
      'Go',
    ]);
    const translated = sources({
      contributes: { commands: ['acme.go'] },
      live: { commands: [command('acme.go', { en: 'Go', ru: 'Иди' })] },
    });
    expect(labels(contributionGroups(translated, ru), 'commands')).toEqual([
      'Иди',
    ]);
    expect(labels(contributionGroups(translated, en), 'commands')).toEqual([
      'Go',
    ]);
  });

  it('клиентские вклады: темы, рендереры, панели, вставки; чужие расширения не попадают, языки без повторов', () => {
    const groups = contributionGroups(
      sources({
        clients: {
          panels: [
            { extensionId: 'acme', id: 'board', title: { en: 'Board' } },
            { extensionId: 'other', id: 'x', title: 'X' },
          ],
          injections: [
            { extensionId: 'acme', id: 'acme.card' },
            { extensionId: 'acme', id: 'acme.badge' },
            { extensionId: 'other', id: 'other.top' },
          ],
          themes: [{ extensionId: 'acme', id: 'acme.night', label: 'Полночь' }],
          markdownRenderers: [
            { extensionId: 'acme', language: 'math' },
            { extensionId: 'acme', language: 'math' },
          ],
        },
      }),
      ru,
    );
    expect(groups.map((group) => group.point)).toEqual([
      'themes',
      'markdownRenderers',
      'panels',
      'injections',
    ]);
    expect(labels(groups, 'themes')).toEqual(['Полночь']);
    expect(labels(groups, 'markdownRenderers')).toEqual(['math']);
    expect(labels(groups, 'panels')).toEqual(['Board']);
    expect(labels(groups, 'injections')).toEqual(['acme.card', 'acme.badge']);
  });

  it('клиентские команды сливаются с серверными без повторов по id; подпись серверной важнее', () => {
    const groups = contributionGroups(
      sources({
        contributes: { commands: ['acme.run'] },
        live: { commands: [command('acme.run', 'Запустить')] },
        clients: {
          commands: [
            { extensionId: 'acme', id: 'acme.run', title: 'Run (client)' },
            { extensionId: 'acme', id: 'acme.local', title: 'Локально' },
            { extensionId: 'other', id: 'other.cmd', title: 'Чужая' },
          ],
        },
      }),
      ru,
    );
    expect(groups.find((group) => group.point === 'commands')?.items).toEqual([
      { id: 'acme.run', label: 'Запустить', mono: false, duplicate: false },
      { id: 'acme.local', label: 'Локально', mono: false, duplicate: false },
    ]);
  });

  it('виды заданий без подписи и языки рендереров — моноширинно; подписанные и события — нет', () => {
    const groups = contributionGroups(
      sources({
        contributes: {
          exerciseTypes: ['a.quiz', 'a.plain'],
          events: ['session.started'],
        },
        live: {
          exerciseTypes: [
            { type: 'a.quiz', extensionId: 'acme', title: 'Викторина' },
          ],
        },
        clients: {
          markdownRenderers: [{ extensionId: 'acme', language: 'math' }],
        },
      }),
      ru,
    );
    expect(
      groups.map((group) => [group.point, group.items.map((i) => i.mono)]),
    ).toEqual([
      ['exerciseTypes', [false, true]],
      ['markdownRenderers', [true]],
      ['events', [false]],
    ]);
  });

  it('события показываются через переданное название, неизвестные — как есть', () => {
    const groups = contributionGroups(
      sources({ contributes: { events: ['session.started', 'weird.event'] } }),
      ru,
      (name) => (name === 'session.started' ? 'Начало занятия' : name),
    );
    expect(labels(groups, 'events')).toEqual(['Начало занятия', 'weird.event']);
  });

  it('одинаковые подписи помечены, чтобы id был доступен скринридеру', () => {
    const groups = contributionGroups(
      sources({
        contributes: { commands: ['a.one', 'a.two', 'a.three'] },
        live: {
          commands: [
            command('a.one', 'Запустить'),
            command('a.two', 'Запустить'),
            command('a.three', 'Стоп'),
          ],
        },
      }),
      ru,
    );
    expect(groups[0]?.items.map((item) => item.duplicate)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('64 команды сворачиваются до первых значений', () => {
    const commands = Array.from({ length: 64 }, (_, i) => `a.c${i}`);
    const groups = contributionGroups(
      sources({
        contributes: { commands },
        live: { commands: commands.map((id) => command(id, `Команда ${id}`)) },
      }),
      ru,
    );
    const collapsed = visibleValues(groups[0]?.items ?? [], false);
    expect(collapsed.shown).toHaveLength(COLLAPSED_VALUES);
    expect(collapsed.shown[0]?.label).toBe('Команда a.c0');
    expect(collapsed.hidden).toBe(64 - COLLAPSED_VALUES);
  });
});

describe('hidesContributions', () => {
  const group = (point: ContributionGroup['point'], texts: string[]) => ({
    point,
    items: texts.map((label) => ({
      id: label,
      label,
      mono: false,
      duplicate: false,
    })),
  });

  it('единственная тема с названием расширения не повторяется', () => {
    expect(hidesContributions([group('themes', ['Полночь'])], 'Полночь')).toBe(
      true,
    );
  });

  it.each([
    ['название отличается', [group('themes', ['Полночь'])], 'Night'],
    ['у расширения нет названия', [group('themes', ['Полночь'])], null],
    [
      'вкладов два',
      [group('themes', ['Полночь']), group('commands', ['Полночь'])],
      'Полночь',
    ],
    ['единственный вклад — не тема', [group('panels', ['Полночь'])], 'Полночь'],
    ['две темы', [group('themes', ['Полночь', 'День'])], 'Полночь'],
    ['вкладов нет', [], 'Полночь'],
  ] as const)('показывается, если %s', (_why, groups, name) => {
    expect(hidesContributions(groups, name)).toBe(false);
  });
});
