import {
  BUILTIN_GRADE_POLICY,
  GRADE_POLICY_ID_PATTERN,
  type LearningSettingsDto,
} from '@spirula-app/engine-contract';

export const MAX_GRADE_POLICY_ID_LENGTH = 64;

export const DEFAULT_LEARNING_SETTINGS: Readonly<LearningSettingsDto> =
  Object.freeze({ gradePolicy: BUILTIN_GRADE_POLICY });

/** Встроенное правило или id правила расширения; существование правила не проверяется. */
export const isGradePolicyId = (value: unknown): value is string =>
  typeof value === 'string' &&
  (value === BUILTIN_GRADE_POLICY ||
    (value.length <= MAX_GRADE_POLICY_ID_LENGTH &&
      GRADE_POLICY_ID_PATTERN.test(value)));

/**
 * Сохранённое значение → настройки обучения: неизвестные поля отбрасываются,
 * неверные и недостающие заменяются умолчаниями, чтобы запуск не ломался.
 */
export const decodeLearningSettings = (raw: unknown): LearningSettingsDto => {
  const gradePolicy =
    typeof raw === 'object' && raw !== null
      ? Reflect.get(raw, 'gradePolicy')
      : undefined;
  return {
    gradePolicy: isGradePolicyId(gradePolicy)
      ? gradePolicy
      : DEFAULT_LEARNING_SETTINGS.gradePolicy,
  };
};
