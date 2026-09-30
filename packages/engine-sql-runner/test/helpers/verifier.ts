import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { GradeResult } from '@spirula/extension-api';
import { createCapturingLogger } from '@spirula/testkit';
import type { SpawnWorker } from '../../src/pool.ts';
import { createSqlVerifier } from '../../src/verifier.ts';
import type { SqlCheckInput, SqlVerifierOptions } from '../../src/verifier.ts';
import { EMP_FIXTURE } from './checks.ts';
import { createFilesSource } from './files-source.ts';
import type { MutableFiles } from './files-source.ts';

export const FIXTURE_PATH = 'fixtures/emp.sql';
export const EXPECTED_PATH = 'checks/count.csv';

export const defaultFiles = (): Record<string, string> => ({
  [FIXTURE_PATH]: EMP_FIXTURE,
  [EXPECTED_PATH]: 'n\n6\n',
});

/** Спецификация вида `spirula.sql`; `extra` дополняет или переопределяет поля. */
export const sqlSpec = (extra: Record<string, unknown> = {}) => ({
  fixture: FIXTURE_PATH,
  expected: EXPECTED_PATH,
  ...extra,
});

export const sqlRequest = (
  sql: string,
  overrides: Partial<SqlCheckInput> = {},
): SqlCheckInput => ({
  spec: sqlSpec(),
  answer: sql,
  timeoutMs: 2000,
  authorMode: false,
  ...overrides,
});

/** `fork` с записью дочерних процессов: тесты видят PID и сигналы. */
export const recordSpawns = () => {
  const children: ChildProcess[] = [];
  const spawnWorker: SpawnWorker = (path, args, options) => {
    const child = fork(path, args, options);
    children.push(child);
    return child;
  };
  return { children, spawnWorker };
};

export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
};

export const INFINITE_CTE =
  'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) AS n FROM c';

export const waitFor = async (
  condition: () => boolean,
  timeoutMs = 5000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor: timeout');
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
};

export const exitOf = (child: ChildProcess) =>
  new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve({ code: child.exitCode, signal: child.signalCode });
        return;
      }
      child.once('exit', (code, signal) => resolve({ code, signal }));
    },
  );

/**
 * Верификатор над файлами в памяти; `close()` вызывается в `afterEach`
 * вызывающим через `verifiers.closeAll()`.
 */
export const createTestVerifiers = () => {
  const opened: Array<{ close(): Promise<void> }> = [];
  const { logger, records } = createCapturingLogger();
  const make = (
    files: Record<string, string> = defaultFiles(),
    options: Partial<SqlVerifierOptions> = {},
  ) => {
    const source: MutableFiles = createFilesSource(files);
    const verifier = createSqlVerifier({
      source,
      logger,
      size: 1,
      ...options,
    });
    opened.push(verifier);
    return { verifier, source };
  };
  return {
    make,
    logs: records,
    closeAll: async () => {
      await Promise.all(opened.splice(0).map((v) => v.close()));
      records.length = 0;
    },
  };
};

/** `detail` есть только у `failed`-вердикта в режиме автора. */
export const detailOf = (verdict: GradeResult): string | undefined =>
  verdict.outcome === 'failed' ? verdict.detail : undefined;

/** Записи логгера одной строкой (Error → message), чтобы искать по тексту. */
export const logText = (records: readonly object[]): string =>
  JSON.stringify(records, (_key, value: unknown) =>
    value instanceof Error ? value.message : value,
  );
