import type {
  PreferencesDto,
  SchedulerOptionsDto,
  SettingsService,
} from '@lms/engine-contract';
import type { UserPreferences } from '../../domain/manifest.ts';
import {
  InvalidSchedulerOptionsError,
  createSchedulerOptions,
} from '../../scheduler/options.ts';
import type { EngineContext } from '../context.ts';
import { EngineError } from '../errors.ts';

/** Опции, от которых зависят кэшированные оценки и планы ремедиации. */
const DERIVED_OPTION_KEYS = [
  'implicitCredit',
  'numTrials',
  'numRewards',
  'supersedingScore',
  'passingScore',
  'remediation',
] as const satisfies readonly (keyof SchedulerOptionsDto)[];

const invalidIssues = (issues: readonly string[]) =>
  new EngineError('INVALID_ARGUMENT', {
    message: `Invalid scheduler options: ${issues.join('; ')}`,
    details: { issues: [...issues] },
  });

const sameDerivedOptions = (
  before: SchedulerOptionsDto,
  after: SchedulerOptionsDto,
) =>
  DERIVED_OPTION_KEYS.every(
    (key) => JSON.stringify(before[key]) === JSON.stringify(after[key]),
  );

const toPreferencesDto = (preferences: UserPreferences): PreferencesDto => {
  const batchSize = preferences.scheduler?.batch_size;
  return {
    ignoredPaths: [...preferences.ignored_paths],
    ...(batchSize === null || batchSize === undefined
      ? {}
      : { schedulerBatchSize: batchSize }),
  };
};

const validatePreferences = ({
  ignoredPaths,
  schedulerBatchSize,
}: PreferencesDto) => {
  if (
    !Array.isArray(ignoredPaths) ||
    ignoredPaths.some((path) => typeof path !== 'string')
  ) {
    throw new EngineError('INVALID_ARGUMENT', {
      message: 'ignoredPaths must be an array of strings',
      details: { field: 'ignoredPaths' },
    });
  }
  if (schedulerBatchSize === undefined) return;
  try {
    createSchedulerOptions({ batchSize: schedulerBatchSize });
  } catch (error) {
    if (error instanceof InvalidSchedulerOptionsError) {
      throw new EngineError('INVALID_ARGUMENT', {
        message: `Invalid schedulerBatchSize: ${error.issues.join('; ')}`,
        details: { field: 'schedulerBatchSize', issues: [...error.issues] },
      });
    }
    throw error;
  }
};

/**
 * `settings.*` (engine-ts-api.md §6): опции планировщика живут в
 * `ctx.options` (общий источник для всех компонентов), предпочтения — в
 * хранилище настроек. Ошибки хранилища не перехватываются.
 */
export const createSettingsService = (ctx: EngineContext): SettingsService => {
  const applyOptions = (
    change: () => SchedulerOptionsDto,
  ): SchedulerOptionsDto => {
    const before = ctx.options.get();
    let after: SchedulerOptionsDto;
    try {
      after = change();
    } catch (error) {
      if (error instanceof InvalidSchedulerOptionsError) {
        throw invalidIssues(error.issues);
      }
      throw error;
    }
    if (!sameDerivedOptions(before, after)) ctx.invalidateDerived();
    ctx.emit({ type: 'settings-changed', scope: 'scheduler' });
    return structuredClone(after);
  };

  return {
    getScheduler: async () => structuredClone(ctx.options.get()),
    setScheduler: async (patch) => applyOptions(() => ctx.options.set(patch)),
    resetScheduler: async () => applyOptions(() => ctx.options.reset()),
    getPreferences: async () =>
      toPreferencesDto(await ctx.settings.loadPreferences()),
    setPreferences: async (preferences) => {
      validatePreferences(preferences);
      const current = await ctx.settings.loadPreferences();
      const previousBatchSize = current.scheduler?.batch_size ?? undefined;
      const { ignoredPaths, schedulerBatchSize } = preferences;
      await ctx.settings.savePreferences({
        ...current,
        scheduler:
          schedulerBatchSize === undefined
            ? null
            : { batch_size: schedulerBatchSize },
        ignored_paths: [...ignoredPaths],
      });
      ctx.emit({ type: 'settings-changed', scope: 'preferences' });
      return { restartRequired: previousBatchSize !== schedulerBatchSize };
    },
    getScorer: async () => ({
      ...ctx.fsrs.info,
      numTrials: ctx.options.get().numTrials,
    }),
  };
};
