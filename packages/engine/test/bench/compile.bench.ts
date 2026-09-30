/**
 * T-57 (engine-ts-testing.md §7.1), M1: компиляция 12k упражнений
 * (3 000 уроков × 4, раскладки KB и JSON) и загрузка артефакта. Запуск:
 * `pnpm -F @dolphy-app/engine bench`. Бенчмарк советует, не блокирует: числа
 * печатаются, регресс более чем вдвое от базы документа — `console.warn`;
 * падает только ошибка корректности (ошибки компиляции, не то число упражнений).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeArtifact,
  encodeArtifact,
  loadCompiled,
} from '../../src/authoring/artifact.ts';
import type { Artifact } from '../../src/authoring/artifact.ts';
import { compile } from '../../src/authoring/compile.ts';
import type { CompileResult } from '../../src/authoring/compile.ts';
import { createNodeFsCourseSource } from '../../src/node/index.ts';
import { MATRIX_EXERCISES, MATRIX_PLAN } from '../helpers/defects.ts';
import { generateLibrary } from '../helpers/gen.ts';
import type { GenOptions } from '../helpers/gen.ts';
import {
  RUNS,
  report,
  summarize,
  timed,
  timedAsync,
  warnOnRegression,
} from './bench-stats.ts';

const EXERCISES = MATRIX_PLAN.lessons * MATRIX_EXERCISES;

/** Числа документа (M1, engine-ts-testing.md §7.1). */
const BASE_MS = { kb: 750, json: 1_200, load: 33 } as const;
const LAYOUTS = [
  'kb',
  'json',
] as const satisfies readonly GenOptions['layout'][];

describe('T-57 компиляция 12k упражнений (KB, JSON) и загрузка артефакта', () => {
  let root = '';
  let artifact: Artifact | null = null;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'engine-compile-bench-'));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const prepare = (layout: GenOptions['layout']) => {
    const dir = join(root, layout);
    generateLibrary({
      out: dir,
      lessons: MATRIX_PLAN.lessons,
      exercises: MATRIX_EXERCISES,
      courses: MATRIX_PLAN.courses,
      layout,
      seed: MATRIX_PLAN.seed,
    });
    return createNodeFsCourseSource(dir);
  };

  it.each(LAYOUTS)('компиляция: раскладка %s', async (layout) => {
    const source = prepare(layout);
    // прогрев: кэш ФС и JIT; в замер идут только повторные прогоны
    const warmup = await compile(source);
    expect(warmup.summary.errors).toBe(0);

    const samples: number[] = [];
    let compiled: Artifact | null = null;
    for (let run = 0; run < RUNS; run++) {
      let result: CompileResult | undefined;
      samples.push(
        await timedAsync(async () => {
          result = await compile(source);
        }),
      );
      expect(result?.summary.errors).toBe(0);
      expect(result?.artifact?.exercises.length).toBe(EXERCISES);
      compiled = result?.artifact ?? null;
    }
    const stats = summarize(samples);
    report(`компиляция ${EXERCISES} упражнений, ${layout}`, stats);
    warnOnRegression(`компиляция ${layout}`, stats.median, BASE_MS[layout]);
    if (layout === 'kb') artifact = compiled;
  });

  it('загрузка артефакта: loadCompiled и decode/encode JSON', async () => {
    const built = artifact ?? (await compile(prepare('kb'))).artifact;
    if (built === null) throw new Error('KB library must compile');
    const text = encodeArtifact(built);
    const loaded: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      let exercises = 0;
      loaded.push(
        timed(() => {
          exercises = loadCompiled(built).exercises.size;
        }),
      );
      expect(exercises).toBe(EXERCISES);
    }
    const decoded: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      let exercises = 0;
      decoded.push(
        timed(() => {
          exercises = decodeArtifact(text).exercises.length;
        }),
      );
      expect(exercises).toBe(EXERCISES);
    }
    const loadStats = summarize(loaded);
    report('загрузка артефакта: loadCompiled (сборка Library)', loadStats);
    report(
      `загрузка артефакта: decodeArtifact (${(text.length / 1e6).toFixed(1)} МБ JSON)`,
      summarize(decoded),
    );
    warnOnRegression('загрузка артефакта', loadStats.median, BASE_MS.load);
  });
});
