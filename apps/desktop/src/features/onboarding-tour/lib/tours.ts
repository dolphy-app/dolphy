import { ROUTE } from '@/shared/config/routes.ts';

/** С какой стороны цели карточка предпочтительна; места нет — `placeCard` выберет другую. */
export type TourPlacement = 'top' | 'bottom' | 'start' | 'end';

export interface TourStep {
  /** Часть ключа сообщений: `tour.<тур>.<шаг>.title` и `.text`. */
  id: string;
  /** Значок шага (mdi): тот же, что у самого элемента, когда он есть на экране. */
  icon: string;
  /** Страница, на которую тур переходит перед шагом; нет — остаётся где есть. */
  route?: string;
  /** Значение `data-tour` целевого элемента; нет — карточка по центру окна. */
  target?: string;
  placement?: TourPlacement;
}

export interface TourDefinition {
  /** Ключ записи об исходе (`UiSettingsDto.tours`) и часть ключей сообщений. */
  id: string;
  steps: readonly TourStep[];
}

export const WELCOME_TOUR_ID = 'welcome';

/**
 * Знакомство с неочевидным: проверка знаний на «Курсах», главные параметры
 * «Обучения» (запоминаемость, закрепление основ, правило оценки), «Библиотека»,
 * «Расширения» и сочетания клавиш — те места настроек, названия которых
 * ничего не говорят с первого взгляда.
 * Существенно переписанный тур получает новый id, и его предложат снова; правка текстов
 * id не меняет.
 */
export const WELCOME_TOUR: TourDefinition = {
  id: WELCOME_TOUR_ID,
  steps: [
    { id: 'intro', icon: 'mdi-hand-wave-outline', route: ROUTE.dailyPlan },
    {
      id: 'check',
      icon: 'mdi-clipboard-check-outline',
      route: ROUTE.courses,
      target: 'course-check',
      placement: 'top',
    },
    {
      id: 'learning',
      icon: 'mdi-school-outline',
      route: ROUTE.settingsLearning,
      target: 'tab-settings-learning',
      placement: 'bottom',
    },
    {
      id: 'retention',
      icon: 'mdi-brain',
      route: ROUTE.settingsLearning,
      target: 'learning-retention',
      placement: 'bottom',
    },
    {
      id: 'remediation',
      icon: 'mdi-lifebuoy',
      route: ROUTE.settingsLearning,
      target: 'learning-remediation',
      placement: 'top',
    },
    {
      id: 'grade',
      icon: 'mdi-star-check-outline',
      route: ROUTE.settingsLearning,
      target: 'learning-grade',
      placement: 'top',
    },
    {
      id: 'library',
      icon: 'mdi-book-multiple-outline',
      route: ROUTE.settingsLibrary,
      target: 'tab-settings-library',
      placement: 'bottom',
    },
    {
      id: 'extensions',
      icon: 'mdi-puzzle-outline',
      route: ROUTE.settingsExtensions,
      target: 'tab-settings-extensions',
      placement: 'bottom',
    },
    {
      id: 'settings',
      icon: 'mdi-keyboard-outline',
      route: ROUTE.settingsShortcuts,
      target: 'tab-settings-shortcuts',
      placement: 'bottom',
    },
  ],
};

export const TOURS: readonly TourDefinition[] = [WELCOME_TOUR];

/** Атрибут цели шага: `data-tour="<значение>"`. */
export const targetSelector = (target: string): string =>
  `[data-tour="${target}"]`;
