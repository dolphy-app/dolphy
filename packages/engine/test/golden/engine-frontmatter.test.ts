/**
 * T-36: Rust-Trane открывает курс с расширением `engine` (YAML-frontmatter в
 * front-файлах, `lesson.engine.json`, ключ `engine` в манифестах) без
 * ошибок, и его граф равен графу TS-загрузчика. Дамп снят настоящим
 * `dump-rs` (см. MANIFEST.json); здесь Rust не запускается.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDirectory } from '../../src/authoring/load-directory.ts';
import { createNodeFsCourseSource } from '../../src/node/index.ts';
import { diffDumps, dumpLibrary, SECTIONS } from '../helpers/graph-dump.ts';
import type { Dump } from '../helpers/graph-dump.ts';
import {
  hashTree,
  prepareEngineFrontmatterLibrary,
  RUST_DUMPS_DIR,
  RUST_DUMPS_MANIFEST,
  sha256,
} from '../helpers/rust-dumps.ts';
import type { DumpManifest } from '../helpers/rust-dumps.ts';
import { useTmpDirs } from '../helpers/tmp.ts';

const tmp = useTmpDirs();
const NAME = 'trane-small-engine';

describe('T-36: курс с engine открывается Rust-Trane', () => {
  it('Rust: 4 курса, 128 уроков, 132 упражнения; TS видит то же и тот же граф', async () => {
    const manifest = JSON.parse(
      await readFile(RUST_DUMPS_MANIFEST, 'utf8'),
    ) as DumpManifest;
    const entry = manifest.dumps[NAME];
    if (!entry?.file) throw new Error(`no stored dump ${NAME}`);
    const text = await readFile(join(RUST_DUMPS_DIR, entry.file), 'utf8');
    expect(sha256(text)).toBe(entry.sha256);
    expect(manifest.dumper.trane).toBe('0.34.1');
    // 126 упражнений и уроков trane-small + JSON-курс из 2 уроков по 3 упражнения
    expect(entry.counts).toEqual({ courses: 4, lessons: 128, exercises: 132 });

    const root = join(await tmp.make('engine-t36-'), 'library');
    await prepareEngineFrontmatterLibrary(root);
    expect(await hashTree(root)).toBe(entry.libraryTreeSha256);

    const { library, diagnostics } = await loadDirectory(
      createNodeFsCourseSource(root),
    );
    expect(diagnostics.filter(({ severity }) => severity !== 'info')).toEqual(
      [],
    );
    if (library === null) throw new Error('library is not loaded');
    expect(library.courses.size).toBe(4);
    expect(library.lessons.size).toBe(128);
    expect(library.exercises.size).toBe(132);

    const rust = JSON.parse(text) as Dump;
    const diffs = diffDumps(dumpLibrary(library), rust, SECTIONS);
    expect(diffs.filter(({ differing }) => differing > 0)).toEqual([]);
  });

  it('TS прочитал engine из всех источников: 38 упражнений, 27 уроков, 2 курса', async () => {
    const root = join(await tmp.make('engine-t36-'), 'library');
    await prepareEngineFrontmatterLibrary(root);
    const { library } = await loadDirectory(createNodeFsCourseSource(root));
    if (library === null) throw new Error('library is not loaded');
    const withEngine = (maps: ReadonlyMap<string, { engine?: object }>) =>
      [...maps.values()].filter(({ engine }) => engine !== undefined).length;
    // frontmatter у каждого 4-го из 126 front-файлов (32) + JSON-курс:
    // e0 и e2 — ключом манифеста, e1 — frontmatter, в двух уроках (6)
    expect(withEngine(library.exercises)).toBe(38);
    // lesson.engine.json у каждого 5-го из 126 уроков (26) + `engine` урока JSON-курса
    expect(withEngine(library.lessons)).toBe(27);
    // ключ `engine` в манифесте sing_the_numbers_1 и в JSON-курсе
    expect(withEngine(library.courses)).toBe(2);
    expect(library.courses.get('engine::json')?.engine?.requiresChecks).toBe(
      true,
    );
  });
});
