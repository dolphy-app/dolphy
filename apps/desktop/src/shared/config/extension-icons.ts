import { DEFAULT_EXTENSION_ICON } from '@dolphy-app/extension-api';
import type { ExtensionIconName } from '@dolphy-app/extension-api';

/**
 * Символ окна для каждого имени из закрытого списка `EXTENSION_ICONS`: от
 * расширения приходит только имя, картинку рисует приложение. Запись по всем
 * именам обязательна (тип `Record`): новое имя в списке без символа не
 * соберётся.
 */
export const EXTENSION_ICON_GLYPHS: Record<ExtensionIconName, string> = {
  puzzle: 'mdi-puzzle-outline',
  book: 'mdi-book-open-variant',
  brain: 'mdi-brain',
  calendar: 'mdi-calendar-month',
  chart: 'mdi-chart-line',
  check: 'mdi-check-circle-outline',
  clock: 'mdi-clock-outline',
  cog: 'mdi-cog-outline',
  fire: 'mdi-fire',
  flag: 'mdi-flag-outline',
  heart: 'mdi-heart-outline',
  help: 'mdi-help-circle-outline',
  home: 'mdi-home-outline',
  idea: 'mdi-lightbulb-outline',
  list: 'mdi-format-list-bulleted',
  message: 'mdi-message-outline',
  pencil: 'mdi-pencil-outline',
  play: 'mdi-play-circle-outline',
  star: 'mdi-star-outline',
  target: 'mdi-target',
  trophy: 'mdi-trophy-outline',
  bell: 'mdi-bell-outline',
  bookmark: 'mdi-bookmark-outline',
  tag: 'mdi-tag-outline',
};

const isIconName = (name: string): name is ExtensionIconName =>
  Object.hasOwn(EXTENSION_ICON_GLYPHS, name);

/** Символ для имени из вклада (`icon` в DTO — строка); неизвестное имя — символ по умолчанию. */
export const extensionIconOf = (name: string): string =>
  EXTENSION_ICON_GLYPHS[isIconName(name) ? name : DEFAULT_EXTENSION_ICON];
