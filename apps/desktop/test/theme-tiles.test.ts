import { describe, expect, it } from 'vitest';
import { resolveLocalizedText } from '@dolphy-app/extension-api';
import { buildThemeTiles } from '@/pages/settings/model/theme-tiles.ts';

const MIDNIGHT = {
  id: 'acme.midnight',
  label: { en: 'Midnight', ru: 'Полночь' },
  extensionId: 'acme.midnight-pack',
};
const DAWN = {
  id: 'acme.dawn',
  label: { en: 'Dawn' },
  extensionId: 'acme.midnight-pack',
};

describe('плитки тем', () => {
  it('идентификатор расширения — подсказка плитки, а не подпись', () => {
    const tiles = buildThemeTiles(
      (id) => `t:${id}`,
      [MIDNIGHT],
      (label) => resolveLocalizedText(label, 'ru'),
    );
    const tile = tiles.find((candidate) => candidate.id === MIDNIGHT.id);
    expect(tile).toMatchObject({
      label: 'Полночь',
      tooltip: 'acme.midnight-pack',
    });
    expect(tile).not.toHaveProperty('caption');
  });

  it('подпись — на языке окна, без перевода — английская', () => {
    const labelsOf = (locale: string) =>
      buildThemeTiles(
        (id) => id,
        [MIDNIGHT, DAWN],
        (label) => resolveLocalizedText(label, locale),
      )
        .slice(3)
        .map((tile) => tile.label);
    expect(labelsOf('ru')).toEqual(['Полночь', 'Dawn']);
    expect(labelsOf('en')).toEqual(['Midnight', 'Dawn']);
  });

  it('встроенные плитки без подсказки, «Как в системе» показывает обе темы', () => {
    const [system, light, dark] = buildThemeTiles(
      (id) => `t:${id}`,
      [],
      (label) => resolveLocalizedText(label, 'ru'),
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
