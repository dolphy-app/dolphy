import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  DeepPartial,
  EngineEvent,
  LearningEngine,
  SchedulerOptionsDto,
} from '@lms/engine-contract';
import {
  applySchedulerPatch,
  DEFAULT_SCHEDULER_OPTIONS,
} from '@lms/engine/scheduler';
import {
  toLearningForm,
  toSchedulerPatch,
  useLearningSettings,
} from '@/pages/settings/model/learning.ts';

const defaults = (): SchedulerOptionsDto =>
  structuredClone(DEFAULT_SCHEDULER_OPTIONS);

const createFakeEngine = (initial: SchedulerOptionsDto = defaults()) => {
  let current = initial;
  const patches: DeepPartial<SchedulerOptionsDto>[] = [];
  const listeners = new Set<(event: EngineEvent) => void>();
  let failWith: Error | null = null;

  const engine = {
    settings: {
      getScheduler: async () => structuredClone(current),
      setScheduler: async (patch: DeepPartial<SchedulerOptionsDto>) => {
        patches.push(patch);
        if (failWith) throw failWith;
        current = applySchedulerPatch(current, patch);
        return structuredClone(current);
      },
      resetScheduler: async () => {
        current = defaults();
        return structuredClone(current);
      },
    },
    subscribe: (listener: (event: EngineEvent) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  } as unknown as LearningEngine;

  return {
    engine,
    patches,
    failNext: (error: Error) => {
      failWith = error;
    },
    emit: (event: EngineEvent) =>
      listeners.forEach((listener) => listener(event)),
    changeElsewhere: (patch: DeepPartial<SchedulerOptionsDto>) => {
      current = applySchedulerPatch(current, patch);
    },
  };
};

const mount = (engine: LearningEngine) => {
  const scope = effectScope();
  const settings = scope.run(() => useLearningSettings(engine))!;
  return { settings, stop: () => scope.stop() };
};

const MICROTASK_ROUNDS = 10;

/** Досуха выполняет цепочки промисов и `queueMicrotask` без таймеров. */
const flush = async () => {
  for (let round = 0; round < MICROTASK_ROUNDS; round++)
    await Promise.resolve();
};

describe('learning form conversion', () => {
  it('shows fractions as whole percents', () => {
    const form = toLearningForm(defaults());
    expect(form.targetRetentionPercent).toBe(90);
    expect(form.minNewFractionPercent).toBe(25);
  });

  it('builds a patch from changed fields only and converts percents back', () => {
    const saved = toLearningForm(defaults());
    const form = {
      ...saved,
      targetRetentionPercent: 85,
      batchSize: 20,
      failThreshold: 3,
      implicitCreditEnabled: true,
    };
    expect(toSchedulerPatch(form, saved)).toEqual({
      plan: { targetRetention: 0.85 },
      remediation: { failThreshold: 3 },
      batchSize: 20,
      implicitCredit: { enabled: true },
    });
    expect(toSchedulerPatch(saved, saved)).toEqual({});
  });

  it('does not rewrite a value that rounds to the same percent', () => {
    const options = defaults();
    options.plan.targetRetention = 0.905;
    const saved = toLearningForm(options);
    const form = { ...saved, batchSize: 10 };
    expect(toSchedulerPatch(form, saved)).toEqual({ batchSize: 10 });
  });
});

describe('useLearningSettings', () => {
  it('loads the engine options and tracks a dirty draft', async () => {
    const fake = createFakeEngine();
    const { settings } = mount(fake.engine);
    await flush();
    expect(settings.form.value?.batchSize).toBe(50);
    expect(settings.isDirty.value).toBe(false);

    settings.form.value!.batchSize = 30;
    expect(settings.isDirty.value).toBe(true);
    settings.revert();
    expect(settings.form.value?.batchSize).toBe(50);
    expect(settings.isDirty.value).toBe(false);
  });

  it('saves only what changed and adopts the engine result', async () => {
    const fake = createFakeEngine();
    const { settings } = mount(fake.engine);
    await flush();
    settings.form.value!.minNewFractionPercent = 40;
    await settings.save();
    expect(fake.patches).toEqual([{ plan: { minNewFraction: 0.4 } }]);
    expect(settings.isDirty.value).toBe(false);
    expect(settings.form.value?.minNewFractionPercent).toBe(40);
  });

  it('keeps the draft and shows the engine message when saving fails', async () => {
    const fake = createFakeEngine();
    const { settings } = mount(fake.engine);
    await flush();
    settings.form.value!.batchSize = 1;
    fake.failNext(new Error('Invalid scheduler options: batch size'));
    await settings.save();
    expect(settings.error.value).toBe('Invalid scheduler options: batch size');
    expect(settings.form.value?.batchSize).toBe(1);
    expect(settings.isDirty.value).toBe(true);
  });

  it('resets to the engine defaults', async () => {
    const fake = createFakeEngine();
    fake.changeElsewhere({ batchSize: 7 });
    const { settings } = mount(fake.engine);
    await flush();
    expect(settings.form.value?.batchSize).toBe(7);
    await settings.resetToDefaults();
    expect(settings.form.value?.batchSize).toBe(50);
  });

  it('picks up a change made elsewhere unless the draft is being edited', async () => {
    const fake = createFakeEngine();
    const { settings } = mount(fake.engine);
    await flush();

    fake.changeElsewhere({ batchSize: 7 });
    fake.emit({ type: 'settings-changed', scope: 'scheduler' });
    await flush();
    expect(settings.form.value?.batchSize).toBe(7);

    settings.form.value!.maxLessonsInProgress = 4;
    fake.changeElsewhere({ batchSize: 9 });
    fake.emit({ type: 'settings-changed', scope: 'scheduler' });
    await flush();
    expect(settings.form.value?.batchSize).toBe(7);
    expect(settings.form.value?.maxLessonsInProgress).toBe(4);
  });
});
