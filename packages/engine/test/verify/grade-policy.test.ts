/**
 * `GradePolicy.passAtN` (engine-ts.md §6a.4): pass@1 → 5, pass@2 → 4,
 * pass@3 и далее → 3, `gave-up` → 1, иначе `null` (нужна самооценка).
 * Вердикты `error` — не вина ученика: в оценку и в счёт попыток не входят,
 * поэтому серия из одних `error` не даёт оценки и, значит, события в журнале.
 */
import type { VerdictDto } from '@lms/engine-contract';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { GradePolicyError } from '../../src/ports/grade-policies.ts';
import {
  DEFAULT_GRADE_POLICY,
  GRADE_POLICIES,
  countGradedVerdicts,
  isGradedVerdict,
  passAtN,
  resolveGradePolicy,
} from '../../src/verify/index.ts';

const passed = (): VerdictDto => ({
  outcome: 'passed',
  attemptId: 'a',
  attemptsUsed: 0,
  durationMs: 1,
});
const failed = (): VerdictDto => ({
  outcome: 'failed',
  reason: 'mismatch',
  attemptId: 'a',
  attemptsUsed: 0,
  durationMs: 1,
});
const errored = (reason: 'timeout' | 'internal' = 'timeout'): VerdictDto => ({
  outcome: 'error',
  reason,
  attemptId: 'a',
  attemptsUsed: 0,
  durationMs: 1,
});

const grade = (verdicts: VerdictDto[], gaveUp = false) =>
  passAtN({ verdicts, gaveUp });

describe('passAtN', () => {
  it('оценка по номеру первой удачной попытки', () => {
    expect(grade([passed()])).toBe(5);
    expect(grade([failed(), passed()])).toBe(4);
    expect(grade([failed(), failed(), passed()])).toBe(3);
    expect(grade([failed(), failed(), failed(), failed(), passed()])).toBe(3);
  });

  it('gave-up — 1, даже после неудач и без вердиктов', () => {
    expect(grade([], true)).toBe(1);
    expect(grade([failed(), failed()], true)).toBe(1);
    expect(grade([errored()], true)).toBe(1);
  });

  it('нет прохода и нет отказа — null: нужна самооценка', () => {
    expect(grade([])).toBeNull();
    expect(grade([failed(), failed()])).toBeNull();
  });

  it('error не считается: серия из одних error не даёт оценки (события не будет)', () => {
    expect(grade([errored()])).toBeNull();
    expect(grade([errored('internal'), errored('timeout')])).toBeNull();
    expect(grade([failed(), errored()])).toBeNull();
  });

  it('error между попытками не сдвигает номер: [error, passed] — 5, [failed, error, passed] — 4', () => {
    expect(grade([errored(), passed()])).toBe(5);
    expect(grade([failed(), errored(), passed()])).toBe(4);
    expect(grade([errored(), failed(), errored(), failed(), passed()])).toBe(3);
  });

  it('свойство: любая расстановка error не меняет результат; оценка ∈ {1, 3, 4, 5, null}', () => {
    const verdictArb = fc.constantFrom(passed(), failed());
    fc.assert(
      fc.property(
        fc.array(verdictArb, { maxLength: 8 }),
        fc.array(fc.nat({ max: 8 }), { maxLength: 6 }),
        fc.boolean(),
        (verdicts, positions, gaveUp) => {
          const base = grade(verdicts, gaveUp);
          const noisy = [...verdicts];
          for (const position of positions) {
            noisy.splice(Math.min(position, noisy.length), 0, errored());
          }
          expect(grade(noisy, gaveUp)).toBe(base);
          expect([1, 3, 4, 5, null]).toContain(base);
        },
      ),
      { seed: 20260929, numRuns: 200 },
    );
  });
});

describe('хелперы вердиктов', () => {
  it('isGradedVerdict и countGradedVerdicts: error не входит в attemptsUsed', () => {
    expect(isGradedVerdict(passed())).toBe(true);
    expect(isGradedVerdict(failed())).toBe(true);
    expect(isGradedVerdict(errored())).toBe(false);
    expect(
      countGradedVerdicts([failed(), errored(), errored(), passed()]),
    ).toBe(2);
    expect(countGradedVerdicts([])).toBe(0);
  });

  it('политики выбираются по имени; по умолчанию — passAtN', () => {
    expect(GRADE_POLICIES[DEFAULT_GRADE_POLICY]).toBe(passAtN);
    expect(Object.keys(GRADE_POLICIES)).toEqual(['passAtN']);
  });
});

describe('resolveGradePolicy', () => {
  const input = { verdicts: [failed(), passed()], gaveUp: false };
  const setup = (
    selectedId: string,
    evaluate: (id: string) => Promise<unknown>,
  ) => {
    const logger = { warn: vi.fn() };
    const remote = { evaluate: vi.fn(evaluate as never) };
    return {
      logger,
      remote,
      policy: resolveGradePolicy({
        selectedId,
        builtin: GRADE_POLICIES,
        remote,
        logger,
      }),
    };
  };

  it('a built-in id is used directly, the remote is not asked', async () => {
    const { policy, remote } = setup('passAtN', async () => 5);
    expect(await policy(input)).toBe(4);
    expect(remote.evaluate).not.toHaveBeenCalled();
  });

  it('an extension id is evaluated remotely, null included', async () => {
    const generous = setup('acme.generous', async () => 5);
    expect(await generous.policy(input)).toBe(5);
    expect(generous.remote.evaluate).toHaveBeenCalledWith(
      'acme.generous',
      input,
    );
    expect(await setup('acme.none', async () => null).policy(input)).toBeNull();
  });

  it.each([
    ['unknown-policy'],
    ['host-down'],
    ['timeout'],
    ['invalid-result'],
    ['handler-failed'],
  ] as const)('%s → passAtN and a warning', async (cause) => {
    const error = new GradePolicyError(cause, 'acme.p', 'boom');
    const { policy, logger } = setup('acme.p', async () => {
      throw error;
    });
    expect(await policy(input)).toBe(4);
    expect(logger.warn).toHaveBeenCalledWith(
      { error, policyId: 'acme.p' },
      expect.any(String),
    );
  });

  it.each([0, 6, 2.5, '5', NaN, undefined])(
    'a result of %j is not a grade → passAtN and a warning',
    async (value) => {
      const { policy, logger } = setup('acme.p', async () => value);
      expect(await policy(input)).toBe(4);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    },
  );

  it('an inherited key of the builtin table is not a built-in policy', async () => {
    const { policy, remote } = setup('toString', async () => 2);
    expect(await policy(input)).toBe(2);
    expect(remote.evaluate).toHaveBeenCalledTimes(1);
  });
});
