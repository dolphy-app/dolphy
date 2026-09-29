/**
 * T-44: бюджет M5 — 1 000 проверок на прогретом пуле ≤ 1 с (медиана по
 * прогонам). Пул дочерних процессов `min(4, cores − 1)`, 30 проверок из
 * корпуса по кругу, фикстура из 9 строк (нижняя граница накладных расходов).
 * Аппаратно зависимо; блокирует релиз (предрелизный job), в PR-CI не идёт:
 * `pnpm -F @lms/engine-sql-runner bench`.
 */
import { silentLogger } from '@lms/testkit';
import { expect, test } from 'vitest';
import { createSqlVerifier } from '../../src/verifier.ts';
import { CHECKS, EMP_FIXTURE } from '../helpers/checks.ts';
import { createFilesSource } from '../helpers/files-source.ts';
import { sqlExercise, sqlRequest } from '../helpers/verifier.ts';

const CHECKS_PER_ROUND = 1000;
const BUDGET_MS = 1000;

test('T-44 1000 проверок на прогретом пуле укладываются в секунду', async ({
  bench,
}) => {
  const files: Record<string, string> = { 'fixtures/emp.sql': EMP_FIXTURE };
  for (const check of CHECKS) {
    files[`checks/${check.id}.csv`] = `${check.expected}\n`;
  }
  const verifier = createSqlVerifier({
    source: createFilesSource(files),
    logger: silentLogger,
  });
  const requests = CHECKS.map((check) =>
    sqlRequest(check.solution, {
      exercise: sqlExercise({
        expected: `checks/${check.id}.csv`,
        ...check.compare,
      }),
    }),
  );
  try {
    await verifier.warm();
    const round = async () => {
      const verdicts = await Promise.all(
        Array.from({ length: CHECKS_PER_ROUND }, (_, i) =>
          verifier.check(requests[i % requests.length] ?? requests[0]!),
        ),
      );
      const bad = verdicts.filter(({ outcome }) => outcome !== 'passed');
      if (bad.length > 0) throw new Error(`${bad.length} проверок не прошли`);
    };
    const result = await bench('1000 checks', round).run({
      iterations: 10,
      warmupIterations: 2,
      time: 0,
      warmupTime: 0,
    });
    expect(result.latency.p50).toBeLessThan(BUDGET_MS);
  } finally {
    await verifier.close();
  }
});
