/**
 * T-19 (M5): вредоносный SQL через настоящий фасад движка и настоящий раннер:
 * `ATTACH`, `load_extension`, `writable_schema` и бесконечный рекурсивный CTE
 * не выходят из песочницы (файлы не создаются, БД фикстуры цела) и не вешают
 * движок — пока проверка висит, остальные команды отвечают, после `timeout`
 * следующая проверка проходит, а `error`-вердикт не считается попыткой.
 * Матрица угроз — T-39, watchdog раннера — T-42.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createNodeFsCourseSource } from '@lms/engine/node';
import { silentLogger } from '@lms/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIXTURE_LIBRARIES,
  createTestEngine,
} from '../../../engine/test/helpers/engine.ts';
import { createSqlVerifier } from '../../src/verifier.ts';
import type { SqlVerifier } from '../../src/verifier.ts';
import { INFINITE_CTE } from '../helpers/verifier.ts';
import { useTmpDir } from '../helpers/tmp.ts';

const JOIN_Q1 = 'sql_json::join::q1';
const LIBRARY = FIXTURE_LIBRARIES['sql-course'];
const tmp = useTmpDir();
const opened: SqlVerifier[] = [];
afterEach(async () => {
  for (const verifier of opened.splice(0)) await verifier.close();
});

const referenceSolution = () =>
  readFileSync(join(LIBRARY, 'solutions/join-inner-alias.sql'), 'utf8');

describe('вредоносный SQL через фасад движка (T-19)', () => {
  it('атаки отклоняются без побочных эффектов, бесконечный цикл не вешает движок, следом проходит верное решение', async () => {
    const verifier = createSqlVerifier({
      source: createNodeFsCourseSource(LIBRARY),
      logger: silentLogger,
    });
    opened.push(verifier);
    const { engine } = await createTestEngine({
      library: 'sql-course',
      verifiers: [verifier],
    });
    const { attemptId, verifiable } = await engine.practice.beginAttempt({
      exerciseId: JOIN_Q1,
    });
    expect(verifiable).toBe(true);
    const submit = (sql: string) =>
      engine.practice.submitAnswer({
        attemptId,
        submission: { kind: 'sql', sql },
      });

    const escapePath = join(await tmp.make(), 'escaped.db');
    const attacks = [
      `ATTACH DATABASE '${escapePath}' AS escaped`,
      `SELECT load_extension('${join(await tmp.make(), 'evil')}')`,
      'PRAGMA writable_schema = ON',
    ];
    for (const sql of attacks) {
      expect(await submit(sql)).toMatchObject({ outcome: 'failed' });
    }
    expect(existsSync(escapePath)).toBe(false);

    // бесконечный CTE: timeoutMs = 2000 из упражнения; движок отвечает, пока проверка идёт
    let settled = false;
    const looping = submit(INFINITE_CTE).finally(() => {
      settled = true;
    });
    const info = await engine.library.getInfo();
    const other = await engine.practice.beginAttempt({
      exerciseId: 'sql_json::join::q2',
    });
    expect(info.state).toBe('ready');
    expect(other.attemptId).not.toBe(attemptId);
    expect(settled).toBe(false);
    expect(await looping).toMatchObject({
      outcome: 'error',
      reason: 'timeout',
    });

    // движок и раннер живы: верное решение проходит, error не в счёт
    const verdict = await submit(referenceSolution());
    expect(verdict).toMatchObject({
      outcome: 'passed',
      attemptsUsed: attacks.length + 1,
    });
    const result = await engine.practice.completeAttempt({ attemptId });
    expect(result.duplicate).toBe(false);
  }, 30_000);
});
