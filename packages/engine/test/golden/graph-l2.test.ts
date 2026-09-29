/**
 * Golden L2: граф, который TS-загрузчик строит по каталогу, равен графу
 * настоящего Rust-Trane (`LocalCourseLibrary::new`) по всем 15 секциям дампа.
 * Дампы — `test/fixtures/rust-dumps` (перегенерация:
 * `test/helpers/regenerate-rust-dumps.ts`); в обычном прогоне Rust не запускается.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDirectory } from '../../src/authoring/load-directory.ts';
import { createNodeFsCourseSource } from '../../src/node/index.ts';
import {
  diffDumps,
  dumpLibrary,
  RELATION_SECTIONS,
  restrictToCourses,
  SECTIONS,
} from '../helpers/graph-dump.ts';
import type { Dump } from '../helpers/graph-dump.ts';
import {
  DUMP_CASES,
  hashTree,
  RUST_DUMPS_DIR,
  RUST_DUMPS_MANIFEST,
  sha256,
} from '../helpers/rust-dumps.ts';
import type { DumpManifest } from '../helpers/rust-dumps.ts';

let tmp: string;
let manifest: DumpManifest;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'graph-l2-'));
  manifest = JSON.parse(await readFile(RUST_DUMPS_MANIFEST, 'utf8'));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const readDump = async (name: string) => {
  const entry = manifest.dumps[name];
  if (entry?.file === undefined || entry.file === null) {
    throw new Error(`Rust dump ${name} is not stored`);
  }
  const text = await readFile(join(RUST_DUMPS_DIR, entry.file), 'utf8');
  return { entry, text, dump: JSON.parse(text) as Dump };
};

describe('golden L2: граф TS = граф Rust-Trane', () => {
  it('MANIFEST описывает каждый случай, а дампы не подменены (sha256)', async () => {
    expect(Object.keys(manifest.dumps).sort()).toEqual(
      DUMP_CASES.map(({ name }) => name).sort(),
    );
    for (const { name } of DUMP_CASES) {
      const { entry, text } = await readDump(name);
      expect(sha256(text), name).toBe(entry.sha256);
      expect(Buffer.byteLength(text), name).toBe(entry.bytes);
    }
  });

  describe.each(DUMP_CASES)('$name', (dumpCase) => {
    it('все секции дампа равны', async () => {
      const { root } = await dumpCase.prepare(tmp);
      const { entry, dump: expected } = await readDump(dumpCase.name);
      // дамп снят именно с этой библиотеки, а не с её прежней версии
      expect(await hashTree(root)).toBe(entry.libraryTreeSha256);

      const source = createNodeFsCourseSource(root);
      const { library, diagnostics } = await loadDirectory(source, {
        scan: { ignoredPaths: dumpCase.ignoredPaths },
      });
      expect(
        diagnostics.filter(({ severity }) => severity === 'error'),
      ).toEqual([]);
      expect(library).not.toBeNull();
      if (library === null) return;

      const counts = entry.counts;
      const actual = dumpLibrary(library);
      if (dumpCase.scope === 'course-skeleton') {
        const courseIds = expected.courseIds as string[];
        expect([...library.courses.keys()].sort()).toEqual(courseIds);
        const diffs = diffDumps(
          restrictToCourses(actual, new Set(courseIds)),
          expected,
          RELATION_SECTIONS,
        );
        expect(diffs.filter(({ differing }) => differing > 0)).toEqual([]);
        expect(counts.courses).toBe(courseIds.length);
        return;
      }
      expect(library.courses.size).toBe(counts.courses);
      expect(library.lessons.size).toBe(counts.lessons);
      expect(library.exercises.size).toBe(counts.exercises);
      const diffs = diffDumps(actual, expected, SECTIONS);
      expect(diffs.filter(({ differing }) => differing > 0)).toEqual([]);
      // все 15 секций сверены; дамп Rust не пуст
      expect(diffs).toHaveLength(15);
      expect(Object.keys(expected.units as object)).toHaveLength(
        counts.courses + counts.lessons + counts.exercises,
      );
    }, 120_000);
  });

  it('сверка чувствительна: потерянное ребро и сдвиг веса охвата видны', async () => {
    const { root } = await DUMP_CASES.find(
      ({ name }) => name === 'synthetic-window-600',
    )!.prepare(tmp);
    const { library } = await loadDirectory(createNodeFsCourseSource(root));
    const { dump: expected } = await readDump('synthetic-window-600');
    const actual = dumpLibrary(library!);

    const dependencies = {
      ...(actual.dependencies as Record<string, string[]>),
    };
    const [victim] = Object.keys(dependencies);
    dependencies[victim!] = (dependencies[victim!] as string[]).slice(1);
    const lost = diffDumps({ ...actual, dependencies }, expected, [
      'dependencies',
    ]);
    expect(lost[0]?.differing).toBe(1);

    const encompasses = {
      ...(actual.encompasses as Record<string, [string, number][]>),
    };
    const [heavy] = Object.keys(encompasses);
    encompasses[heavy!] = encompasses[heavy!]!.map(([id, w]) => [id, w / 2]);
    const shifted = diffDumps({ ...actual, encompasses }, expected, [
      'encompasses',
    ]);
    expect(shifted[0]?.differing).toBe(1);
  });
});
