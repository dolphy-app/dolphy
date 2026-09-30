/** Чистая логика вида `lms.choice`: без DOM и без зависимостей от хоста. */
import type { GradeResult } from '@lms/extension-api';

export interface ChoiceSpec {
  options: string[];
  correct: number[];
  multiple?: boolean;
}

export interface ChoiceView {
  multiple: boolean;
  options: string[];
}

/** Публичный вид: без `correct`. */
export const project = (spec: ChoiceSpec): ChoiceView => ({
  multiple: spec.multiple === true,
  options: spec.options,
});

export const grade = (
  spec: ChoiceSpec,
  answer: readonly number[],
  authorMode: boolean,
): GradeResult => {
  const { options, correct } = spec;
  const multiple = spec.multiple === true;
  if (
    correct.some((index) => index >= options.length) ||
    (!multiple && correct.length !== 1)
  ) {
    return {
      outcome: 'error',
      reason: 'invalid_spec',
      feedback: 'Exercise spec is inconsistent.',
    };
  }
  if (
    answer.some((index) => index >= options.length) ||
    (!multiple && answer.length !== 1)
  ) {
    return { outcome: 'failed', reason: 'invalid_answer' };
  }
  const expected = new Set(correct);
  if (
    answer.length === expected.size &&
    answer.every((index) => expected.has(index))
  ) {
    return { outcome: 'passed' };
  }
  return {
    outcome: 'failed',
    reason: 'mismatch',
    ...(authorMode && {
      detail: `expected: ${[...correct].sort((a, b) => a - b).join(', ')}`,
    }),
  };
};
