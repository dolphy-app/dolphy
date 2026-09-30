import type {
  DeepPartial,
  LearningSettingsDto,
  PreferencesDto,
  SchedulerOptionsDto,
  SettingsService,
  UiSettingsDto,
  UiSettingsPatch,
} from '@dolphy-app/engine-contract';
import type { UserPreferences } from '../../domain/manifest.ts';
import { isGradePolicyId } from '../../domain/learning-settings.ts';
import { isLocaleMode, isThemeId, isUnitId } from '../../domain/ui-settings.ts';
import {
  InvalidSchedulerOptionsError,
  applySchedulerPatch,
  createSchedulerOptions,
  diffSchedulerOptions,
  verifySchedulerOptions,
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
 * `ctx.options` (общий источник для всех компонентов), а их отличия от
 * умолчаний и остальные настройки — в хранилище настроек (в продукте —
 * `engine.db`). Ошибки хранилища не перехватываются.
 */
export const createSettingsService = (ctx: EngineContext): SettingsService => {
  const validated = (work: () => SchedulerOptionsDto): SchedulerOptionsDto => {
    try {
      return work();
    } catch (error) {
      if (error instanceof InvalidSchedulerOptionsError) {
        throw invalidIssues(error.issues);
      }
      throw error;
    }
  };

  /** Отличия опций от умолчаний (с учётом предпочтений) → хранилище. */
  const persistOverrides = async (options: SchedulerOptionsDto) => {
    const { scheduler } = await ctx.settings.loadPreferences();
    const baseline = createSchedulerOptions({
      batchSize: scheduler?.batch_size ?? null,
    });
    await ctx.settings.saveSchedulerOverrides(
      diffSchedulerOptions(baseline, options),
    );
  };

  const publish = (
    before: SchedulerOptionsDto,
    after: SchedulerOptionsDto,
  ): SchedulerOptionsDto => {
    if (!sameDerivedOptions(before, after)) ctx.invalidateDerived();
    ctx.emit({ type: 'settings-changed', scope: 'scheduler' });
    return structuredClone(after);
  };

  const setScheduler = async (patch: DeepPartial<SchedulerOptionsDto>) => {
    const before = ctx.options.get();
    const candidate = validated(() => {
      const next = applySchedulerPatch(before, patch);
      verifySchedulerOptions(next);
      return next;
    });
    // сначала хранилище: отказ записи не должен менять живые опции
    await persistOverrides(candidate);
    return publish(before, ctx.options.set(patch));
  };

  const resetScheduler = async () => {
    const before = ctx.options.get();
    await ctx.settings.saveSchedulerOverrides({});
    return publish(before, ctx.options.reset());
  };

  const setLearning = async (
    patch: Partial<LearningSettingsDto>,
  ): Promise<LearningSettingsDto> => {
    if (
      patch.gradePolicy !== undefined &&
      !isGradePolicyId(patch.gradePolicy)
    ) {
      throw new EngineError('INVALID_ARGUMENT', {
        message: `Invalid grade policy id: ${String(patch.gradePolicy)}`,
        details: { field: 'gradePolicy' },
      });
    }
    const next: LearningSettingsDto = {
      ...ctx.learning,
      ...(patch.gradePolicy !== undefined && {
        gradePolicy: patch.gradePolicy,
      }),
    };
    // сначала хранилище: отказ записи не должен менять живую настройку
    await ctx.settings.saveLearning(next);
    ctx.learning.gradePolicy = next.gradePolicy;
    ctx.emit({ type: 'settings-changed', scope: 'learning' });
    return { ...next };
  };

  const setUi = async (patch: UiSettingsPatch) => {
    if (patch.theme !== undefined && !isThemeId(patch.theme)) {
      throw new EngineError('INVALID_ARGUMENT', {
        message: `Invalid theme: ${String(patch.theme)}`,
        details: { field: 'theme' },
      });
    }
    if (patch.locale !== undefined && !isLocaleMode(patch.locale)) {
      throw new EngineError('INVALID_ARGUMENT', {
        message: `Invalid locale: ${String(patch.locale)}`,
        details: { field: 'locale' },
      });
    }
    const { activeCourseId } = patch;
    if (
      activeCourseId !== undefined &&
      activeCourseId !== null &&
      !isUnitId(activeCourseId)
    ) {
      throw new EngineError('INVALID_ARGUMENT', {
        message: 'activeCourseId must be a non-empty string or null',
        details: { field: 'activeCourseId' },
      });
    }
    const current = await ctx.settings.loadUi();
    const focus =
      activeCourseId === undefined ? current.activeCourseId : activeCourseId;
    const next: UiSettingsDto = {
      theme: patch.theme ?? current.theme,
      locale: patch.locale ?? current.locale,
      ...(focus !== undefined && focus !== null && { activeCourseId: focus }),
    };
    await ctx.settings.saveUi(next);
    ctx.emit({ type: 'settings-changed', scope: 'ui' });
    return next;
  };

  return {
    getScheduler: async () => structuredClone(ctx.options.get()),
    setScheduler,
    resetScheduler,
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
    getUi: async () => ctx.settings.loadUi(),
    setUi,
    getLearning: async () => ({ ...ctx.learning }),
    setLearning,
  };
};
