import { DIAGNOSTIC_SEVERITY } from '@lms/engine-contract';
import type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticSummary,
} from '@lms/engine-contract';

export interface DiagnosticLocation {
  unitId?: string;
  /** Путь относительно корня библиотеки, разделитель `/`. */
  path?: string;
  line?: number;
  related?: string[];
}

/** Диагностика с серьёзностью по умолчанию из каталога кодов контракта. */
export const diag = (
  code: DiagnosticCode,
  message: string,
  at: DiagnosticLocation = {},
): Diagnostic => {
  const diagnostic: Diagnostic = {
    code,
    severity: DIAGNOSTIC_SEVERITY[code],
    message,
  };
  if (at.unitId !== undefined) diagnostic.unitId = at.unitId;
  if (at.path !== undefined) diagnostic.path = at.path;
  if (at.line !== undefined) diagnostic.line = at.line;
  if (at.related !== undefined) diagnostic.related = at.related;
  return diagnostic;
};

export const summarize = (
  diagnostics: readonly Diagnostic[],
): DiagnosticSummary => {
  const summary: DiagnosticSummary = { errors: 0, warnings: 0, infos: 0 };
  for (const { severity } of diagnostics) {
    if (severity === 'error') summary.errors++;
    else if (severity === 'warning') summary.warnings++;
    else summary.infos++;
  }
  return summary;
};

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;
const compare = (a: string, b: string) => Number(a > b) - Number(a < b);

/** Детерминированный порядок: серьёзность, файл, строка, код, юнит, текст. */
export const sortDiagnostics = (diagnostics: Diagnostic[]): Diagnostic[] =>
  diagnostics.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      compare(a.path ?? '', b.path ?? '') ||
      (a.line ?? 0) - (b.line ?? 0) ||
      compare(a.code, b.code) ||
      compare(a.unitId ?? '', b.unitId ?? '') ||
      compare(a.message, b.message),
  );
