import { GradePolicyError } from '@lms/engine/ports';
import type { GradePolicies, GradePolicyInfo } from '@lms/engine/ports';
import type { GradeInput } from '@lms/engine/verify';

export interface FakeGradePolicy {
  label?: string;
  extensionId?: string;
  /** Результат правила; исключение уходит вызывающему как есть, значение не проверяется. */
  handler: (input: GradeInput) => unknown;
}

export interface FakeGradePolicies extends GradePolicies {
  /** Вызовы `evaluate` по порядку. */
  calls: { id: string; input: GradeInput }[];
}

/** Порт правил оценки с заданными обработчиками (по умолчанию пуст). */
export const createFakeGradePolicies = (
  policies: Readonly<Record<string, FakeGradePolicy>> = {},
): FakeGradePolicies => {
  const calls: FakeGradePolicies['calls'] = [];
  const infos: GradePolicyInfo[] = Object.entries(policies).map(
    ([id, policy]) => ({
      id,
      label: policy.label ?? id,
      extensionId: policy.extensionId ?? 'fake',
    }),
  );
  return {
    calls,
    list: () => infos,
    evaluate: async (id, input) => {
      calls.push({ id, input });
      const policy = policies[id];
      if (policy === undefined) {
        throw new GradePolicyError(
          'unknown-policy',
          id,
          `unknown grade policy '${id}'`,
        );
      }
      return (await policy.handler(input)) as never;
    },
  };
};
