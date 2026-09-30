/**
 * Расширение `engine` (engine-ts.md §5.4): frontmatter front-файла, ключ
 * манифеста или `lesson.engine.json`. Trane его не видит, схема — наша.
 */
import type { Diagnostic } from '@lms/engine-contract';
import { z } from 'zod';
import type { EngineExtension } from '../domain/manifest.ts';
import { diag } from './diagnostics.ts';
import type { DiagnosticLocation } from './diagnostics.ts';

export type UnitKind = 'course' | 'lesson' | 'exercise';

/** Ключи `engine`, допустимые для вида юнита; остальные — предупреждение. */
export const ENGINE_KEYS: Record<UnitKind, readonly string[]> = {
  course: ['requiresChecks', 'tags', 'granularity'],
  lesson: ['keyPrerequisites', 'tags', 'bloom', 'dok', 'nonAncestor'],
  exercise: ['exercise', 'keyPrerequisites', 'tags', 'bloom', 'dok'],
};

const idList = z.array(z.string().min(1));

const positiveInt = z.number().int().min(1);

const granularity = z
  .object({ min: positiveInt.optional(), max: positiveInt.optional() })
  .refine(
    ({ min, max }) => min === undefined || max === undefined || min <= max,
    { message: 'min must not exceed max' },
  );

const engineSchema = z.object({
  exercise: z
    .strictObject({
      type: z.string().min(1),
      timeoutMs: z.number().int().positive().optional(),
      spec: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  keyPrerequisites: idList.optional(),
  tags: idList.optional(),
  bloom: z
    .enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'])
    .optional(),
  dok: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    .optional(),
  requiresChecks: z.boolean().optional(),
  nonAncestor: z.union([z.boolean(), z.array(z.string())]).optional(),
  granularity: granularity.optional(),
});

export interface EngineIssue {
  /** Верхнеуровневый ключ `engine`, к которому относится ошибка (`''` — сам блок). */
  key: string;
  /** Путь внутри `engine`, например `exercise.timeoutMs`. */
  path: string;
  message: string;
}

export type EngineParseResult =
  | { ok: true; value: EngineExtension; unknownKeys: string[] }
  | { ok: false; issues: EngineIssue[]; unknownKeys: string[] };

const MAX_ISSUES = 6;

/**
 * Проверяет объект `engine`. Ключи, не допустимые для вида, попадают в
 * `unknownKeys` и в значение не входят (и не валидируются).
 */
export const parseEngine = (
  raw: unknown,
  kind: UnitKind,
): EngineParseResult => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      unknownKeys: [],
      issues: [{ key: '', path: '', message: '`engine` must be an object' }],
    };
  }
  const allowed = ENGINE_KEYS[kind];
  const unknownKeys: string[] = [];
  const known: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (allowed.includes(key)) known[key] = value;
    else unknownKeys.push(key);
  }
  const result = engineSchema.safeParse(known);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, MAX_ISSUES)
      .map((issue): EngineIssue => ({
        key: String(issue.path[0] ?? ''),
        path: issue.path.join('.'),
        message: issue.message,
      }));
    return { ok: false, issues, unknownKeys };
  }
  return { ok: true, value: result.data as EngineExtension, unknownKeys };
};

export interface EngineSite {
  /** Файл, в котором лежит блок `engine`. */
  path: string;
  /** Строка самого блока; по умолчанию — для ошибок без строки ключа. */
  line?: number;
  unitId?: string;
}

/**
 * Проверяет блок `engine` и записывает диагностики: `E_ENGINE_SCHEMA` на
 * ошибку схемы, `W_ENGINE_UNKNOWN_KEY` на ключ, чужой для вида юнита.
 * `lineFor` уточняет строку по ключу верхнего уровня `engine`.
 */
export const checkEngine = (
  raw: unknown,
  kind: UnitKind,
  site: EngineSite,
  diagnostics: Diagnostic[],
  lineFor?: (key: string) => number | null,
): EngineExtension | null => {
  const locate = (key: string): DiagnosticLocation => {
    const keyLine = key === '' ? null : (lineFor?.(key) ?? null);
    const line = keyLine ?? site.line;
    return {
      path: site.path,
      ...(line !== undefined ? { line } : {}),
      ...(site.unitId !== undefined ? { unitId: site.unitId } : {}),
    };
  };
  const result = parseEngine(raw, kind);
  for (const key of result.unknownKeys) {
    diagnostics.push(
      diag(
        'W_ENGINE_UNKNOWN_KEY',
        `unknown key engine.${key} for a ${kind}`,
        locate(key),
      ),
    );
  }
  if (result.ok) return result.value;
  for (const issue of result.issues) {
    const where = issue.path === '' ? 'engine' : `engine.${issue.path}`;
    diagnostics.push(
      diag('E_ENGINE_SCHEMA', `${where}: ${issue.message}`, locate(issue.key)),
    );
  }
  return null;
};
