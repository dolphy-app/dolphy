import { computed, onMounted, ref } from 'vue';
import { BUILTIN_GRADE_POLICY } from '@dolphy-app/engine-contract';
import type {
  GradePolicyInfoDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';

export interface GradePolicyOption {
  id: string;
  /** `null` — встроенное правило: название переводит окно. */
  label: string | null;
  extensionId: string | null;
}

const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

/** Встроенное правило всегда первое; остальные — из вкладов расширений. */
export const toGradePolicyOptions = (
  policies: readonly GradePolicyInfoDto[],
): GradePolicyOption[] => [
  { id: BUILTIN_GRADE_POLICY, label: null, extensionId: null },
  ...policies
    .filter(({ id }) => id !== BUILTIN_GRADE_POLICY)
    .map(({ id, label, extensionId }) => ({ id, label, extensionId })),
];

/**
 * Правило оценки хранит движок. Сохранённый id, которого больше нет среди
 * вкладов (расширение убрали), не трогаем, но показываем как `passAtN` и
 * предупреждаем: именно его применит движок.
 */
export const useGradePolicySetting = (
  engine: LearningEngine,
  policies: readonly GradePolicyInfoDto[],
) => {
  const options = toGradePolicyOptions(policies);
  const saved = ref<string | null>(null);
  const error = ref<string | null>(null);
  const busy = ref(false);

  const missing = computed(
    () => saved.value !== null && !options.some(({ id }) => id === saved.value),
  );
  const effective = computed(() =>
    saved.value === null || missing.value ? BUILTIN_GRADE_POLICY : saved.value,
  );

  onMounted(async () => {
    try {
      saved.value = (await engine.settings.getLearning()).gradePolicy;
    } catch (caught) {
      error.value = errorText(caught);
    }
  });

  /** `null` шлёт переключатель при снятии выбора; правило обязательно. */
  const select = async (next: string | null) => {
    if (next === null || busy.value || next === saved.value) return;
    const previous = saved.value;
    saved.value = next;
    busy.value = true;
    error.value = null;
    try {
      saved.value = (
        await engine.settings.setLearning({ gradePolicy: next })
      ).gradePolicy;
    } catch (caught) {
      // не сохранилось — возвращаем прежний вид, чтобы экран не лгал
      saved.value = previous;
      error.value = errorText(caught);
    } finally {
      busy.value = false;
    }
  };

  return { options, effective, missing, saved, busy, error, select };
};
