import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestEngine } from '../../engine/test/helpers/engine.ts';
import type { LogEntry } from '@lms/engine';
import {
  CRASH_DEVICE_ID,
  CRASH_EXERCISES,
} from './crash/crash-engine-shared.ts';
import { openSqliteEventStore } from '../src/index.ts';
import { useTempDir } from './store-factory.ts';

const CHILD = join(import.meta.dirname, 'crash', 'crash-engine-child.ts');
const RUNS = Number(process.env.ENGINE_CRASH_ENGINE_RUNS ?? 6);
const KILL_DELAYS_MS = [0, 15, 40, 90, 150, 250];

const temp = useTempDir();

interface RunOutcome {
  acked: string[];
  signal: NodeJS.Signals | null;
  stderr: string;
}

/** Ребёнок пишет через фасад; SIGKILL через `delayMs` после первого ACK. */
const runAndKill = (dbPath: string, run: number, delayMs: number) =>
  new Promise<RunOutcome>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        CHILD,
        dbPath,
        String(run),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const outcome: RunOutcome = { acked: [], signal: null, stderr: '' };
    let armed = false;
    let buffer = '';
    const watchdog = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const [tag, requestId] = buffer.slice(0, newline).split(' ');
        buffer = buffer.slice(newline + 1);
        if (tag !== 'ACK' || requestId === undefined) continue;
        outcome.acked.push(requestId);
        if (!armed) {
          armed = true;
          // реальный процесс убивается через реальную паузу: fake timers тут не применимы
          setTimeout(() => child.kill('SIGKILL'), delayMs);
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      outcome.stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (_code, signal) => {
      clearTimeout(watchdog);
      outcome.signal = signal;
      resolve(outcome);
    });
  });

describe('engine over SqliteEventStore after SIGKILL (T-12)', () => {
  it(
    'reopens with a consistent journal and projections equal to it, then keeps writing',
    async () => {
      const dbPath = join(temp.dir, 'crash-engine.db');
      const ackedEver = new Set<string>();
      let killed = 0;

      for (let run = 1; run <= RUNS; run++) {
        const delayMs = KILL_DELAYS_MS[run % KILL_DELAYS_MS.length] as number;
        const outcome = await runAndKill(dbPath, run, delayMs);
        expect(outcome.stderr).toBe('');
        expect(outcome.acked.length).toBeGreaterThan(0);
        if (outcome.signal === 'SIGKILL') killed++;
        for (const requestId of outcome.acked) ackedEver.add(requestId);

        const eventStore = openSqliteEventStore({
          path: dbPath,
          deviceId: CRASH_DEVICE_ID,
          durability: 'normal',
        });
        const reopened = await createTestEngine({
          library: 'sql-course',
          eventStore,
        });
        try {
          const journal: LogEntry[] = [];
          for await (const entry of eventStore.readAll()) journal.push(entry);
          // журнал согласован: свои seq — 1..N без дыр, каждый ACK на месте
          const seqs = journal.map((entry) => entry.seq).sort((a, b) => a - b);
          expect(seqs).toEqual(seqs.map((_, index) => index + 1));
          expect(eventStore.lastSeq()).toBe(journal.length);
          const ids = new Set(journal.map((entry) => entry.id));
          for (const requestId of ackedEver)
            expect(ids.has(requestId)).toBe(true);

          // проекции совпадают с журналом: попытки каждого упражнения — те же
          // записи, что в журнале, в порядке (at, deviceId, seq)
          const attempts = journal.filter((entry) => entry.kind === 'attempt');
          for (const exerciseId of CRASH_EXERCISES) {
            const expected = attempts
              .filter((entry) => entry.exerciseId === exerciseId)
              .map(({ id, grade, at }) => ({ eventId: id, grade, at }))
              .reverse(); // getAttempts отдаёт новые первыми
            const shown: { eventId: string; grade: number; at: number }[] = [];
            let cursor: string | undefined;
            do {
              const page = await reopened.engine.practice.getAttempts(
                exerciseId,
                { limit: 500, ...(cursor !== undefined && { cursor }) },
              );
              for (const { eventId, grade, at } of page.items) {
                shown.push({ eventId, grade, at });
              }
              cursor = page.nextCursor;
            } while (cursor !== undefined);
            expect(shown).toEqual(expected);
          }

          // после сбоя запись продолжается с того же места
          const probe = await reopened.engine.practice.recordAttempt({
            requestId: `probe-${run}`,
            exerciseId: CRASH_EXERCISES[0],
            grade: 5,
          });
          expect(probe.duplicate).toBe(false);
          expect(eventStore.lastSeq()).toBe(journal.length + 1);
        } finally {
          await reopened.engine.close();
        }
      }
      expect(killed).toBe(RUNS);
    },
    30_000 + RUNS * 15_000,
  );
});
