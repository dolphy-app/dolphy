import { inject, ref } from 'vue';
import type { InjectionKey, Ref } from 'vue';
import type { LearningEngine } from '@dolphy-app/engine-contract';
import { ROUTE } from '@/shared/config/routes.ts';
import { findTarget } from '../lib/find-target.ts';
import { TOURS, WELCOME_TOUR } from '../lib/tours.ts';
import type { TourDefinition } from '../lib/tours.ts';
import { createTourProgress } from './tour-progress.ts';
import type { TourProgress } from './tour-progress.ts';
import { createTourRunner } from './tour-runner.ts';
import type { TourRunner, TourRunnerDeps } from './tour-runner.ts';

/** Страницы оболочки, на которых тур предлагается: не сессия и не вход-тест. */
const OFFER_ROUTES: ReadonlySet<string> = new Set([
  ROUTE.dailyPlan,
  ROUTE.courses,
  ROUTE.settings,
  ROUTE.settingsLearning,
  ROUTE.settingsLibrary,
  ROUTE.settingsAppearance,
  ROUTE.settingsShortcuts,
  ROUTE.settingsExtensions,
  ROUTE.settingsAbout,
]);

const isOfferRoute = (name: string | symbol | null | undefined): boolean =>
  typeof name === 'string' && OFFER_ROUTES.has(name);

export interface OnboardingTourDeps {
  engine: Pick<LearningEngine, 'settings' | 'extensions'>;
  /** Переход на страницу шага и обратно, на страницу, с которой тур начался. */
  navigate: TourRunnerDeps['navigate'];
  /** Имя текущей страницы (реактивно): с нескольких страниц тур не запускается. */
  currentRoute(): string | symbol | null | undefined;
  /** Ожидание цели; по умолчанию — поиск `data-tour` в документе. */
  findTarget?: TourRunnerDeps['findTarget'];
}

export interface OnboardingTour {
  readonly runner: TourRunner;
  readonly progress: TourProgress;
  /** Открыт диалог «Показать краткий тур?». */
  readonly offerOpen: Ref<boolean>;
  /** Страница сменилась или данные прочитаны: при необходимости предлагает тур. */
  maybeOffer(routeName: string | symbol | null | undefined): Promise<void>;
  /** «Начать» в диалоге. */
  accept(): Promise<void>;
  /** «Пропустить» в диалоге и `Escape`: тур больше не предлагается. */
  decline(): Promise<void>;
  /** Запуск по просьбе ученика (команда, «Настройки → О движке»). */
  start(tour?: TourDefinition): Promise<void>;
  /** Тур можно запустить сейчас: идущая сессия или вход-тест не прерываются. */
  canStart(): boolean;
  /** Растёт после каждого окончания тура, когда страница уже вернулась на место. */
  readonly endedAt: Ref<number>;
}

export const ONBOARDING_TOUR_KEY: InjectionKey<OnboardingTour> =
  Symbol('onboarding-tour');

export const createOnboardingTour = (
  deps: OnboardingTourDeps,
): OnboardingTour => {
  const progress = createTourProgress(deps.engine);
  const endedAt = ref(0);
  // страница, с которой начат тур: после него ученик остаётся там, где был
  const origin: { route: string | null } = { route: null };
  const runner = createTourRunner({
    findTarget: deps.findTarget ?? findTarget,
    navigate: deps.navigate,
    onEnd: (id, outcome) => {
      void progress.record(id, outcome);
      const back = origin.route;
      origin.route = null;
      void (async () => {
        try {
          if (back !== null) await deps.navigate(back);
        } finally {
          endedAt.value += 1;
        }
      })();
    },
  });
  const offerOpen = ref(false);
  const canStart = () => isOfferRoute(deps.currentRoute());
  const begin = async (tour: TourDefinition) => {
    const route = deps.currentRoute();
    origin.route = typeof route === 'string' ? route : null;
    await runner.start(tour);
  };
  // за запуск окна предлагаем один раз, даже если ученик отказался и не успел записаться
  const offered = { value: false };

  const safeMode = async (): Promise<boolean> => {
    try {
      return (await deps.engine.extensions.diagnostics()).safeMode.active;
    } catch {
      return false;
    }
  };

  const maybeOffer = async (routeName: string | symbol | null | undefined) => {
    if (offered.value || offerOpen.value || runner.running) return;
    if (!isOfferRoute(routeName)) return;
    await progress.hydrate();
    if (offered.value || runner.running) return;
    if (progress.statuses[WELCOME_TOUR.id] !== undefined) return;
    if (await safeMode()) return;
    offered.value = true;
    offerOpen.value = true;
  };

  return {
    runner,
    progress,
    offerOpen,
    maybeOffer,
    accept: async () => {
      offerOpen.value = false;
      await begin(WELCOME_TOUR);
    },
    decline: async () => {
      offerOpen.value = false;
      await progress.record(WELCOME_TOUR.id, 'skipped');
    },
    start: async (tour = WELCOME_TOUR) => {
      if (!TOURS.includes(tour) || !canStart() || runner.running) return;
      offerOpen.value = false;
      await begin(tour);
    },
    canStart,
    endedAt,
  };
};

export const useOnboardingTour = (): OnboardingTour => {
  const tour = inject(ONBOARDING_TOUR_KEY);
  if (!tour) throw new Error('Onboarding tour is not provided');
  return tour;
};
