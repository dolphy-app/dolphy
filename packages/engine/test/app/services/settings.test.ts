import type { EngineEvent } from '@spirula/engine-contract';
import { buildLibrary } from '@spirula/testkit';
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

describe('settings persistence', () => {
  it('scheduler changes survive a restart and reset clears them', async () => {
    const settings = createMemorySettingsStore();
    const first = await open({ settings });
    await first.engine.settings.setScheduler({
      batchSize: 7,
      passingScore: { minScore: 3.5 },
    });
    await first.engine.settings.setScheduler({ numTrials: 5 });

    const second = await open({ settings });
    expect(await second.engine.settings.getScheduler()).toEqual({
      ...DEFAULT_SCHEDULER_OPTIONS,
      batchSize: 7,
      numTrials: 5,
      passingScore: {
        ...DEFAULT_SCHEDULER_OPTIONS.passingScore,
        minScore: 3.5,
      },
    });

    await second.engine.settings.resetScheduler();
    const third = await open({ settings });
    expect(await third.engine.settings.getScheduler()).toEqual(
      DEFAULT_SCHEDULER_OPTIONS,
    );
  });

  it('stores only what differs from the defaults', async () => {
    const { engine, settings } = await open();
    await engine.settings.setScheduler({ batchSize: 7, numTrials: 5 });
    await engine.settings.setScheduler({
      numTrials: DEFAULT_SCHEDULER_OPTIONS.numTrials,
    });
    expect(await settings.loadSchedulerOverrides()).toEqual({ batchSize: 7 });
  });

  it('an invalid patch is not persisted', async () => {
    const { engine, settings } = await open();
    await engine.settings.setScheduler({ batchSize: 7 });
    await expect(
      engine.settings.setScheduler({ batchSize: 0 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await settings.loadSchedulerOverrides()).toEqual({ batchSize: 7 });
  });

  it('a failed write leaves the running options unchanged', async () => {
    const failure = new SettingsStoreError('cannot write', '/x');
    const settings = {
      ...createMemorySettingsStore(),
      saveSchedulerOverrides: async () => {
        throw failure;
      },
    };
    const { engine, events } = await open({ settings });
    await expect(
      engine.settings.setScheduler({ batchSize: 7 }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(await engine.settings.getScheduler()).toEqual(
      DEFAULT_SCHEDULER_OPTIONS,
    );
    expect(changed(events, 'scheduler')).toEqual([]);
  });

  it('saved values that no longer verify do not stop the engine', async () => {
    const settings = createMemorySettingsStore({
      schedulerOverrides: { batchSize: 0 },
    });
    const { engine, logs } = await open({ settings });
    expect(await engine.settings.getScheduler()).toEqual(
      DEFAULT_SCHEDULER_OPTIONS,
    );
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe('settings ui', () => {
  it('starts with system theme and language and round-trips a change with an event', async () => {
    const { engine, events } = await open();
    expect(await engine.settings.getUi()).toEqual({
      theme: 'system',
      locale: 'system',
    });
    expect(await engine.settings.setUi({ theme: 'dark' })).toEqual({
      theme: 'dark',
      locale: 'system',
    });
    expect(await engine.settings.setUi({ locale: 'en' })).toEqual({
      theme: 'dark',
      locale: 'en',
    });
    expect(await engine.settings.getUi()).toEqual({
      theme: 'dark',
      locale: 'en',
    });
    expect(changed(events, 'ui')).toHaveLength(2);
  });

  it('an empty patch keeps the saved values', async () => {
    const settings = createMemorySettingsStore({
      ui: { theme: 'light', locale: 'ru' },
    });
    const { engine } = await open({ settings });
    expect(await engine.settings.setUi({})).toEqual({
      theme: 'light',
      locale: 'ru',
    });
  });

  it('the active course is kept until it is cleared with null', async () => {
    const { engine, settings } = await open();
    expect(await engine.settings.setUi({ activeCourseId: 'k' })).toEqual({
      theme: 'system',
      locale: 'system',
      activeCourseId: 'k',
    });
    // другие поля не трогают фокус
    expect(await engine.settings.setUi({ theme: 'dark' })).toMatchObject({
      activeCourseId: 'k',
    });
    expect(await settings.loadUi()).toMatchObject({ activeCourseId: 'k' });
    expect(await engine.settings.setUi({ activeCourseId: null })).toEqual({
      theme: 'dark',
      locale: 'system',
    });
  });

  it('rejects an empty active course id and saves nothing', async () => {
    const { engine, settings } = await open();
    await expect(
      engine.settings.setUi({ activeCourseId: '' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await settings.loadUi()).toEqual({
      theme: 'system',
      locale: 'system',
    });
  });

  it('accepts the id of a contributed theme without checking it exists', async () => {
    const { engine } = await open();
    expect(await engine.settings.setUi({ theme: 'acme.midnight' })).toEqual({
      theme: 'acme.midnight',
      locale: 'system',
    });
    await expect(
      engine.settings.setUi({ theme: `a${'b'.repeat(64)}` }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects an unknown theme or language and saves nothing', async () => {
    const { engine, settings, events } = await open();
    await expect(
      engine.settings.setUi({ theme: 'Sepia!' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      engine.settings.setUi({ theme: 'dark', locale: 'de' as 'en' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await settings.loadUi()).toEqual({
      theme: 'system',
      locale: 'system',
    });
    expect(changed(events, 'ui')).toEqual([]);
  });
});

describe('settings learning', () => {
  it('defaults to passAtN; a change is stored, returned and announced', async () => {
    const { engine, events, settings } = await open();
    expect(await engine.settings.getLearning()).toEqual({
      gradePolicy: 'passAtN',
    });
    expect(
      await engine.settings.setLearning({
        gradePolicy: 'acme.policy.generous',
      }),
    ).toEqual({ gradePolicy: 'acme.policy.generous' });
    expect(await engine.settings.getLearning()).toEqual({
      gradePolicy: 'acme.policy.generous',
    });
    expect(await settings.loadLearning()).toEqual({
      gradePolicy: 'acme.policy.generous',
    });
    expect(changed(events, 'learning')).toHaveLength(1);
    expect(await engine.settings.setLearning({})).toEqual({
      gradePolicy: 'acme.policy.generous',
    });
  });

  it('reads the saved choice on open, even when no extension provides the policy', async () => {
    const settings = createMemorySettingsStore({
      learning: { gradePolicy: 'gone.policy' },
    });
    const { engine } = await open({ settings });
    expect(await engine.settings.getLearning()).toEqual({
      gradePolicy: 'gone.policy',
    });
  });

  it.each(['Bad Id', 'acme.', 'A', 'x'.repeat(65), ''])(
    'rejects the malformed id %j and keeps the stored value',
    async (gradePolicy) => {
      const { engine, events, settings } = await open();
      await expect(
        engine.settings.setLearning({ gradePolicy }),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(await settings.loadLearning()).toEqual({
        gradePolicy: 'passAtN',
      });
      expect(changed(events, 'learning')).toEqual([]);
    },
  );

  it('a failed write keeps the live setting', async () => {
    const settings = createMemorySettingsStore();
    const { engine } = await open({
      settings: {
        ...settings,
        saveLearning: async () => {
          throw new SettingsStoreError('cannot write', 'x');
        },
      },
    });
    await expect(
      engine.settings.setLearning({ gradePolicy: 'acme.policy' }),
    ).rejects.toThrow();
    expect(await engine.settings.getLearning()).toEqual({
      gradePolicy: 'passAtN',
    });
  });
});
