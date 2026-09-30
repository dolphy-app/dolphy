/**
 * Вердикты проверки → оценка 1–5 (engine-ts.md §6a.4, F5). Чистая логика без
 * `node:*`: политика выбирается по имени из `GRADE_POLICIES` (Strategy через
 * lookup), `completeAttempt` вызывает её один раз при закрытии попытки.
 */
import type { Grade, VerdictDto } from '@spirula-app/engine-contract';
import type { GradePolicies } from '../ports/grade-policies.ts';
import type { Logger } from '../ports/index.ts';

export interface GradeInput {
  /** Вердикты `submitAnswer` по попытке в порядке получения. */
  verdicts: readonly VerdictDto[];
  /** Ученик сдался (`completeAttempt({ outcome: 'gave-up' })`). */
  gaveUp: boolean;
}

/**
 * Оценка из вердиктов; `null` — вердиктов недостаточно, нужна самооценка
 * (вызывающий подставит `grade` из запроса или откажет с `INVALID_ARGUMENT`).
 */
export type GradePolicy = (
  input: GradeInput,
) => Grade | null | Promise<Grade | null>;

/** `error` — не вина ученика: в счёт попыток и в оценку не входит. */
export const isGradedVerdict = (verdict: VerdictDto): boolean =>
  verdict.outcome !== 'error';

/** Число вердиктов `passed`/`failed` — поле `attemptsUsed`. */
export const countGradedVerdicts = (verdicts: readonly VerdictDto[]): number =>
  verdicts.filter(isGradedVerdict).length;

/** Оценка по номеру первого прохода среди учтённых вердиктов: 1 → 5, 2 → 4, 3 и далее → 3. */
const gradeOfPassIndex = (passIndex: number): Grade => {
  if (passIndex === 0) return 5;
  if (passIndex === 1) return 4;
  return 3;
};

const GAVE_UP_GRADE: Grade = 1;

/**
 * `pass@N`: `passed` с первой попытки — 5, со второй — 4, с третьей и
 * позже — 3; `gave-up` — 1; без прохода и без отказа — `null`.
 * Вердикты `error` игнорируются.
 */
export const passAtN = ({ verdicts, gaveUp }: GradeInput): Grade | null => {
  if (gaveUp) return GAVE_UP_GRADE;
  const passIndex = verdicts
    .filter(isGradedVerdict)
    .findIndex((verdict) => verdict.outcome === 'passed');
  return passIndex === -1 ? null : gradeOfPassIndex(passIndex);
};

/** Встроенные правила по имени; правила расширений — порт `GradePolicies`. */
export const GRADE_POLICIES = {
  passAtN,
} as const satisfies Record<string, (input: GradeInput) => Grade | null>;

export type GradePolicyName = keyof typeof GRADE_POLICIES;

export const DEFAULT_GRADE_POLICY: GradePolicyName = 'passAtN';

const isGrade = (value: unknown): value is Grade =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5;

export interface ResolveGradePolicyOptions {
  /** Выбранное в настройках правило: ключ `builtin` или id правила расширения. */
  selectedId: string;
  builtin: Readonly<Record<string, (input: GradeInput) => Grade | null>>;
  remote: Pick<GradePolicies, 'evaluate'>;
  logger: Pick<Logger, 'warn'>;
}

/**
 * Выбранное правило с запасным: любой сбой правила расширения (хост
 * недоступен, дедлайн, исключение, результат не 1–5 и не `null`, пропавшее
 * расширение) → предупреждение и `passAtN`; закрытие попытки не зависит от
 * чужого кода.
 */
export const resolveGradePolicy = ({
  selectedId,
  builtin,
  remote,
  logger,
}: ResolveGradePolicyOptions): GradePolicy => {
  const selected = Object.hasOwn(builtin, selectedId)
    ? builtin[selectedId]
    : undefined;
  if (selected !== undefined) return selected;
  return async (input) => {
    try {
      const grade = await remote.evaluate(selectedId, input);
      if (grade !== null && !isGrade(grade)) {
        throw new TypeError(`invalid grade ${JSON.stringify(grade)}`);
      }
      return grade;
    } catch (error) {
      logger.warn(
        { error, policyId: selectedId },
        'grade policy failed, falling back to passAtN',
      );
      return passAtN(input);
    }
  };
};
