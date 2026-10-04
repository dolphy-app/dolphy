import { inject, ref } from 'vue';
import type { InjectionKey, Ref } from 'vue';
import type { ContextLookup, Platform } from '@dolphy-app/keybindings';
import { ROUTE } from '@/shared/config/routes.ts';

/** Раздел окна: значение контекстного ключа `page`. */
export type PageContext =
  'dailyPlan' | 'courses' | 'graph' | 'settings' | 'session' | 'extension';

const PAGE_BY_ROUTE: Record<string, PageContext> = {
  [ROUTE.dailyPlan]: 'dailyPlan',
  [ROUTE.courses]: 'courses',
  [ROUTE.graph]: 'graph',
  [ROUTE.extensionPanel]: 'extension',
  [ROUTE.session]: 'session',
  [ROUTE.settings]: 'settings',
  [ROUTE.settingsLearning]: 'settings',
  [ROUTE.settingsLibrary]: 'settings',
  [ROUTE.settingsAppearance]: 'settings',
  [ROUTE.settingsShortcuts]: 'settings',
  [ROUTE.settingsExtensions]: 'settings',
  [ROUTE.settingsAbout]: 'settings',
};

/** Раздел по имени маршрута; `undefined` — у маршрута нет раздела (подбор уровня). */
export const pageOfRoute = (
  name: string | symbol | null | undefined,
): PageContext | undefined =>
  typeof name === 'string' && Object.hasOwn(PAGE_BY_ROUTE, name)
    ? PAGE_BY_ROUTE[name]
    : undefined;

/** Контекстные ключи для `when` (подсказка в редакторе привязок). */
export const CONTEXT_KEY_NAMES: readonly string[] = [
  'platform',
  'isMac',
  'isWindows',
  'isLinux',
  'page',
  'inSession',
  'inputFocus',
  'modalOpen',
  'paletteOpen',
];

const EDITABLE =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
// открытый диалог или меню: фокус и ввод принадлежат им; закрытый диалог Vuetify
// остаётся в DOM до конца перехода с теми же role и aria-modal, поэтому чужие
// диалоги берутся только вне `.v-overlay`
const MODAL =
  '.v-dialog.v-overlay--active, .v-menu.v-overlay--active, [role="dialog"][aria-modal="true"]:not(.v-overlay), dialog[open]';

/**
 * Контекстные ключи окна для `when` привязок. `page`, `inSession` и
 * `paletteOpen` — реактивные значения, которые выставляет приложение;
 * `inputFocus` и `modalOpen` читаются из DOM в момент нажатия.
 */
export interface ContextKeys {
  readonly platform: Platform;
  readonly page: Ref<PageContext | undefined>;
  /** Идёт сессия обучения. */
  readonly inSession: Ref<boolean>;
  readonly paletteOpen: Ref<boolean>;
  /** Значения ключей на момент нажатия: `target` — цель события клавиатуры. */
  lookup(target: EventTarget | null): ContextLookup;
}

export const CONTEXT_KEYS_KEY: InjectionKey<ContextKeys> =
  Symbol('context-keys');

export const useContextKeys = (): ContextKeys => {
  const keys = inject(CONTEXT_KEYS_KEY);
  if (!keys) throw new Error('context keys are not provided');
  return keys;
};

export const createContextKeys = (
  platform: Platform,
  doc: Document,
): ContextKeys => {
  const page = ref<PageContext | undefined>();
  const inSession = ref(false);
  const paletteOpen = ref(false);

  const lookup = (target: EventTarget | null): ContextLookup => {
    // DOM читается только для тех ключей, которые условие запросило
    const values: Record<string, () => unknown> = {
      platform: () => platform,
      isMac: () => platform === 'mac',
      isWindows: () => platform === 'windows',
      isLinux: () => platform === 'linux',
      // фокус в поле ввода или редактируемом элементе: печатающий пользователь клавиши командам не отдаёт
      inputFocus: () =>
        target instanceof Element && target.closest(EDITABLE) !== null,
      modalOpen: () => doc.querySelector(MODAL) !== null,
      paletteOpen: () => paletteOpen.value,
      page: () => page.value,
      inSession: () => inSession.value,
    };
    return (key) => (Object.hasOwn(values, key) ? values[key]!() : undefined);
  };

  return { platform, page, inSession, paletteOpen, lookup };
};
