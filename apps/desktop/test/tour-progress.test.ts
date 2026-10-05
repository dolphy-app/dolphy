import { describe, expect, it, vi } from 'vitest';
import type {
  LearningEngine,
  UiSettingsDto,
} from '@dolphy-app/engine-contract';
import { createTourProgress } from '@/features/onboarding-tour/model/tour-progress.ts';

const engineWith = (ui: Partial<UiSettingsDto> | Error) => {
  const setUi = vi.fn(async () => ({ theme: 'system', locale: 'system' }));
  const getUi = vi.fn(async () => {
    if (ui instanceof Error) throw ui;
    return { theme: 'system', locale: 'system', ...ui } as UiSettingsDto;
  });
  const engine = { settings: { getUi, setUi } } as unknown as LearningEngine;
  return { engine, getUi, setUi };
};

describe('tour progress', () => {
  it('reads the stored outcomes once', async () => {
    const { engine, getUi } = engineWith({ tours: { welcome: 'completed' } });
    const progress = createTourProgress(engine);
    expect(progress.loaded.value).toBe(false);
    await Promise.all([progress.hydrate(), progress.hydrate()]);
    expect(progress.statuses).toEqual({ welcome: 'completed' });
    expect(progress.loaded.value).toBe(true);
    expect(getUi).toHaveBeenCalledOnce();
  });

  it('records an outcome by key and writes only that key', async () => {
    const { engine, setUi } = engineWith({});
    const progress = createTourProgress(engine);
    await progress.hydrate();
    await progress.record('welcome', 'skipped');
    expect(progress.statuses).toEqual({ welcome: 'skipped' });
    expect(setUi).toHaveBeenCalledExactlyOnceWith({
      tours: { welcome: 'skipped' },
    });
  });

  it('keeps the outcome in memory when the engine refuses the write', async () => {
    const { engine, setUi } = engineWith({});
    setUi.mockRejectedValueOnce(new Error('disk full'));
    const progress = createTourProgress(engine);
    await progress.hydrate();
    await expect(
      progress.record('welcome', 'completed'),
    ).resolves.toBeUndefined();
    expect(progress.statuses).toEqual({ welcome: 'completed' });
  });

  it('an outcome recorded before the engine answered is not overwritten by the stored one', async () => {
    const { engine } = engineWith({ tours: { welcome: 'skipped' } });
    const progress = createTourProgress(engine);
    const pending = progress.hydrate();
    await progress.record('welcome', 'completed');
    await pending;
    expect(progress.statuses.welcome).toBe('completed');
  });

  it('a failed read leaves no outcomes but unlocks offering', async () => {
    const { engine } = engineWith(new Error('offline'));
    const progress = createTourProgress(engine);
    await progress.hydrate();
    expect(progress.statuses).toEqual({});
    expect(progress.loaded.value).toBe(true);
  });
});
