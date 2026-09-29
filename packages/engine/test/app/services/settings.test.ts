import type { EngineEvent } from '@lms/engine-contract';
import { buildLibrary } from '@lms/testkit';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCHEDULER_OPTIONS } from '../../../src/scheduler/options.ts';
import {
  SettingsStoreError,
  createMemorySettingsStore,
} from '../../../src/node/index.ts';
import type { UserPreferences } from '../../../src/domain/manifest.ts';
import { createTestEngine } from '../../helpers/engine.ts';

const library = () =>
  buildLibrary({
    courses: [{ id: 'a', lessons: [{ id: 'l0', exercises: 6 }] }],
  });

const open = (options: Parameters<typeof createTestEngine>[0] = {}) =>
  createTestEngine({ library: library(), ...options });

const changed = (events: readonly EngineEvent[], scope: string) =>
  events.filter(
    (event) => event.type === 'settings-changed' && event.scope === scope,
  );

const preferencesWith = (
  overrides: Partial<UserPreferences>,
): UserPreferences => ({
  scheduler: null,
  ignored_paths: [],
  transcription: null,
  ...overrides,
});

describe('settings scheduler options', () => {
  it('starts from the defaults and returns a copy', async () => {
    const { engine } = await open();
    const options = await engine.settings.getScheduler();
    expect(options).toEqual(DEFAULT_SCHEDULER_OPTIONS);
    options.batchSize = 1;
    options.masteryWindows.new.range[1] = 9;
    expect(await engine.settings.getScheduler()).toEqual(
      DEFAULT_SCHEDULER_OPTIONS,
    );
  });

  it('setScheduler merges a nested patch, returns the result and sends one event', async () => {
    const { engine, events } = await open();
    const result = await engine.settings.setScheduler({
      numTrials: 5,
      passingScore: { minScore: 3.5 },
    });
    expect(result).toEqual({
      ...DEFAULT_SCHEDULER_OPTIONS,
      numTrials: 5,
      passingScore: {
        ...DEFAULT_SCHEDULER_OPTIONS.passingScore,
        minScore: 3.5,
      },
    });
    expect(await engine.settings.getScheduler()).toEqual(result);
    expect(changed(events, 'scheduler')).toHaveLength(1);
  });

  it('a change reaches the components at once', async () => {
    const { engine } = await open();
    expect((await engine.practice.getBatch()).exercises).toHaveLength(6);
    await engine.settings.setScheduler({ batchSize: 2 });
    const shrunk = (await engine.practice.getBatch()).exercises;
    expect(shrunk.length).toBeGreaterThan(0);
    expect(shrunk.length).toBeLessThanOrEqual(2);
  });

  it('invalid options are INVALID_ARGUMENT with issues and change nothing (atomic)', async () => {
    const { engine, ctx, events } = await open();
    const invalidate = vi.spyOn(ctx, 'invalidateDerived');
    const before = await engine.settings.getScheduler();
    const error = await engine.settings
      .setScheduler({ numTrials: 7, batchSize: 0 })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: 'INVALID_ARGUMENT',
      retryable: false,
      details: { issues: expect.arrayContaining([expect.any(String)]) },
    });
    expect(await engine.settings.getScheduler()).toEqual(before);
    expect(invalidate).not.toHaveBeenCalled();
    expect(changed(events, 'scheduler')).toEqual([]);

    await expect(
      engine.settings.setScheduler({
        masteryWindows: { target: { percentage: 0.9 } },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await engine.settings.getScheduler()).toEqual(before);
  });

  it('resets derived state only when options that feed scores change', async () => {
    const { engine, ctx } = await open();
    const invalidate = vi.spyOn(ctx, 'invalidateDerived');
    await engine.settings.setScheduler({ batchSize: 10, relearnFraction: 0.2 });
    expect(invalidate).not.toHaveBeenCalled();
    await engine.settings.setScheduler({ implicitCredit: { enabled: true } });
    expect(invalidate).toHaveBeenCalledTimes(1);
    await engine.settings.setScheduler({ numTrials: 5 });
    expect(invalidate).toHaveBeenCalledTimes(2);
    await engine.settings.setScheduler({ implicitCredit: { enabled: true } });
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('resetScheduler returns to the options the engine started with', async () => {
    const settings = createMemorySettingsStore({
      preferences: preferencesWith({ scheduler: { batch_size: 10 } }),
    });
    const { engine, ctx, events } = await open({ settings });
    expect((await engine.settings.getScheduler()).batchSize).toBe(10);
    await engine.settings.setScheduler({
      batchSize: 20,
      implicitCredit: { enabled: true },
    });
    const invalidate = vi.spyOn(ctx, 'invalidateDerived');
    const reset = await engine.settings.resetScheduler();
    expect(reset).toEqual({ ...DEFAULT_SCHEDULER_OPTIONS, batchSize: 10 });
    expect(await engine.settings.getScheduler()).toEqual(reset);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(changed(events, 'scheduler')).toHaveLength(2);
  });
});

describe('settings preferences', () => {
  it('start empty and roundtrip', async () => {
    const { engine, events } = await open();
    const empty = await engine.settings.getPreferences();
    expect(empty).toEqual({ ignoredPaths: [] });
    expect('schedulerBatchSize' in empty).toBe(false);

    const prefs = { ignoredPaths: ['x', 'y/z'], schedulerBatchSize: 30 };
    await engine.settings.setPreferences(prefs);
    expect(await engine.settings.getPreferences()).toEqual(prefs);
    expect(changed(events, 'preferences')).toHaveLength(1);
  });

  it('restartRequired only when the batch size changes', async () => {
    const { engine } = await open();
    const set = engine.settings.setPreferences;
    expect(await set({ ignoredPaths: [], schedulerBatchSize: 30 })).toEqual({
      restartRequired: true,
    });
    expect(await set({ ignoredPaths: [], schedulerBatchSize: 30 })).toEqual({
      restartRequired: false,
    });
    expect(await set({ ignoredPaths: ['x'], schedulerBatchSize: 30 })).toEqual({
      restartRequired: false,
    });
    expect(await set({ ignoredPaths: ['x'], schedulerBatchSize: 31 })).toEqual({
      restartRequired: true,
    });
    expect(await set({ ignoredPaths: ['x'] })).toEqual({
      restartRequired: true,
    });
    expect(await engine.settings.getPreferences()).toEqual({
      ignoredPaths: ['x'],
    });
    expect(await set({ ignoredPaths: [] })).toEqual({ restartRequired: false });
  });

  it('a new batch size applies at the next start, not to the running engine', async () => {
    const settings = createMemorySettingsStore();
    const first = await open({ settings });
    await first.engine.settings.setPreferences({
      ignoredPaths: [],
      schedulerBatchSize: 3,
    });
    expect((await first.engine.settings.getScheduler()).batchSize).toBe(50);
    const second = await open({ settings });
    expect((await second.engine.settings.getScheduler()).batchSize).toBe(3);
  });

  it('rejects invalid values and saves nothing', async () => {
    const { engine, settings, events } = await open();
    const invalid = [
      { ignoredPaths: [], schedulerBatchSize: 0 },
      { ignoredPaths: [], schedulerBatchSize: 1.5 },
      { ignoredPaths: 'x' as unknown as string[] },
      { ignoredPaths: [1] as unknown as string[] },
    ];
    for (const prefs of invalid) {
      await expect(engine.settings.setPreferences(prefs)).rejects.toMatchObject(
        { code: 'INVALID_ARGUMENT' },
      );
    }
    expect((await settings.loadPreferences()).ignored_paths).toEqual([]);
    expect(changed(events, 'preferences')).toEqual([]);
  });

  it('keeps the fields of the preferences file that the engine does not manage', async () => {
    const transcription = {
      instruments: [{ id: 'g', name: 'Guitar' }],
      download_path: '/tmp/d',
      download_path_alias: null,
    };
    const settings = createMemorySettingsStore({
      preferences: preferencesWith({ transcription }),
    });
    const { engine } = await open({ settings });
    await engine.settings.setPreferences({ ignoredPaths: ['q'] });
    expect(await settings.loadPreferences()).toMatchObject({
      ignored_paths: ['q'],
      transcription,
    });
  });

  it('store failures are not swallowed', async () => {
    const failure = new SettingsStoreError('cannot write', '/x');
    const settings = {
      ...createMemorySettingsStore(),
      savePreferences: async () => {
        throw failure;
      },
    };
    const { engine, events, logs } = await open({ settings });
    await expect(
      engine.settings.setPreferences({ ignoredPaths: ['x'] }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(logs.length).toBeGreaterThan(0);
    expect(changed(events, 'preferences')).toEqual([]);
  });
});

describe('settings.getScorer', () => {
  it('describes the scorer with numTrials from the current options', async () => {
    const { engine, ctx } = await open();
    const info = await engine.settings.getScorer();
    expect(info).toEqual({
      kind: 'fsrs-hybrid',
      memoryModelId: ctx.memoryModel.id,
      ratingMap: 'runner',
      numTrials: 20,
      parametersHash: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
    await engine.settings.setScheduler({ numTrials: 5 });
    expect(await engine.settings.getScorer()).toEqual({
      ...info,
      numTrials: 5,
    });
  });
});
