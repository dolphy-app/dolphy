/**
 * `E_REFERENCE_FAILS` (F2, M5): эталонное решение упражнения
 * (`referenceAnswer` вида задания) прогоняется через внедрённый порт
 * `ExerciseTypes` — тот же, что работает в рантайме. Ядро от расширений не
 * зависит: получает только порт (engine-ts.md §6a.4).
 *
 * Не прошёл: `failed` (эталон не проходит собственную проверку) и `error`
 * (сломанная фикстура или ожидаемый CSV, таймаут, падение раннера).
 * Упражнения без эталона не проверяются (учитываются в `skipped`).
 */
import type { CourseSource, RawVerdict } from '../ports/index.ts';
import type { ExerciseTypes } from '../ports/exercise-types.ts';
import type { Finding, Index } from './checks.ts';
import type { ExerciseUnit } from './model.ts';

export interface ReferenceCheckOptions {
  exerciseTypes: ExerciseTypes;
  /** Проверок одновременно; по умолчанию 4 (размер пула SQL-раннера). */
  concurrency?: number;
  /** Таймаут, если в `engine.exercise` нет `timeoutMs`. */
  defaultTimeoutMs?: number;
}

export interface ReferenceCheckStats {
  /** Эталон прогнан (независимо от результата). */
  checked: number;
  /** Нет эталона, сломан блок `engine` или вид неизвестен. */
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

export const checkReferences = async (
  index: Index,
  _source: Pick<CourseSource, 'readText'>,
  options: ReferenceCheckOptions,
): Promise<ReferenceCheckResult> => {
  const { exerciseTypes } = options;
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
      field: 'engine.exercise',
    });
  };

  const checkOne = async (unit: ExerciseUnit) => {
    const block = unit.engine?.exercise;
    if (
      block === undefined ||
      unit.engineBroken === true ||
      exerciseTypes.describe(block.type) === undefined
    ) {
      stats.skipped++;
      return;
    }
    const base = {
      type: block.type,
      exerciseId: unit.manifest.id,
      spec: block.spec ?? {},
    };
    try {
      const reference = await exerciseTypes.referenceAnswer(base);
      if (!reference.found) {
        stats.skipped++;
        return;
      }
      stats.checked++;
      const verdict = await exerciseTypes.grade({
        ...base,
        answer: reference.answer,
        timeoutMs: block.timeoutMs ?? defaultTimeoutMs,
        authorMode: true,
      });
      if (verdict.outcome !== 'passed') {
        fail(
          unit,
          `reference solution does not pass its own check: ${describeVerdict(verdict)}`,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fail(unit, `exercise type '${block.type}' failed: ${reason}`);
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
