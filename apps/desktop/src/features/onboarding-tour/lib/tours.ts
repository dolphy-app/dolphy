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
 * Знакомство с оболочкой: «План», «Курсы», «Настройки». Существенно
 * переписанный тур получает новый id, и его предложат снова; правка текстов
 * id не меняет.
 */
export const WELCOME_TOUR: TourDefinition = {
  id: WELCOME_TOUR_ID,
  steps: [
    { id: 'intro', icon: 'mdi-hand-wave-outline', route: ROUTE.dailyPlan },
    {
      id: 'plan',
      icon: 'mdi-calendar-check',
      route: ROUTE.dailyPlan,
      target: 'nav-daily-plan',
      placement: 'end',
    },
    {
      id: 'scope',
      icon: 'mdi-target',
      route: ROUTE.dailyPlan,
      target: 'plan-course-switcher',
      placement: 'bottom',
    },
    {
      id: 'card',
      icon: 'mdi-card-text-outline',
      route: ROUTE.courses,
      target: 'course-card',
      placement: 'bottom',
    },
    {
      id: 'check',
      icon: 'mdi-clipboard-check-outline',
      route: ROUTE.courses,
      target: 'course-check',
      placement: 'top',
    },
    {
      id: 'git',
      icon: 'mdi-source-branch-plus',
      route: ROUTE.courses,
      target: 'courses-git',
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
