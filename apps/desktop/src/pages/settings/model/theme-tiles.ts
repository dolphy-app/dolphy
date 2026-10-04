import type { ThemeContributionDto } from '@dolphy-app/engine-contract';
import { vuetifyThemeName } from '@/shared/lib/extension-themes.ts';

export const BUILTIN_THEMES = ['system', 'light', 'dark'] as const;

export interface ThemeTileModel {
  id: string;
  label: string;
  /** Подсказка плитки (`title`, `aria-describedby`); не переводится. */
  tooltip?: string;
  /** Имена тем Vuetify для образца: `system` — светлая и тёмная. */
  names: string[];
}

/**
 * Плитки выбора темы: встроенные и темы расширений. Идентификатор
 * расширения — подсказка, а не видимая подпись.
 */
export const buildThemeTiles = (
  builtinLabel: (id: (typeof BUILTIN_THEMES)[number]) => string,
  themes: readonly ThemeContributionDto[],
): ThemeTileModel[] => [
  ...BUILTIN_THEMES.map((id) => ({
    id,
    label: builtinLabel(id),
    names: id === 'system' ? ['light', 'dark'] : [id],
  })),
  ...themes.map((theme) => ({
    id: theme.id,
    label: theme.label,
    tooltip: theme.extensionId,
    names: [vuetifyThemeName(theme.id)],
  })),
];
