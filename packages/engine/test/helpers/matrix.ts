/**
 * Матрица дефектов (T-32): синтетическая библиотека 3000×4 в tmp, чистый
 * прогон компилятора, внесение дефектов, повторный прогон, сверка.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Diagnostic } from '@lms/engine-contract';
import { compile } from '../../src/authoring/compile.ts';
import { createNodeFsCourseSource } from '../../src/node/index.ts';
import {
  evaluate,
  injectJson,
  injectKb,
  MATRIX_EXERCISES,
  MATRIX_PLAN,
} from './defects.ts';
import type { Evaluation, Injected, Layout } from './defects.ts';
import { generateLibrary } from './gen.ts';

export interface MatrixResult extends Evaluation {
  layout: Layout;
  injected: Injected;
  diagnostics: Diagnostic[];
  /** Warning/error чистой библиотеки до внесения дефектов. */
  cleanNonInfo: Diagnostic[];
  defectiveErrors: number;
  ms: number;
}

export const runMatrix = async (layout: Layout): Promise<MatrixResult> => {
  const dir = await mkdtemp(`${tmpdir()}/engine-matrix-${layout}-`);
  try {
    generateLibrary({
      out: dir,
      lessons: MATRIX_PLAN.lessons,
      exercises: MATRIX_EXERCISES,
      courses: MATRIX_PLAN.courses,
      layout,
      seed: MATRIX_PLAN.seed,
    });
    const source = createNodeFsCourseSource(dir);
    const clean = await compile(source);
    const cleanNonInfo = clean.diagnostics.filter(
      ({ severity }) => severity !== 'info',
    );
    const injected = layout === 'kb' ? injectKb(dir) : injectJson(dir);
    const started = performance.now();
    const result = await compile(source);
    const ms = performance.now() - started;
    return {
      layout,
      injected,
      diagnostics: result.diagnostics,
      ...evaluate(result.diagnostics, injected),
      cleanNonInfo,
      defectiveErrors: result.summary.errors,
      ms,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
