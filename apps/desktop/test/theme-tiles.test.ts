import { describe, expect, it } from 'vitest';
import type { ThemeContributionDto } from '@dolphy-app/engine-contract';
import { buildThemeTiles } from '@/pages/settings/model/theme-tiles.ts';

const MIDNIGHT = {
  id: 'acme.midnight',
  label: 'Полночь',
  extensionId: 'acme.midnight-pack',
} as ThemeContributionDto;

describe('плитки тем', () => {
  it('идентификатор расширения — подсказка плитки, а не подпись', () => {
    const tiles = buildThemeTiles(
      (id) => `t:${id}`,
      [MIDNIGHT],
      ({ label }) => label,
    );
    const tile = tiles.find((candidate) => candidate.id === MIDNIGHT.id);
    expect(tile).toMatchObject({
      label: 'Полночь',
      tooltip: 'acme.midnight-pack',
    });
    expect(tile).not.toHaveProperty('caption');
  });

  it('встроенные плитки без подсказки, «Как в системе» показывает обе темы', () => {
    const [system, light, dark] = buildThemeTiles(
      (id) => `t:${id}`,
      [],
      ({ label }) => label,
    );
    expect([system?.id, light?.id, dark?.id]).toEqual([
      'system',
      'light',
      'dark',
    ]);
    expect(system?.names).toEqual(['light', 'dark']);
    for (const tile of [system, light, dark]) {
      expect(tile).not.toHaveProperty('tooltip');
    }
  });
});
