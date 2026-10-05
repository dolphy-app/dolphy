import { ROUTE } from '@/shared/config/routes.ts';

/** Куда карточка шага ставится относительно цели (значения `location` Vuetify). */
export type TourPlacement = 'top' | 'bottom' | 'start' | 'end';

export interface TourStep {
  /** Часть ключа сообщений: `tour.<тур>.<шаг>.title` и `.text`. */
  id: string;
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
    { id: 'intro', route: ROUTE.dailyPlan },
    {
      id: 'plan',
      route: ROUTE.dailyPlan,
      target: 'nav-daily-plan',
      placement: 'end',
    },
    {
      id: 'scope',
      route: ROUTE.dailyPlan,
      target: 'plan-course-switcher',
      placement: 'bottom',
    },
    {
      id: 'card',
      route: ROUTE.courses,
      target: 'course-card',
      placement: 'bottom',
    },
    {
      id: 'check',
      route: ROUTE.courses,
      target: 'course-check',
      placement: 'top',
    },
    {
      id: 'git',
      route: ROUTE.courses,
      target: 'courses-git',
      placement: 'bottom',
    },
    {
      id: 'settings',
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
