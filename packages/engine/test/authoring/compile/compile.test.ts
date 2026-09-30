import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { buildLibrary, createMemoryCourseSource } from '@lms/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ArtifactFormatError,
  decodeArtifact,
  encodeArtifact,
  loadCompiled,
  redundantEdgesOf,
} from '../../../src/authoring/artifact.ts';
import { compile } from '../../../src/authoring/compile.ts';
import { loadDirectory } from '../../../src/authoring/load-directory.ts';
import type { Library } from '../../../src/domain/library.ts';
import { createNodeFsCourseSource } from '../../../src/node/index.ts';
import { LIBRARIES_DIR, TRANE_LIBRARIES } from '../../helpers/fixtures.ts';
import { generateLibrary } from '../../helpers/gen.ts';
import { graphSnapshot } from '../../helpers/graph-snapshot.ts';
import { loadLibraryRef } from '../../helpers/loader-ref.ts';

const LIBRARIES: Record<string, string> = {
  embedded: TRANE_LIBRARIES.embedded,
  small: TRANE_LIBRARIES.small,
  large: TRANE_LIBRARIES.large,
  sql_json: `${LIBRARIES_DIR}/sql-course/lib_json`,
  sql_kb: `${LIBRARIES_DIR}/sql-course/lib_kb`,
};
const JSON_LAYOUTS = ['embedded', 'sql_json', 'synthetic_json'];

const temporary: string[] = [];
beforeAll(() => {
  for (const layout of ['kb', 'json'] as const) {
    const out = mkdtempSync(`${tmpdir()}/compile-test-${layout}-`);
    temporary.push(out);
    generateLibrary({
      out,
      lessons: 300,
      exercises: 4,
      courses: 3,
      layout,
      seed: 7,
    });
    LIBRARIES[`synthetic_${layout}`] = out;
  }
});
afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

const sourceOf = (name: string) =>
  createNodeFsCourseSource(LIBRARIES[name] as string);

const severities = (
  diagnostics: ReadonlyArray<{ severity: string }>,
  severity: string,
) => diagnostics.filter((d) => d.severity === severity);

describe('clean libraries (T-33)', () => {
  it('embedded_test_library: 0 errors, 0 warnings, 1 info', async () => {
    const result = await compile(sourceOf('embedded'));
    expect(result.summary).toEqual({ errors: 0, warnings: 0, infos: 1 });
    expect(result.artifact).not.toBeNull();
  });

  it('small_test_library: 0 errors, 0 warnings, 126 info', async () => {
    const result = await compile(sourceOf('small'));
    expect(result.summary).toEqual({ errors: 0, warnings: 0, infos: 126 });
  });

  it('large_test_library: no errors and exactly 48 unsupported Transcription generators with path:line', async () => {
    const result = await compile(sourceOf('large'));
    expect(result.summary.errors).toBe(0);
    const unsupported = result.diagnostics.filter(
      (d) => d.code === 'W_UNSUPPORTED_GENERATOR',
    );
    expect(unsupported).toHaveLength(48);
    expect(
      unsupported.every(
        (d) => d.path?.endsWith('course_manifest.json') && d.line !== undefined,
      ),
    ).toBe(true);
    expect(severities(result.diagnostics, 'warning')).toHaveLength(48);
  });

  it.each(['synthetic_kb', 'synthetic_json'])(
    '%s (300 lessons x 4) has no warnings at all',
    async (name) => {
      const result = await compile(sourceOf(name));
      expect(result.diagnostics.filter((d) => d.severity !== 'info')).toEqual(
        [],
      );
      expect(result.artifact).not.toBeNull();
    },
  );

  it.each(['sql_json', 'sql_kb'])('%s has no errors', async (name) => {
    const result = await compile(sourceOf(name));
    expect(severities(result.diagnostics, 'error')).toEqual([]);
    expect(result.artifact).not.toBeNull();
  });
});

describe('several defects at once (T-17)', () => {
  const library = buildLibrary({
    courses: [
      {
        id: 'a',
        lessons: [
          { id: 'l0', dependencies: ['l2'], exercises: 1 },
          { id: 'l1', dependencies: ['l0'], exercises: 1 },
          { id: 'l2', dependencies: ['l1'], exercises: 1 },
          { id: 'l3', dependencies: ['ghost'], exercises: 1 },
          { id: 'l4', exercises: 1 },
          { id: 'l5', dependencies: ['l4'], exercises: 1 },
          { id: 'l6', dependencies: ['l5', 'l4'], exercises: 1 },
        ],
      },
    ],
  });
  const extra = {
    // курс с неподдерживаемым генератором
    'lit/course_manifest.json': JSON.stringify({
      id: 'lit',
      name: 'Literacy',
      generator_config: { Literacy: {} },
    }),
    // упражнение с несуществующим ассетом
    'a/l4/broken/exercise_manifest.json': JSON.stringify({
      id: 'a::l4::broken',
      lesson_id: 'a::l4',
      course_id: 'a',
      name: 'broken',
      exercise_asset: { FlashcardAsset: { front_path: 'nope.md' } },
    }),
    'a/l4/notjson/exercise_manifest.json': '{ not json',
  };

  it('reports all of them in one pass and emits no artifact', async () => {
    const source = createMemoryCourseSource(library, extra);
    const result = await compile(source);
    const codes = new Set(result.diagnostics.map((d) => d.code));
    for (const code of [
      'E_CYCLE_DEPENDENCY',
      'E_DEP_MISSING',
      'W_REDUNDANT_EDGE',
      'W_UNSUPPORTED_GENERATOR',
      'E_ASSET_MISSING',
      'E_JSON_PARSE',
    ] as const) {
      expect(codes, code).toContain(code);
    }
    expect(result.artifact).toBeNull();
    expect(result.summary.errors).toBeGreaterThanOrEqual(4);
    expect(source.files.has('.engine/compiled.json')).toBe(false);
  });

  it('diagnostics are sorted: errors first, then by file', async () => {
    const { diagnostics } = await compile(
      createMemoryCourseSource(library, extra),
    );
    const rank = { error: 0, warning: 1, info: 2 } as const;
    const ranks = diagnostics.map((d) => rank[d.severity]);
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
    const errors = severities(diagnostics, 'error') as typeof diagnostics;
    const paths = errors.map((d) => d.path ?? '');
    expect(paths).toEqual([...paths].sort());
  });

  it("emit: 'always' keeps the artifact of a library with errors, but it is not loadable", async () => {
    const source = createMemoryCourseSource(library, extra);
    const { artifact } = await compile(source, { emit: 'always' });
    expect(artifact).not.toBeNull();
    if (artifact === null) return;
    expect(artifact.diagnostics.summary.errors).toBeGreaterThan(0);
    expect(() => decodeArtifact(encodeArtifact(artifact))).toThrow(
      ArtifactFormatError,
    );
    expect(() => loadCompiled(artifact)).toThrow(ArtifactFormatError);
  });

  it('loadDirectory refuses the same library and returns diagnostics instead of throwing', async () => {
    const result = await loadDirectory(
      createMemoryCourseSource(library, extra),
    );
    expect(result.library).toBeNull();
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain('E_CYCLE_DEPENDENCY');
    expect(codes).toContain('E_JSON_PARSE');
  });
});

describe('artifact', () => {
  it('marks the transitively redundant edge and keeps the rest', async () => {
    const library = buildLibrary({
      courses: [
        {
          id: 'x',
          lessons: [
            { id: 'l0', exercises: 1 },
            { id: 'l1', dependencies: ['l0'], exercises: 1 },
            { id: 'l2', dependencies: ['l1', 'l0'], exercises: 1 },
          ],
        },
      ],
    });
    const { artifact } = await compile(createMemoryCourseSource(library));
    expect(artifact).not.toBeNull();
    if (artifact === null) return;
    expect(redundantEdgesOf(artifact)).toEqual([['x::l2', 'x::l0']]);
    const kept = artifact.graph.keep.filter((flag) => flag === 1).length;
    expect(kept).toBe(2);
    expect(artifact.diagnostics.items.map((d) => d.code)).toEqual([
      'W_REDUNDANT_EDGE',
    ]);
  });

  it('src of a unit is `path:line` of its manifest', async () => {
    const { artifact } = await compile(sourceOf('embedded'));
    const [course] = artifact?.courses ?? [];
    expect(course?.src).toMatch(/course_manifest\.json:\d+$/);
  });

  it('decodeArtifact rejects a different formatVersion, broken JSON and a corrupt shape', async () => {
    const { artifact } = await compile(sourceOf('embedded'));
    if (artifact === null) throw new Error('embedded must compile');
    expect(() =>
      decodeArtifact(JSON.stringify({ ...artifact, formatVersion: 99 })),
    ).toThrow(/formatVersion/);
    expect(() => decodeArtifact('{"formatVersion":1')).toThrow(
      ArtifactFormatError,
    );
    expect(() => decodeArtifact('[]')).toThrow(ArtifactFormatError);
    const { graph: dropped, ...withoutGraph } = artifact;
    expect(dropped).toBeDefined();
    expect(() => decodeArtifact(JSON.stringify(withoutGraph))).toThrow(
      ArtifactFormatError,
    );
    expect(() => loadCompiled({ ...artifact, formatVersion: 3 })).toThrow(
      ArtifactFormatError,
    );
  });
});

const stripEngine = <M extends { engine?: unknown }>(
  manifests: ReadonlyMap<string, M>,
) =>
  new Map(
    [...manifests].map(([id, { engine, ...rest }]) => {
      void engine;
      return [id, rest];
    }),
  );

const hasEngine = (library: Library) =>
  [library.courses, library.lessons, library.exercises].some((map) =>
    [...map.values()].some((manifest) => manifest.engine !== undefined),
  );

describe('loadCompiled == loadDirectory (T-34)', () => {
  it.each(Object.keys(LIBRARIES).concat(['synthetic_kb', 'synthetic_json']))(
    '%s',
    async (name) => {
      const source = sourceOf(name);
      const { artifact } = await compile(source);
      if (artifact === null) throw new Error(`${name} must compile`);
      const directory = await loadDirectory(source);
      const compiled = loadCompiled(decodeArtifact(encodeArtifact(artifact)), {
        cycleCheck: true,
      });
      expect(directory.library).not.toBeNull();
      const expected = directory.library as Library;
      expect(graphSnapshot(compiled)).toEqual(graphSnapshot(expected));
      expect([...compiled.exercises.keys()].sort()).toEqual(
        [...expected.exercises.keys()].sort(),
      );
      // манифесты, включая `engine`, совпадают целиком
      expect(compiled.courses).toEqual(expected.courses);
      expect(compiled.lessons).toEqual(expected.lessons);
      expect(compiled.exercises).toEqual(expected.exercises);
      if (name.startsWith('synthetic') || name.startsWith('sql')) {
        expect(hasEngine(expected)).toBe(true);
      }
    },
    120_000,
  );

  it.each(JSON_LAYOUTS)(
    '%s: loadDirectory equals the reference loader',
    async (name) => {
      const { library } = await loadDirectory(sourceOf(name));
      const reference = loadLibraryRef(LIBRARIES[name] as string);
      if (library === null) throw new Error(`${name} must load`);
      expect(graphSnapshot(library)).toEqual(graphSnapshot(reference));
      expect(stripEngine(library.courses)).toEqual(reference.courses);
      expect(stripEngine(library.lessons)).toEqual(reference.lessons);
      expect(stripEngine(library.exercises)).toEqual(reference.exercises);
    },
    120_000,
  );
});

describe('revision', () => {
  const libraryOf = () =>
    buildLibrary({
      courses: [
        {
          id: 'x',
          lessons: [
            { id: 'l0', exercises: 2 },
            { id: 'l1', dependencies: ['l0'], exercises: 2 },
          ],
        },
      ],
    });

  /** Независимый пересчёт: отсортированные `path\0length\0bytes` без dot-каталогов. */
  const expectedRevision = (files: ReadonlyMap<string, string>) => {
    const hash = createHash('sha256');
    const paths = [...files.keys()]
      .filter(
        (path) =>
          !path
            .split('/')
            .some((part, i, all) => i < all.length - 1 && part.startsWith('.')),
      )
      .sort();
    for (const path of paths) {
      const bytes = Buffer.from(files.get(path) as string);
      hash.update(`${path}\0${bytes.length}\0`);
      hash.update(bytes);
    }
    return hash.digest('hex');
  };

  it('is the sha256 over sorted path, length and bytes of every input', async () => {
    const source = createMemoryCourseSource(libraryOf());
    const { artifact } = await compile(source);
    expect(artifact?.revision).toBe(expectedRevision(source.files));
    expect(artifact?.inputFiles).toBe(source.files.size);
  });

  it('changes when one byte of one file changes and only then', async () => {
    const base = await compile(createMemoryCourseSource(libraryOf()));
    const same = await compile(createMemoryCourseSource(libraryOf()));
    expect(same.artifact?.revision).toBe(base.artifact?.revision);
    const edited = await compile(
      createMemoryCourseSource(libraryOf(), {
        'x/l0/e0/back.md': 'Back of x::l0::e1\n',
      }),
    );
    expect(edited.artifact?.revision).not.toBe(base.artifact?.revision);
    const oneByte = await compile(
      createMemoryCourseSource(libraryOf(), {
        'x/l0/e0/front.md': 'Front of x::l0::e0!\n',
      }),
    );
    expect(oneByte.artifact?.revision).not.toBe(base.artifact?.revision);
    expect(oneByte.artifact?.revision).not.toBe(edited.artifact?.revision);
  });

  it('ignores the artifact itself and dot-directories, and honours excludeFromRevision', async () => {
    const source = createMemoryCourseSource(libraryOf(), {
      'x/l0/e0/notes.txt': 'draft',
    });
    const first = await compile(source);
    await source.writeArtifact('{"anything":true}');
    const withArtifact = await compile(source);
    expect(withArtifact.artifact?.revision).toBe(first.artifact?.revision);

    const withDotDir = await compile(
      createMemoryCourseSource(libraryOf(), {
        'x/l0/e0/notes.txt': 'draft',
        '.git/HEAD': 'ref: refs/heads/main',
      }),
    );
    expect(withDotDir.artifact?.revision).toBe(first.artifact?.revision);

    const changedNotes = createMemoryCourseSource(libraryOf(), {
      'x/l0/e0/notes.txt': 'draft 2',
    });
    const changed = await compile(changedNotes);
    expect(changed.artifact?.revision).not.toBe(first.artifact?.revision);
    const excluded = await compile(changedNotes, {
      excludeFromRevision: ['x/l0/e0/notes.txt'],
    });
    const excludedBase = await compile(source, {
      excludeFromRevision: ['x/l0/e0/notes.txt'],
    });
    expect(excluded.artifact?.revision).toBe(excludedBase.artifact?.revision);
  });
});
