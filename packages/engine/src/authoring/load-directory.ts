/**
 * Загрузка каталога без артефакта: сканирование + схема + граф + проверка
 * циклов, без остальных семантических проверок компилятора. При любой
 * `error` библиотеки нет, диагностики отдаются все.
 *
 * Ошибки графа Trane (`UnitGraphError`) закрыты предпроверками с теми же
 * кодами, поэтому сборка их не бросает: дубликат id между типами и
 * несовпадение `course_id`/`lesson_id` — `E_ID_*`, самозависимость —
 * `E_DEP_SELF`, вес вне [0, 1] — `E_ENC_WEIGHT`, циклы — `E_CYCLE_*` с полным
 * путём. Висячие ссылки Trane не отвергает — не отвергаем и мы (их ловит `compile`).
 */
import type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticSummary,
} from '@lms/engine-contract';
import { assembleLibrary } from '../domain/library.ts';
import type { Library } from '../domain/library.ts';
import type { CourseSource } from '../ports/index.ts';
import { withEngine } from './artifact.ts';
import {
  buildIndex,
  checkCycles,
  checkIds,
  checkReferences,
  DEFAULT_CHECK_OPTIONS,
  locateFinding,
} from './checks.ts';
import { sortDiagnostics, summarize } from './diagnostics.ts';
import { scan } from './scan.ts';
import type { ScanOptions } from './scan.ts';

export interface LoadDirectoryOptions {
  scan?: Partial<ScanOptions>;
}

export interface LoadDirectoryResult {
  /** `null` при любой `error`. */
  library: Library | null;
  diagnostics: Diagnostic[];
  summary: DiagnosticSummary;
}

/** Из `checkReferences` графу Trane важны только эти коды. */
const REJECTED_BY_GRAPH: ReadonlySet<DiagnosticCode> = new Set([
  'E_DEP_SELF',
  'E_ENC_WEIGHT',
]);

export const loadDirectory = async (
  source: CourseSource,
  options: LoadDirectoryOptions = {},
): Promise<LoadDirectoryResult> => {
  const { model, diagnostics: scanned } = await scan(source, options.scan);
  const index = buildIndex(model);
  const findings = [
    ...checkIds(model),
    ...checkReferences(index).filter(({ code }) => REJECTED_BY_GRAPH.has(code)),
    ...checkCycles(index, DEFAULT_CHECK_OPTIONS),
  ];
  const diagnostics = sortDiagnostics([
    ...scanned,
    ...findings.map((finding) => locateFinding(index, finding)),
  ]);
  const summary = summarize(diagnostics);
  if (summary.errors > 0) return { library: null, diagnostics, summary };
  const library = assembleLibrary(
    model.courses.map(({ manifest, engine }) => withEngine(manifest, engine)),
    model.lessons.map(({ manifest, engine }) => withEngine(manifest, engine)),
    model.exercises.map(({ manifest, engine }) => withEngine(manifest, engine)),
    { cycleCheck: true },
  );
  return { library, diagnostics, summary };
};
