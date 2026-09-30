/**
 * Библиотеки, для которых лежат дампы графа настоящего Rust-Trane
 * (`test/fixtures/rust-dumps/<имя>.json`), и способ их материализации.
 * Один источник правды для тестов и для `regenerate-rust-dumps.ts`.
 */
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { FIXTURES_DIR, LIBRARIES_DIR, TRANE_LIBRARIES } from './fixtures.ts';
import { generateLoaderLibrary } from './loader-gen.ts';

export const RUST_DUMPS_DIR = `${FIXTURES_DIR}/rust-dumps`;
export const RUST_DUMPS_MANIFEST = `${RUST_DUMPS_DIR}/MANIFEST.json`;

export interface PreparedLibrary {
  root: string;
  /** Файл `user_preferences.json` для дампера. */
  prefs?: string;
}

export interface DumpCase {
  name: string;
  description: string;
  /** `course-skeleton`: сверяются только отношения между курсами. */
  scope: 'full' | 'course-skeleton';
  /** `ignored_paths` настроек (TS получает их параметром скана). */
  ignoredPaths: readonly string[];
  /** Параметры генерации библиотеки (для MANIFEST). */
  params?: Record<string, unknown>;
  prepare(tmp: string): Promise<PreparedLibrary>;
}

const existing =
  (root: string): DumpCase['prepare'] =>
  async () => {
    const prefs = join(root, 'user_preferences.json');
    try {
      statSync(prefs);
      return { root, prefs };
    } catch {
      return { root };
    }
  };

const BANDED = {
  lessons: 300,
  exercises: [3, 5],
  deps: 3,
  courses: 1,
  topology: 'banded',
  rich: false,
  seed: 1,
} as const;

const WINDOW = {
  lessons: 600,
  exercises: [3, 5],
  deps: 3,
  courses: 12,
  topology: 'window',
  rich: true,
  seed: 2,
} as const;

const ENGINE_FRONT = [
  '---',
  'engine:',
  '  exercise:',
  '    type: dolphy.sql',
  '    timeoutMs: 2000',
  '  tags: [sing, numbers]',
  '  bloom: apply',
  '  dok: 2',
  '---',
  '',
].join('\n');

const ENGINE_FRONT_LIGHT = [
  '---',
  'engine:',
  '  tags: [sing, numbers]',
  '  bloom: understand',
  '  dok: 1',
  '---',
  '',
].join('\n');

const listFiles = (dir: string, suffix: string): string[] => {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith(suffix)) found.push(path);
    }
  };
  walk(dir);
  return found.sort();
};

/**
 * T-36: копия `trane-small` (KB-курсы) с расширением `engine`: YAML-frontmatter
 * в `<ex>.front.md` (каждый 4-й файл, у каждого 8-го — с `engine.exercise`),
 * `lesson.engine.json` (каждый 5-й урок), `engine` в манифесте курса и
 * малый JSON-курс `engine_json` с `engine` в манифестах и во frontmatter.
 */
export const prepareEngineFrontmatterLibrary = async (
  dest: string,
): Promise<PreparedLibrary> => {
  cpSync(TRANE_LIBRARIES.small, dest, { recursive: true });
  const fronts = listFiles(dest, '.front.md');
  for (const [index, path] of fronts.entries()) {
    if (index % 4 !== 0) continue;
    const text = readFileSync(path, 'utf8');
    const block = index % 8 === 0 ? ENGINE_FRONT : ENGINE_FRONT_LIGHT;
    await writeFile(path, block + text);
  }
  const lessonDirs = [
    ...new Set(fronts.map((path) => join(path, '..'))),
  ].sort();
  for (const [index, dir] of lessonDirs.entries()) {
    if (index % 5 !== 0) continue;
    await writeFile(
      join(dir, 'lesson.engine.json'),
      `${JSON.stringify({ tags: ['core'], bloom: 'understand', dok: 2 }, null, 2)}\n`,
    );
  }
  const courseManifest = join(
    dest,
    'improvise_for_real/sing_the_numbers_1/course_manifest.json',
  );
  const course = JSON.parse(readFileSync(courseManifest, 'utf8')) as object;
  await writeFile(
    courseManifest,
    `${JSON.stringify({ ...course, engine: { tags: ['music'] } }, null, 2)}\n`,
  );

  const json = async (path: string, value: unknown) => {
    mkdirSync(join(path, '..'), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  };
  const courseId = 'engine::json';
  const base = join(dest, 'engine_json');
  await json(join(base, 'course_manifest.json'), {
    id: courseId,
    name: 'Engine JSON course',
    dependencies: [],
    engine: { requiresChecks: true, tags: ['sql'] },
  });
  const exercise = (n: number) => ({
    type: 'dolphy.sql',
    timeoutMs: 2000,
    spec: {
      fixture: 'fixtures/emp.sql',
      expected: `checks/engine-json-${n}.csv`,
    },
  });
  for (const [l, dependencies] of [
    [0, []],
    [1, [0]],
  ] as const) {
    const lessonId = `${courseId}::l${l}`;
    const lessonDir = join(base, `l${l}`);
    await json(join(lessonDir, 'lesson_manifest.json'), {
      id: lessonId,
      course_id: courseId,
      name: `Lesson ${l}`,
      dependencies: dependencies.map((d) => `${courseId}::l${d}`),
      ...(l === 1 ? { engine: { tags: ['second'], bloom: 'apply' } } : {}),
    });
    for (let e = 0; e < 3; e++) {
      const dir = join(lessonDir, `e${e}`);
      await json(join(dir, 'exercise_manifest.json'), {
        id: `${lessonId}::e${e}`,
        lesson_id: lessonId,
        course_id: courseId,
        name: `Exercise ${e}`,
        exercise_type: 'Procedural',
        exercise_asset: {
          FlashcardAsset: { front_path: 'front.md', back_path: 'back.md' },
        },
        // e1 берёт `engine` из frontmatter, остальные — из манифеста
        ...(e === 1 ? {} : { engine: { exercise: exercise(l * 3 + e) } }),
      });
      const front =
        e === 1
          ? `---\nengine:\n  exercise:\n    type: dolphy.sql\n    timeoutMs: 2000\n---\nSELECT ${l}.\n`
          : `SELECT ${l}.\n`;
      await writeFile(join(dir, 'front.md'), front);
      await writeFile(join(dir, 'back.md'), 'Answer.\n');
    }
  }
  return { root: dest, prefs: join(dest, 'user_preferences.json') };
};

export const DUMP_CASES: readonly DumpCase[] = [
  {
    name: 'trane-embedded',
    description: 'Библиотека Trane: 1 курс, 1 урок, 1 упражнение (JSON)',
    scope: 'full',
    ignoredPaths: [],
    prepare: existing(TRANE_LIBRARIES.embedded),
  },
  {
    name: 'sql-course-json',
    description: 'sql-course, JSON-манифесты, 7 уроков, engine во всех формах',
    scope: 'full',
    ignoredPaths: [],
    prepare: existing(`${LIBRARIES_DIR}/sql-course/lib_json`),
  },
  {
    name: 'sql-course-kb',
    description: 'sql-course, KnowledgeBase-курс, engine во frontmatter',
    scope: 'full',
    ignoredPaths: [],
    prepare: existing(`${LIBRARIES_DIR}/sql-course/lib_kb`),
  },
  {
    name: 'synthetic-banded-300',
    description: '300 уроков, 1 курс, топология banded, охват = зависимости',
    scope: 'full',
    ignoredPaths: [],
    params: BANDED,
    prepare: async (tmp) => {
      const root = join(tmp, 'banded-300');
      generateLoaderLibrary({ out: root, ...BANDED, exercises: [3, 5] });
      return { root };
    },
  },
  {
    name: 'synthetic-window-600',
    description:
      '600 уроков, 12 курсов, окно, явные encompassed/superseded/metadata/материалы',
    scope: 'full',
    ignoredPaths: [],
    params: WINDOW,
    prepare: async (tmp) => {
      const root = join(tmp, 'window-600');
      generateLoaderLibrary({ out: root, ...WINDOW, exercises: [3, 5] });
      return { root };
    },
  },
  {
    name: 'edge-cases',
    description:
      'Крайние случаи: пропавшие ссылки, ignored_paths, вложенный курс, `../` и `/` в путях, манифест в корне',
    scope: 'full',
    ignoredPaths: ['ign'],
    prepare: existing(`${LIBRARIES_DIR}/edge-cases`),
  },
  {
    name: 'trane-small',
    description: 'Библиотека Trane: 3 KB-курса, 126 уроков',
    scope: 'full',
    ignoredPaths: [],
    prepare: existing(TRANE_LIBRARIES.small),
  },
  {
    name: 'trane-large',
    description:
      'Библиотека Trane: 51 курс (48 Transcription); TS их уроки пропускает — сверяется скелет курсов',
    scope: 'course-skeleton',
    ignoredPaths: [],
    prepare: existing(TRANE_LIBRARIES.large),
  },
  {
    name: 'trane-small-engine',
    description:
      'T-36: trane-small + engine во frontmatter, lesson.engine.json, ключ engine и JSON-курс',
    scope: 'full',
    ignoredPaths: [],
    prepare: (tmp) =>
      prepareEngineFrontmatterLibrary(join(tmp, 'small-engine')),
  },
];

/** sha256 дерева: отсортированные `путь\0длина\0байты` (как content-revision). */
export const hashTree = async (root: string): Promise<string> => {
  const hash = createHash('sha256');
  const walk = async (dir: string): Promise<string[]> => {
    const files: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await walk(path)));
      else files.push(path);
    }
    return files;
  };
  const files = (await walk(root))
    .map((path) => relative(root, path).split('\\').join('/'))
    .sort();
  for (const file of files) {
    const bytes = await readFile(join(root, file));
    hash.update(`${file}\0${bytes.length}\0`).update(bytes);
  }
  return hash.digest('hex');
};

export const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');

export interface DumpManifestEntry {
  file: string | null;
  sha256: string | null;
  bytes: number;
  libraryTreeSha256: string;
  scope: DumpCase['scope'];
  ignoredPaths: readonly string[];
  prefs: boolean;
  params: Record<string, unknown> | null;
  counts: { courses: number; lessons: number; exercises: number };
  command: string;
}

export interface DumpManifest {
  dumper: {
    source: string;
    sourceSha256: string;
    trane: string;
    note: string;
  };
  maxCommittedBytes: number;
  dumps: Record<string, DumpManifestEntry>;
}
