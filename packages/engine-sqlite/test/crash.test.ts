import { describe, expect, it } from 'vitest';
import { runCrashCampaign } from './crash/crash-driver.ts';
import type { SyncMode } from './crash/crash-driver.ts';

/**
 * T-30. В обычном прогоне — 15 убийств на режим; 300 на режим (≈ 205 с каждый)
 * перед релизом: `ENGINE_CRASH_ITERATIONS=300`. SIGKILL убивает процесс, а не
 * ОС, поэтому тест не отличает NORMAL от FULL и потерю питания не проверяет.
 */
const iterations = Number(process.env.ENGINE_CRASH_ITERATIONS ?? 15);
const bigIterations = iterations > 15 ? 10 : 2;
const bigRows = iterations > 15 ? 200_000 : 50_000;

describe('SIGKILL crash recovery', () => {
  for (const sync of ['NORMAL', 'FULL'] as const satisfies SyncMode[]) {
    it(
      `${sync}: every killed run keeps every invariant and every ACKed batch`,
      async () => {
        const summary = await runCrashCampaign({
          sync,
          iterations,
          seed: sync === 'NORMAL' ? 1 : 2,
          bigIterations,
          bigRows,
        });
        expect(summary.violations).toEqual([]);
        expect(summary.big.violations).toEqual([]);
        expect(summary.killedBySigkill).toBe(iterations);
        expect(summary.totalRows).toBeGreaterThan(100);
        expect(summary.ackedBatches).toBeGreaterThan(iterations);
        expect(summary.big.killedMidTransaction).toBeGreaterThan(0);
        expect(summary.big.rowsLeftByKilled).toBe(0);
      },
      60_000 + iterations * 1_500 + bigIterations * bigRows * 0.5,
    );
  }
});
