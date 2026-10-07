import { describe, expect, it } from 'vitest';
import type { ContributionsDto } from '@dolphy-app/engine-contract';
import { NO_CONTRIBUTIONS } from '@/shared/api/engine/contributions.ts';
import type { ClientPanel } from '@/shared/lib/extension-clients.ts';
import { resolvePanel } from '@/pages/extension-panel/model/panel.ts';
import { textComponent } from './support/client-fakes.ts';

const contributions: ContributionsDto = {
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
    keybindings: [],
    when: null,
    palette: palette === true,
    icon: 'puzzle',
  })),
};

const panels: ClientPanel[] = [
  {
    kind: 'panel',
    key: 'acme.panel:1:1',
    extensionId: 'acme.panel',
    id: 'acme.panel.main',
    title: 'Панель',
    icon: 'puzzle',
    when: null,
    component: textComponent('panel'),
  },
];

describe('resolvePanel', () => {
  it('отдаёт панель и серверные команды только её расширения, включая palette:false', () => {
    const resolved = resolvePanel(
      panels,
      contributions,
      'acme.panel',
      'acme.panel.main',
    );
    expect(resolved?.panel.title).toBe('Панель');
    expect([...(resolved?.commands ?? [])].sort()).toEqual([
      'acme.panel.hidden',
      'acme.panel.ping',
    ]);
  });

  it('панели нет (не загружена, отключена, удалена, чужой id) — null', () => {
    expect(
      resolvePanel([], contributions, 'acme.panel', 'acme.panel.main'),
    ).toBeNull();
    expect(
      resolvePanel(panels, contributions, 'acme.other', 'acme.panel.main'),
    ).toBeNull();
    expect(
      resolvePanel(panels, contributions, 'acme.panel', 'nope'),
    ).toBeNull();
  });
});
