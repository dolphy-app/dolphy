/**
 * `E_REFERENCE_FAILS` (F2, M5): эталонное решение упражнения
 * (`engine.verification.reference`, путь от корня библиотеки) прогоняется
 * через внедрённый `Verifier` — тот же, что работает в рантайме. Ядро от
 * раннеров не зависит: получает только порт (engine-ts.md §6a.4).
 *
 * Не прошёл: `failed` (эталон не проходит собственную проверку) и `error`
 * (сломанная фикстура или ожидаемый CSV, таймаут, падение раннера).
 * Упражнения без `reference` не проверяются (учитываются в `skipped`).
 */
import type { SubmissionDto } from '@lms/engine-contract';
import type { CourseSource, RawVerdict, Verifier } from '../ports/index.ts';
import type { ExerciseManifest } from '../domain/manifest.ts';
import type { Finding, Index } from './checks.ts';
import type { ExerciseUnit } from './model.ts';

export interface ReferenceCheckOptions {
  /** Раннеры по имени (`verification.runner`). */
  verifiers: readonly Verifier[];
  /** Проверок одновременно; по умолчанию 4 (размер пула SQL-раннера). */
  concurrency?: number;
  /** Таймаут, если в `verification` нет `timeoutMs`. */
  defaultTimeoutMs?: number;
}

export interface ReferenceCheckStats {
  /** Эталон прогнан (независимо от результата). */
  checked: number;
  /** Нет `reference`, сломан блок `engine` или нет проверки. */
  skipped: number;
  failed: number;
}

export interface ReferenceCheckResult {
  findings: Finding[];
  stats: ReferenceCheckStats;
}

export const DEFAULT_REFERENCE_CONCURRENCY = 4;
export const DEFAULT_REFERENCE_TIMEOUT_MS = 2000;
const MAX_DETAIL_CHARS = 400;

/** Ответ-эталон в форме, которую раннер ждёт от ученика. */
const SUBMISSIONS: Record<string, (text: string) => SubmissionDto> = {
  sql: (sql) => ({ kind: 'sql', sql }),
};

const submissionOf = (runner: string, text: string): SubmissionDto =>
  Object.hasOwn(SUBMISSIONS, runner)
    ? (SUBMISSIONS[runner] as (text: string) => SubmissionDto)(text)
    : { kind: 'text', text };

const describeVerdict = (verdict: RawVerdict): string => {
  if (verdict.outcome === 'passed') return 'passed';
  const notes: string[] = [];
  if (verdict.feedback !== undefined) notes.push(verdict.feedback);
  if (verdict.outcome === 'failed' && verdict.detail !== undefined) {
    notes.push(verdict.detail.slice(0, MAX_DETAIL_CHARS));
  }
  const head = `${verdict.outcome}/${verdict.reason}`;
  return notes.length === 0 ? head : `${head}: ${notes.join('; ')}`;
};

const isSafePath = (path: string) =>
  path !== '' &&
  !path.startsWith('/') &&
  !path.includes('\\') &&
  !path.split('/').includes('..');

const manifestOf = (unit: ExerciseUnit): ExerciseManifest => ({
  ...unit.manifest,
  ...(unit.engine === undefined ? {} : { engine: unit.engine }),
});

export const checkReferences = async (
  index: Index,
  source: Pick<CourseSource, 'readText'>,
  options: ReferenceCheckOptions,
): Promise<ReferenceCheckResult> => {
  const verifiers = new Map(options.verifiers.map((v) => [v.runner, v]));
  const defaultTimeoutMs =
    options.defaultTimeoutMs ?? DEFAULT_REFERENCE_TIMEOUT_MS;
  const stats: ReferenceCheckStats = { checked: 0, skipped: 0, failed: 0 };
  const findings: Finding[] = [];

  const fail = (unit: ExerciseUnit, message: string) => {
    stats.failed++;
    findings.push({
      code: 'E_REFERENCE_FAILS',
      message,
      unitId: unit.manifest.id,
      field: 'engine.verification',
    });
  };

  const checkOne = async (unit: ExerciseUnit) => {
    const verification = unit.engine?.verification;
    const reference = verification?.reference;
    if (
      verification === undefined ||
      unit.engineBroken === true ||
      typeof reference !== 'string'
    ) {
      stats.skipped++;
      return;
    }
    stats.checked++;
    const verifier = verifiers.get(verification.runner);
    if (verifier === undefined) {
      fail(
        unit,
        `no verifier is registered for runner '${verification.runner}': reference '${reference}' was not checked`,
      );
      return;
    }
    let text: string;
    try {
      if (!isSafePath(reference)) throw new Error('path leaves the library');
      text = await source.readText(reference);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fail(unit, `reference solution '${reference}' cannot be read: ${reason}`);
      return;
    }
    const timeoutMs =
      typeof verification.timeoutMs === 'number' && verification.timeoutMs > 0
        ? verification.timeoutMs
        : defaultTimeoutMs;
    try {
      const verdict = await verifier.check({
        exercise: manifestOf(unit),
        submission: submissionOf(verification.runner, text.trim()),
        timeoutMs,
        authorMode: true,
      });
      if (verdict.outcome !== 'passed') {
        fail(
          unit,
          `reference solution '${reference}' does not pass its own check: ${describeVerdict(verdict)}`,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fail(unit, `verifier '${verification.runner}' failed: ${reason}`);
    }
  };

  const queue = [...index.exercises.values()];
  let next = 0;
  const worker = async () => {
    for (let unit = queue[next++]; unit !== undefined; unit = queue[next++]) {
      await checkOne(unit);
    }
  };
  const width = Math.max(
    1,
    options.concurrency ?? DEFAULT_REFERENCE_CONCURRENCY,
  );
  await Promise.all(Array.from({ length: width }, worker));
  return { findings, stats };
};
