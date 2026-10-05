import { describe, expect, it, vi } from 'vitest';
import type { TourStatus } from '@dolphy-app/engine-contract';
import type { TourDefinition } from '@/features/onboarding-tour/lib/tours.ts';
import { createTourRunner } from '@/features/onboarding-tour/model/tour-runner.ts';

const el = (name: string) => ({ name }) as unknown as HTMLElement;

const tour: TourDefinition = {
  id: 'demo',
  steps: [
    { id: 'intro', icon: 'mdi-circle', route: 'plan' },
    { id: 'a', icon: 'mdi-circle', route: 'plan', target: 'a' },
    { id: 'b', icon: 'mdi-circle', route: 'courses', target: 'b' },
    { id: 'c', icon: 'mdi-circle', route: 'courses', target: 'c' },
  ],
};

const setup = (present: string[] = ['a', 'b', 'c']) => {
  const ended: [string, TourStatus][] = [];
  const navigate = vi.fn<(route: string) => Promise<void>>(async () => {});
  const findTarget = vi.fn(async (target: string) =>
    present.includes(target) ? el(target) : null,
  );
  const runner = createTourRunner({
    findTarget,
    navigate,
    onEnd: (id, outcome) => ended.push([id, outcome]),
  });
  return { runner, ended, navigate, findTarget };
};

describe('tour runner: moving through steps', () => {
  it('shows the first step, goes forward and back, and completes after the last one', async () => {
    const { runner, ended } = setup();
    await runner.start(tour);
    expect(runner.running).toBe(true);
    expect(runner.state).toMatchObject({
      index: 0,
      element: null,
      busy: false,
    });
    expect(runner.isFirst).toBe(true);

    await runner.next();
    expect(runner.step?.id).toBe('a');
    expect(runner.state.element).toEqual(el('a'));
    await runner.previous();
    expect(runner.step?.id).toBe('intro');
    expect(runner.state.element).toBeNull();

    await runner.next();
    await runner.next();
    await runner.next();
    expect(runner.isLast).toBe(true);
    expect(ended).toEqual([]);
    await runner.next();
    expect(ended).toEqual([['demo', 'completed']]);
    expect(runner.running).toBe(false);
    expect(runner.state).toMatchObject({
      tour: null,
      element: null,
      busy: false,
    });
  });

  it('goes to the page of each step before looking for its target', async () => {
    const { runner, navigate, findTarget } = setup();
    await runner.start(tour);
    await runner.next();
    await runner.next();
    expect(navigate.mock.calls.map(([route]) => route)).toEqual([
      'plan',
      'plan',
      'courses',
    ]);
    expect(findTarget.mock.calls.map(([target]) => target)).toEqual(['a', 'b']);
  });

  it('ignores presses while a transition is in progress', async () => {
    const { runner, findTarget } = setup();
    await runner.start(tour);
    const first = runner.next();
    const second = runner.next();
    await Promise.all([first, second]);
    expect(runner.step?.id).toBe('a');
    expect(findTarget).toHaveBeenCalledTimes(1);
  });

  it('stays on the first step when "back" has nowhere to go', async () => {
    const { runner, ended } = setup();
    await runner.start(tour);
    await runner.previous();
    expect(runner.step?.id).toBe('intro');
    expect(runner.state.busy).toBe(false);
    expect(ended).toEqual([]);
  });
});

describe('tour runner: missing targets', () => {
  it('skips a step whose target never appears, in both directions', async () => {
    const { runner } = setup(['a', 'c']);
    await runner.start(tour);
    await runner.next();
    expect(runner.step?.id).toBe('a');
    await runner.next();
    expect(runner.step?.id).toBe('c');
    await runner.previous();
    expect(runner.step?.id).toBe('a');
  });

  it('completes when the remaining targets are missing but earlier steps were shown', async () => {
    const { runner, ended } = setup(['a']);
    await runner.start(tour);
    await runner.next();
    await runner.next();
    expect(ended).toEqual([['demo', 'completed']]);
  });

  it('closes as skipped when no step can be shown at all', async () => {
    const targeted: TourDefinition = {
      id: 'ghost',
      steps: [
        { id: 'x', icon: 'mdi-circle', target: 'x' },
        { id: 'y', icon: 'mdi-circle', target: 'y' },
      ],
    };
    const { runner, ended } = setup([]);
    await runner.start(targeted);
    expect(ended).toEqual([['ghost', 'skipped']]);
    expect(runner.running).toBe(false);
  });
});

describe('tour runner: skipping', () => {
  it('records skipped at any step and allows a new start', async () => {
    const { runner, ended } = setup();
    await runner.start(tour);
    await runner.next();
    runner.skip();
    expect(ended).toEqual([['demo', 'skipped']]);
    expect(runner.running).toBe(false);
    await runner.start(tour);
    expect(runner.step?.id).toBe('intro');
  });

  it('ignores the late target of a transition cancelled by skip', async () => {
    const ended: [string, TourStatus][] = [];
    const pending: { resolve: (value: HTMLElement | null) => void }[] = [];
    const runner = createTourRunner({
      findTarget: (target) =>
        target === 'late'
          ? new Promise((resolve) => {
              pending.push({ resolve });
            })
          : Promise.resolve(el(target)),
      navigate: async () => {},
      onEnd: (id, outcome) => ended.push([id, outcome]),
    });
    await runner.start({
      id: 'late-tour',
      steps: [
        { id: 'one', icon: 'mdi-circle', target: 'one' },
        { id: 'two', icon: 'mdi-circle', target: 'late' },
      ],
    });
    const moving = runner.next();
    await Promise.resolve();
    runner.skip();
    pending[0]?.resolve(el('late'));
    await moving;
    expect(ended).toEqual([['late-tour', 'skipped']]);
    expect(runner.running).toBe(false);
    expect(runner.state.element).toBeNull();
  });
});
