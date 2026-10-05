/**
 * `compile(source)`: сканирование → индекс → проверки → сортировка
 * диагностик → артефакт. Не останавливается на первой ошибке: все дефекты
 * библиотеки собираются за один проход (T-17).
 */
import type {
  Diagnostic,
  DiagnosticSummary,
} from '@dolphy-app/engine-contract';
import type { CourseSource } from '../ports/index.ts';
import { buildArtifact } from './artifact.ts';
import type { Artifact } from './artifact.ts';
import {
  buildIndex,
  DEFAULT_CHECK_OPTIONS,
  locateFinding,
  runChecks,
} from './checks.ts';
import type { CheckOptions } from './checks.ts';
import { diag, sortDiagnostics, summarize } from './diagnostics.ts';
import {
  contentRevision,
  listInputs,
  readInputBytes,
  statFingerprint,
} from './revision.ts';
import { checkReferences } from './reference-check.ts';
import type {
  ReferenceCheckOptions,
  ReferenceCheckStats,
} from './reference-check.ts';
import { scan } from './scan.ts';
import type { ScanOptions, ScanStats } from './scan.ts';
import type { Model } from './model.ts';

export interface CompileOptions {
  scan?: Partial<ScanOptions>;
  checks?: Partial<CheckOptions>;
  /** `clean` — артефакт только без ошибок; `always` — и с ошибками (отладка). */
  emit?: 'clean' | 'always';
  /** Пути (от корня), не входящие в `revision`, например выходной файл CLI. */
  excludeFromRevision?: readonly string[];
  /** Прогнать эталонные решения через раннеры и выдать `E_REFERENCE_FAILS` (M5). */
  runChecks?: ReferenceCheckOptions;
}

export interface CompileTimings {
  scanMs: number;
  checksMs: number;
  /** Только при `runChecks`. */
  referenceMs?: number;
  revisionMs: number;
  buildMs: number;
  totalMs: number;
  scan: ScanStats;
}

export interface CompileResult {
  diagnostics: Diagnostic[];
  summary: DiagnosticSummary;
  /** `null` при ошибках (`emit: 'clean'`) или сбое чтения входов. */
  artifact: Artifact | null;
  /** Курсы, уроки и упражнения, найденные сканером (до проверок графа). */
  model: Model;
  timings: CompileTimings;
  /** Есть только при `runChecks`: сколько эталонов прогнано, пропущено, не прошло. */
  referenceChecks?: ReferenceCheckStats;
}

export const compile = async (
  source: CourseSource,
  options: CompileOptions = {},
): Promise<CompileResult> => {
  const { emit = 'clean', excludeFromRevision = [] } = options;
  const checkOptions: CheckOptions = {
    ...DEFAULT_CHECK_OPTIONS,
    ...options.checks,
  };
  const started = performance.now();
  // отпечаток stat снимается до сканирования: правка после него увидится при следующей проверке
  const inputs = await listInputs(source, excludeFromRevision);
  const stat = await statFingerprint(inputs);

  const scanResult = await scan(source, options.scan);
  const scanned = performance.now();
  const index = buildIndex(scanResult.model);
  const { findings, redundant } = runChecks(index, checkOptions);
  const checked = performance.now();
  // эталонные решения через внедрённый порт ExerciseTypes (M5): ядро зависит только от порта
  const reference =
    options.runChecks === undefined
      ? null
      : await checkReferences(index, source, options.runChecks);
  const referenced = performance.now();
  const diagnostics = sortDiagnostics([
    ...scanResult.diagnostics,
    ...[...findings, ...(reference?.findings ?? [])].map((finding) =>
      locateFinding(index, finding),
    ),
  ]);
  const timings: CompileTimings = {
    scanMs: scanned - started,
    checksMs: checked - scanned,
    ...(reference === null ? {} : { referenceMs: referenced - checked }),
    revisionMs: 0,
    buildMs: 0,
    totalMs: 0,
    scan: scanResult.stats,
  };
  const finish = (
    all: Diagnostic[],
    artifact: Artifact | null,
  ): CompileResult => {
    timings.totalMs = performance.now() - started;
    return {
      diagnostics: all,
      summary: summarize(all),
      artifact,
      model: scanResult.model,
      timings,
      ...(reference === null ? {} : { referenceChecks: reference.stats }),
    };
  };
  if (summarize(diagnostics).errors > 0 && emit === 'clean') {
    return finish(diagnostics, null);
  }

  let revision: string;
  try {
    // байты, уже прочитанные сканером, повторно не читаются
    const bytes = await readInputBytes(source, inputs, scanResult.contents);
    revision = await contentRevision(bytes);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failed = sortDiagnostics([
      ...diagnostics,
      diag('E_IO', `cannot read library files for revision: ${reason}`),
    ]);
    return finish(failed, null);
  }
  const hashed = performance.now();
  timings.revisionMs = hashed - referenced;
  const artifact = buildArtifact({
    index,
    revision,
    stat,
    inputFiles: inputs.length,
    diagnostics,
    summary: summarize(diagnostics),
    redundant,
  });
  timings.buildMs = performance.now() - hashed;
  return finish(diagnostics, artifact);
};
