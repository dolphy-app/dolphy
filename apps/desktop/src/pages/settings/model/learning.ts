import { computed, onScopeDispose, ref } from 'vue';
import type {
  DeepPartial,
  LearningEngine,
  SchedulerOptionsDto,
} from '@dolphy-app/engine-contract';

const PERCENT = 100;

/** Поля формы «Обучение»: проценты — целые, как их видит ученик. */
export interface LearningForm {
  targetRetentionPercent: number;
  minNewFractionPercent: number;
  maxSameCourseRun: number;
  minTagDistance: number;
  batchSize: number;
  maxLessonsInProgress: number;
  failThreshold: number;
  remediationMaxItems: number;
  implicitCreditEnabled: boolean;
}

const toPercent = (fraction: number) => Math.round(fraction * PERCENT);
const fromPercent = (percent: number) => percent / PERCENT;

export const toLearningForm = (options: SchedulerOptionsDto): LearningForm => ({
  targetRetentionPercent: toPercent(options.plan.targetRetention),
  minNewFractionPercent: toPercent(options.plan.minNewFraction),
  maxSameCourseRun: options.plan.maxSameCourseRun,
  minTagDistance: options.plan.minTagDistance,
  batchSize: options.batchSize,
  maxLessonsInProgress: options.maxLessonsInProgress,
  failThreshold: options.remediation.failThreshold,
  remediationMaxItems: options.remediation.maxItems,
  implicitCreditEnabled: options.implicitCredit.enabled,
});

/**
 * Патч только по изменённым полям: значение, которое ученик не трогал,
 * не перезаписывается округлённым процентом из формы.
 */
export const toSchedulerPatch = (
  form: LearningForm,
  saved: LearningForm,
): DeepPartial<SchedulerOptionsDto> => {
  const changed = <K extends keyof LearningForm>(key: K) =>
    form[key] !== saved[key];
  const plan: NonNullable<DeepPartial<SchedulerOptionsDto>['plan']> = {};
  if (changed('targetRetentionPercent')) {
    plan.targetRetention = fromPercent(form.targetRetentionPercent);
  }
  if (changed('minNewFractionPercent')) {
    plan.minNewFraction = fromPercent(form.minNewFractionPercent);
  }
  if (changed('maxSameCourseRun'))
    plan.maxSameCourseRun = form.maxSameCourseRun;
  if (changed('minTagDistance')) plan.minTagDistance = form.minTagDistance;

  const remediation: NonNullable<
    DeepPartial<SchedulerOptionsDto>['remediation']
  > = {};
  if (changed('failThreshold')) remediation.failThreshold = form.failThreshold;
  if (changed('remediationMaxItems')) {
    remediation.maxItems = form.remediationMaxItems;
  }

  const patch: DeepPartial<SchedulerOptionsDto> = {};
  if (Object.keys(plan).length > 0) patch.plan = plan;
  if (Object.keys(remediation).length > 0) patch.remediation = remediation;
  if (changed('batchSize')) patch.batchSize = form.batchSize;
  if (changed('maxLessonsInProgress')) {
    patch.maxLessonsInProgress = form.maxLessonsInProgress;
  }
  if (changed('implicitCreditEnabled')) {
    patch.implicitCredit = { enabled: form.implicitCreditEnabled };
  }
  return patch;
};

const isSame = (a: LearningForm, b: LearningForm) =>
  Object.keys(toSchedulerPatch(a, b)).length === 0;

const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

/**
 * Опции планировщика хранит движок (в БД), форма держит только черновик.
 * Чужое изменение (событие `settings-changed`) подхватывается, если
 * черновик не правили.
 */
export const useLearningSettings = (engine: LearningEngine) => {
  const saved = ref<LearningForm | null>(null);
  const form = ref<LearningForm | null>(null);
  const busy = ref(false);
  const error = ref<string | null>(null);

  const adopt = (options: SchedulerOptionsDto) => {
    saved.value = toLearningForm(options);
    form.value = { ...saved.value };
  };

  const isDirty = computed(
    () => !!form.value && !!saved.value && !isSame(form.value, saved.value),
  );

  const guarded = async (action: () => Promise<void>) => {
    if (busy.value) return;
    busy.value = true;
    error.value = null;
    try {
      await action();
    } catch (caught) {
      error.value = errorText(caught);
    } finally {
      busy.value = false;
    }
  };

  const load = () =>
    guarded(async () => adopt(await engine.settings.getScheduler()));

  const save = () =>
    guarded(async () => {
      if (!form.value || !saved.value) return;
      adopt(
        await engine.settings.setScheduler(
          toSchedulerPatch(form.value, saved.value),
        ),
      );
    });

  const resetToDefaults = () =>
    guarded(async () => adopt(await engine.settings.resetScheduler()));

  const revert = () => {
    if (saved.value) form.value = { ...saved.value };
    error.value = null;
  };

  const unsubscribe = engine.subscribe((event) => {
    const isSchedulerChange =
      event.type === 'settings-changed' && event.scope === 'scheduler';
    // слушатель не вызывает команды синхронно (API §7)
    if (isSchedulerChange && !isDirty.value) queueMicrotask(() => void load());
  });
  onScopeDispose(unsubscribe);
  void load();

  return { form, busy, error, isDirty, save, revert, resetToDefaults };
};
