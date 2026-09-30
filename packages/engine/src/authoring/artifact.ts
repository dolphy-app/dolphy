/**
 * Артефакт компилятора `.engine/compiled.json`: манифесты с нормализованными
 * путями ассетов, `engine`, граф зависимостей в CSR с флагами транзитивной
 * редукции, сводка диагностик и отпечатки для проверки свежести. Формат —
 * JSON (report-compiler.md §5: загрузка ≈ 33 мс, gzip и v8 не нужны).
 */
import { z } from 'zod';
import type { Diagnostic, DiagnosticSummary } from '@lms/engine-contract';
import { buildIndexedGraph } from '../domain/graph-algorithms.ts';
import { assembleLibrary } from '../domain/library.ts';
import type { Library } from '../domain/library.ts';
import type {
  CourseManifest,
  EngineExtension,
  ExerciseManifest,
  LessonManifest,
} from '../domain/manifest.ts';
import type { Index } from './checks.ts';
import type { Src } from './model.ts';

/** Меняется при любом несовместимом изменении формата, состава или порядка входов `revision`. */
export const FORMAT_VERSION = 2;
export const COMPILER_ID = 'engine-compiler/2';

export interface ArtifactUnit<M> {
  m: M;
  engine?: EngineExtension;
  /** `путь:строка` манифеста или front-файла юнита. */
  src: string;
}

export interface ArtifactGraph {
  /** Курсы, затем уроки. */
  nodes: string[];
  /** CSR объявленных зависимостей: рёбра узла `v` — `targets[offsets[v]..offsets[v+1])`. */
  offsets: number[];
  targets: number[];
  /** `keep[e] = 0` — ребро транзитивно избыточно. */
  keep: number[];
}

export interface Artifact {
  formatVersion: number;
  compiler: string;
  /** sha256 по отсортированным `path\0length\0bytes` входных файлов. */
  revision: string;
  /** Отпечаток `(path, size, mtimeMs, ctimeMs, ino)` на момент компиляции. */
  stat: string;
  inputFiles: number;
  courses: Array<ArtifactUnit<CourseManifest>>;
  lessons: Array<ArtifactUnit<LessonManifest>>;
  exercises: Array<ArtifactUnit<ExerciseManifest>>;
  skippedCourses: string[];
  graph: ArtifactGraph;
  /** `items` — без `info`. */
  diagnostics: { summary: DiagnosticSummary; items: Diagnostic[] };
}

/** Артефакт нечитаем: битый JSON, другой `formatVersion`, повреждён или собран с ошибками. */
export class ArtifactFormatError extends Error {}

export const srcToString = ({ path, line }: Src) =>
  line === undefined ? path : `${path}:${line}`;

const unitOf = <M extends { engine?: EngineExtension }>(unit: {
  manifest: M;
  engine?: EngineExtension;
  src: Src;
}): ArtifactUnit<M> => ({
  m: unit.manifest,
  ...(unit.engine !== undefined ? { engine: unit.engine } : {}),
  src: srcToString(unit.src),
});

/** Манифест с проверенным `engine` внутри (так его видит `Library`). */
export const withEngine = <M extends { engine?: EngineExtension }>(
  manifest: M,
  engine: EngineExtension | undefined,
): M => (engine === undefined ? manifest : { ...manifest, engine });

export interface BuildArtifactInput {
  index: Index;
  revision: string;
  stat: string;
  inputFiles: number;
  diagnostics: readonly Diagnostic[];
  summary: DiagnosticSummary;
  /** Транзитивно избыточные рёбра `[юнит, зависимость]`. */
  redundant: ReadonlyArray<readonly [string, string]>;
}

export const buildArtifact = ({
  index,
  revision,
  stat,
  inputFiles,
  diagnostics,
  summary,
  redundant,
}: BuildArtifactInput): Artifact => {
  const units = index.graphUnits;
  const nodes = units.map(({ manifest }) => manifest.id);
  const dependenciesOf = new Map(
    units.map(({ manifest }) => [manifest.id, manifest.dependencies]),
  );
  const csr = buildIndexedGraph(nodes, (id) => dependenciesOf.get(id));
  const redundantKeys = new Set(
    redundant.map(([unit, dependency]) => `${unit}\0${dependency}`),
  );
  const keep: number[] = [];
  for (let unit = 0; unit < csr.size; unit++) {
    for (
      let e = csr.offsets[unit] as number;
      e < (csr.offsets[unit + 1] as number);
      e++
    ) {
      const key = `${nodes[unit]}\0${nodes[csr.targets[e] as number]}`;
      keep.push(redundantKeys.has(key) ? 0 : 1);
    }
  }
  return {
    formatVersion: FORMAT_VERSION,
    compiler: COMPILER_ID,
    revision,
    stat,
    inputFiles,
    courses: [...index.courses.values()].map(unitOf),
    lessons: [...index.lessons.values()].map(unitOf),
    exercises: [...index.exercises.values()].map(unitOf),
    skippedCourses: [...index.skipped],
    graph: {
      nodes,
      offsets: Array.from(csr.offsets),
      targets: Array.from(csr.targets),
      keep,
    },
    diagnostics: {
      summary,
      items: diagnostics.filter(({ severity }) => severity !== 'info'),
    },
  };
};

export const encodeArtifact = (artifact: Artifact): string =>
  JSON.stringify(artifact);

const ArtifactUnitShape = z.array(
  z.looseObject({ src: z.string(), m: z.looseObject({ id: z.string() }) }),
);

/**
 * Форма артефакта на границе чтения с диска. Манифесты внутри проверять
 * заново не нужно: компилятор пишет только прошедшие схему.
 */
const ArtifactShape = z.looseObject({
  formatVersion: z.literal(FORMAT_VERSION),
  compiler: z.string(),
  revision: z.string(),
  stat: z.string(),
  inputFiles: z.number(),
  courses: ArtifactUnitShape,
  lessons: ArtifactUnitShape,
  exercises: ArtifactUnitShape,
  skippedCourses: z.array(z.string()),
  graph: z.looseObject({
    nodes: z.array(z.string()),
    offsets: z.array(z.number()),
    targets: z.array(z.number()),
    keep: z.array(z.number()),
  }),
  diagnostics: z.looseObject({
    summary: z.looseObject({ errors: z.number() }),
    items: z.array(z.unknown()),
  }),
});

const VersionProbe = z.looseObject({ formatVersion: z.unknown() });

const assertLoadable = (artifact: Artifact) => {
  if (artifact.formatVersion !== FORMAT_VERSION) {
    throw new ArtifactFormatError(
      `artifact formatVersion ${artifact.formatVersion} is not supported (expected ${FORMAT_VERSION}); recompile`,
    );
  }
  if (artifact.diagnostics.summary.errors > 0) {
    throw new ArtifactFormatError('artifact was compiled with errors');
  }
};

export const decodeArtifact = (text: string): Artifact => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ArtifactFormatError('artifact is not valid JSON', {
      cause: error,
    });
  }
  // версию читаем до формы: у другой версии форма может быть иной
  const probe = VersionProbe.safeParse(value);
  if (!probe.success)
    throw new ArtifactFormatError('artifact is not an object');
  if (probe.data.formatVersion !== FORMAT_VERSION) {
    throw new ArtifactFormatError(
      `artifact formatVersion ${String(probe.data.formatVersion)} is not supported (expected ${FORMAT_VERSION}); recompile`,
    );
  }
  const shape = ArtifactShape.safeParse(value);
  if (!shape.success) {
    throw new ArtifactFormatError('artifact is corrupt', {
      cause: shape.error,
    });
  }
  // форма проверена выше, содержимое манифестов и диагностик пишет компилятор
  const artifact = shape.data as unknown as Artifact;
  assertLoadable(artifact);
  return artifact;
};

/**
 * Библиотека из артефакта. Проверка циклов по умолчанию пропущена: артефакт
 * без ошибок компилятор уже проверил.
 */
export const loadCompiled = (
  artifact: Artifact,
  { cycleCheck = false }: { cycleCheck?: boolean } = {},
): Library => {
  assertLoadable(artifact);
  return assembleLibrary(
    artifact.courses.map(({ m, engine }) => withEngine(m, engine)),
    artifact.lessons.map(({ m, engine }) => withEngine(m, engine)),
    artifact.exercises.map(({ m, engine }) => withEngine(m, engine)),
    { cycleCheck },
  );
};

/** Транзитивно избыточные рёбра `[юнит, зависимость]` по флагам `keep`. */
export const redundantEdgesOf = (
  artifact: Artifact,
): Array<[string, string]> => {
  const { nodes, offsets, targets, keep } = artifact.graph;
  const edges: Array<[string, string]> = [];
  nodes.forEach((unit, v) => {
    for (let e = offsets[v] as number; e < (offsets[v + 1] as number); e++) {
      if (keep[e] === 0) {
        edges.push([unit, nodes[targets[e] as number] as string]);
      }
    }
  });
  return edges;
};
