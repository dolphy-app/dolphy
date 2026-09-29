/**
 * Поток `beginAttempt → submitAnswer* → completeAttempt` над настоящим
 * раннером и `GradePolicy.passAtN` (сервис практики — отдельная веха; здесь
 * проверяются швы, которые он использует): единственная запись в журнал —
 * `completeAttempt`; `error`-вердикты не пишут событие и не считаются в
 * `attemptsUsed`; вердикт `failed` учитывается.
 */
import type { VerdictDto } from '@lms/engine-contract';
import { countGradedVerdicts, passAtN } from '@lms/engine/verify';
import { afterEach, describe, expect, it } from 'vitest';
import type { SqlVerifier } from '../../src/verifier.ts';
import {
  INFINITE_CTE,
  createTestVerifiers,
  defaultFiles,
  sqlRequest,
} from '../helpers/verifier.ts';

const verifiers = createTestVerifiers();
afterEach(() => verifiers.closeAll());

interface JournalEntry {
  attemptId: string;
  grade: number;
}

/** Мини-версия `practice`: копит вердикты попытки, пишет событие только в `complete`. */
const createAttempt = (verifier: SqlVerifier, journal: JournalEntry[]) => {
  const verdicts: VerdictDto[] = [];
  const attemptId = 'attempt-1';
  return {
    verdicts,
    submit: async (sql: string, timeoutMs = 2000): Promise<VerdictDto> => {
      const raw = await verifier.check(sqlRequest(sql, { timeoutMs }));
      const verdict: VerdictDto = {
        ...raw,
        attemptId,
        attemptsUsed: countGradedVerdicts([
          ...verdicts,
          { ...raw, attemptId, attemptsUsed: 0 } as VerdictDto,
        ]),
      } as VerdictDto;
      if (raw.outcome !== 'error') verdicts.push(verdict);
      return verdict;
    },
    complete: (gaveUp = false, selfGrade?: 1 | 2 | 3 | 4 | 5) => {
      const grade = passAtN({ verdicts, gaveUp }) ?? selfGrade ?? null;
      if (grade === null) return null;
      journal.push({ attemptId, grade });
      return grade;
    },
  };
};

describe('поток попытки с проверкой', () => {
  it('failed → error(timeout) → passed: error не пишет и не считается, оценка pass@2 = 4', async () => {
    const { verifier } = verifiers.make(defaultFiles());
    const journal: JournalEntry[] = [];
    const attempt = createAttempt(verifier, journal);

    const first = await attempt.submit('SELECT 7 AS n');
    expect(first).toMatchObject({
      outcome: 'failed',
      reason: 'mismatch',
      attemptsUsed: 1,
    });
    const slow = await attempt.submit(INFINITE_CTE, 300);
    expect(slow).toMatchObject({ outcome: 'error', reason: 'timeout' });
    expect(slow.attemptsUsed).toBe(1);
    expect(journal).toEqual([]);

    const last = await attempt.submit('SELECT count(*) AS n FROM emp');
    expect(last).toMatchObject({ outcome: 'passed', attemptsUsed: 2 });
    expect(journal).toEqual([]);

    expect(attempt.complete()).toBe(4);
    expect(journal).toEqual([{ attemptId: 'attempt-1', grade: 4 }]);
  });

  it('только error-вердикты: оценки нет, события нет — нужна самооценка', async () => {
    const { verifier } = verifiers.make({});
    const journal: JournalEntry[] = [];
    const attempt = createAttempt(verifier, journal);
    const verdict = await attempt.submit('SELECT 1');
    expect(verdict).toMatchObject({
      outcome: 'error',
      reason: 'fixture_error',
      attemptsUsed: 0,
    });
    expect(attempt.complete()).toBeNull();
    expect(journal).toEqual([]);
    expect(attempt.complete(false, 3)).toBe(3);
    expect(journal).toHaveLength(1);
  });

  it('gave-up после неудач — оценка 1', async () => {
    const { verifier } = verifiers.make(defaultFiles());
    const journal: JournalEntry[] = [];
    const attempt = createAttempt(verifier, journal);
    await attempt.submit('DROP TABLE emp');
    expect(attempt.complete(true)).toBe(1);
    expect(journal).toEqual([{ attemptId: 'attempt-1', grade: 1 }]);
  });
});
