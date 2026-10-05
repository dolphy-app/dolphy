import { describe, expect, it, vi } from 'vitest';
import type {
  LearningEngine,
  UiSettingsDto,
} from '@dolphy-app/engine-contract';
import { createOnboardingTour } from '@/features/onboarding-tour/model/onboarding-tour.ts';
import { WELCOME_TOUR } from '@/features/onboarding-tour/lib/tours.ts';
import { ROUTE } from '@/shared/config/routes.ts';

const setup = (
  ui: Partial<UiSettingsDto> = {},
  options: { safeMode?: boolean; route?: string } = {},
) => {
  const current = { route: options.route ?? ROUTE.dailyPlan };
  const setUi = vi.fn(async () => ({ theme: 'system', locale: 'system' }));
  const engine = {
    settings: {
      getUi: async () => ({ theme: 'system', locale: 'system', ...ui }),
      setUi,
    },
    extensions: {
      diagnostics: async () => ({
        safeMode: { active: options.safeMode ?? false },
      }),
    },
  } as unknown as LearningEngine;
  const navigate = vi.fn(async (name: string) => {
    current.route = name;
  });
  const tour = createOnboardingTour({
    engine,
    navigate,
    currentRoute: () => current.route,
    findTarget: async () => ({}) as HTMLElement,
  });
  return { tour, setUi, navigate, current };
};

describe('onboarding tour: offering', () => {
  it.each([ROUTE.dailyPlan, ROUTE.courses, ROUTE.settingsAbout])(
    'offers the tour on %s when nothing is recorded',
    async (route) => {
      const { tour } = setup();
      await tour.maybeOffer(route);
      expect(tour.offerOpen.value).toBe(true);
    },
  );

  it.each([
    ROUTE.session,
    ROUTE.placement,
    ROUTE.extensionPanel,
    undefined,
    null,
  ])('does not offer on %s', async (route) => {
    const { tour } = setup();
    await tour.maybeOffer(route);
    expect(tour.offerOpen.value).toBe(false);
  });

  it.each(['completed', 'skipped'] as const)(
    'does not offer once the outcome is %s',
    async (status) => {
      const { tour } = setup({ tours: { welcome: status } });
      await tour.maybeOffer(ROUTE.dailyPlan);
      expect(tour.offerOpen.value).toBe(false);
    },
  );

  it('does not offer in safe mode', async () => {
    const { tour } = setup({}, { safeMode: true });
    await tour.maybeOffer(ROUTE.dailyPlan);
    expect(tour.offerOpen.value).toBe(false);
  });

  it('offers once per window even if the learner navigates on', async () => {
    const { tour } = setup();
    await tour.maybeOffer(ROUTE.dailyPlan);
    await tour.decline();
    await tour.maybeOffer(ROUTE.courses);
    expect(tour.offerOpen.value).toBe(false);
  });

  it('does not offer while a tour is already running', async () => {
    const { tour } = setup({ tours: { other: 'completed' } });
    await tour.start();
    await tour.maybeOffer(ROUTE.dailyPlan);
    expect(tour.offerOpen.value).toBe(false);
  });
});

describe('onboarding tour: where the learner ends up', () => {
  it('returns to the page the tour started from, whatever the outcome', async () => {
    const { tour, navigate, current } = setup(
      {},
      { route: ROUTE.settingsAbout },
    );
    await tour.start();
    await tour.runner.next();
    expect(current.route).toBe(ROUTE.courses);
    const before = tour.endedAt.value;
    tour.runner.skip();
    await vi.waitFor(() => expect(tour.endedAt.value).toBe(before + 1));
    expect(navigate).toHaveBeenLastCalledWith(ROUTE.settingsAbout);
    expect(current.route).toBe(ROUTE.settingsAbout);
  });

  it('does not start from a session, a placement test or an extension panel', async () => {
    for (const route of [
      ROUTE.session,
      ROUTE.placement,
      ROUTE.extensionPanel,
    ]) {
      const { tour, navigate } = setup({}, { route });
      expect(tour.canStart()).toBe(false);
      await tour.start();
      expect(tour.runner.running).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    }
  });

  it('a second start while a tour runs changes nothing', async () => {
    const { tour, navigate } = setup();
    await tour.start();
    const calls = navigate.mock.calls.length;
    await tour.start();
    expect(navigate.mock.calls.length).toBe(calls);
  });
});

describe('onboarding tour: choices', () => {
  it('"Skip" in the dialog records skipped and never starts the tour', async () => {
    const { tour, setUi, navigate } = setup();
    await tour.maybeOffer(ROUTE.dailyPlan);
    await tour.decline();
    expect(tour.offerOpen.value).toBe(false);
    expect(tour.runner.running).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(setUi).toHaveBeenCalledExactlyOnceWith({
      tours: { welcome: 'skipped' },
    });
  });

  it('"Start" runs the tour, and skipping a step records skipped', async () => {
    const { tour, setUi } = setup();
    await tour.maybeOffer(ROUTE.dailyPlan);
    await tour.accept();
    expect(tour.runner.running).toBe(true);
    expect(tour.runner.step?.id).toBe(WELCOME_TOUR.steps[0]?.id);
    tour.runner.skip();
    await vi.waitFor(() =>
      expect(setUi).toHaveBeenCalledExactlyOnceWith({
        tours: { welcome: 'skipped' },
      }),
    );
  });

  it('finishing the last step records completed', async () => {
    const { tour, setUi } = setup();
    await tour.start();
    for (let i = 0; i < WELCOME_TOUR.steps.length; i++)
      await tour.runner.next();
    await vi.waitFor(() =>
      expect(setUi).toHaveBeenCalledExactlyOnceWith({
        tours: { welcome: 'completed' },
      }),
    );
    expect(tour.progress.statuses.welcome).toBe('completed');
  });

  it('a replay is allowed after an earlier outcome and writes the new one', async () => {
    const { tour, setUi } = setup({ tours: { welcome: 'skipped' } });
    await tour.start();
    expect(tour.runner.running).toBe(true);
    tour.runner.skip();
    await vi.waitFor(() => expect(setUi).toHaveBeenCalledOnce());
  });
});
