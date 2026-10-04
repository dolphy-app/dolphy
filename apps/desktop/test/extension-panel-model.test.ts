import { describe, expect, it } from 'vitest';
import type { ContributionsDto } from '@dolphy-app/engine-contract';
import { NO_CONTRIBUTIONS } from '@/shared/api/engine/contributions.ts';
import {
  frameKeyOf,
  resolvePanel,
} from '@/pages/extension-panel/model/panel.ts';

const contributions = (revision = 'r1'): ContributionsDto => ({
  ...NO_CONTRIBUTIONS,
  commands: [
    ['acme.panel', 'acme.panel.ping', true],
    ['acme.panel', 'acme.panel.hidden', false],
    ['acme.other', 'acme.other.steal', true],
  ].map(([extensionId, id, palette]) => ({
    id: String(id),
    extensionId: String(extensionId),
    title: String(id),
    description: null,
    category: null,
    keybinding: null,
    keybindings: [],
    palette: palette === true,
    icon: 'puzzle',
  })),
  panels: [
    {
      id: 'acme.panel.main',
      extensionId: 'acme.panel',
      title: 'Панель',
      icon: 'puzzle',
      rendererUrl: 'dolphy-ext://acme.panel/panel.mjs',
      isolated: true,
      origin: 'user',
      revision,
    },
  ],
});

describe('resolvePanel', () => {
  it('отдаёт панель и команды только её расширения, включая palette:false', () => {
    const resolved = resolvePanel(
      contributions(),
      'acme.panel',
      'acme.panel.main',
    );
    expect(resolved?.panel.title).toBe('Панель');
    expect([...(resolved?.commands ?? [])].sort()).toEqual([
      'acme.panel.hidden',
      'acme.panel.ping',
    ]);
  });

  it('панели нет (отключена, удалена, чужой id) — null', () => {
    expect(
      resolvePanel(NO_CONTRIBUTIONS, 'acme.panel', 'acme.panel.main'),
    ).toBeNull();
    expect(
      resolvePanel(contributions(), 'acme.other', 'acme.panel.main'),
    ).toBeNull();
    expect(resolvePanel(contributions(), 'acme.panel', 'nope')).toBeNull();
  });

  it('панель возвращается, когда расширение вернулось', () => {
    expect(
      resolvePanel(NO_CONTRIBUTIONS, 'acme.panel', 'acme.panel.main'),
    ).toBeNull();
    expect(
      resolvePanel(contributions(), 'acme.panel', 'acme.panel.main'),
    ).not.toBeNull();
  });
});

describe('frameKeyOf', () => {
  it('новая revision — новый ключ рамки, та же revision — тот же', () => {
    const [first] = contributions('r1').panels;
    const [same] = contributions('r1').panels;
    const [updated] = contributions('r2').panels;
    expect(frameKeyOf(first as never)).toBe(frameKeyOf(same as never));
    expect(frameKeyOf(first as never)).not.toBe(frameKeyOf(updated as never));
    expect(frameKeyOf(first as never)).toBe('acme.panel:acme.panel.main:r1');
  });
});
