/**
 * Порт правил оценки из расширений: список правил из манифестов и вызов
 * правила в хосте расширений. Адаптеры живут в `@dolphy-app/extension-host`; ядро
 * знает только этот интерфейс. Сбой вызова — `GradePolicyError`: запасное
 * правило выбирает слой композиции (`resolveGradePolicy`), не порт.
 */
import type { Grade } from '@dolphy-app/engine-contract';
import type { GradeInput } from '../verify/grade-policy.ts';

export interface GradePolicyInfo {
  id: string;
  label: string;
  extensionId: string;
}

export type GradePolicyErrorCause =
  | 'unknown-policy'
  | 'host-down'
  | 'timeout'
  | 'invalid-result'
  | 'handler-failed';

export class GradePolicyError extends Error {
  override readonly cause: GradePolicyErrorCause;
  readonly policyId: string;

  constructor(cause: GradePolicyErrorCause, policyId: string, message: string) {
    super(message);
    this.name = 'GradePolicyError';
    this.cause = cause;
    this.policyId = policyId;
  }
}

export interface GradePolicies {
  list(): readonly GradePolicyInfo[];
  /** Бросает `GradePolicyError`. */
  evaluate(id: string, input: GradeInput): Promise<Grade | null>;
}
