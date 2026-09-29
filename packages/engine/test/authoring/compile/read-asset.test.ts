import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import type { AssetRef } from '@lms/engine-contract';
import { buildLibrary, createMemoryCourseSource } from '@lms/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineError } from '../../../src/app/errors.ts';
import { loadDirectory } from '../../../src/authoring/load-directory.ts';
import {
  MAX_ASSET_BYTES,
  readAsset,
} from '../../../src/authoring/read-asset.ts';
import type { Library } from '../../../src/domain/library.ts';
import type { ExerciseManifest } from '../../../src/domain/manifest.ts';
import { createNodeFsCourseSource } from '../../../src/node/index.ts';
import type { CourseSource } from '../../../src/ports/index.ts';

const testLibrary = () =>
  buildLibrary({
    courses: [{ id: 'a', lessons: [{ id: 'l0', exercises: 2 }] }],
  });

const FRONT: AssetRef = { unitId: 'a::l0::e0', path: 'a/l0/e0/front.md' };

const open = async (source: CourseSource): Promise<Library> => {
  const { library, diagnostics } = await loadDirectory(source);
  if (library === null) {
    throw new Error(`library must load: ${JSON.stringify(diagnostics)}`);
  }
  return library;
};

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    return (error as EngineError).code;
  }
  throw new Error('expected the read to fail');
};

describe('readAsset (T-15)', () => {
  it('returns the text, the mime type and the size of the file', async () => {
    const source = createMemoryCourseSource(testLibrary());
    const library = await open(source);
    const content = await readAsset(source, library, FRONT);
    expect(content).toEqual({
      ref: FRONT,
      mime: 'text/markdown',
      text: 'Front of a::l0::e0\n',
      bytes: 19,
    });
  });

  it('strips the frontmatter block but reports the size of the original file', async () => {
    const original = '---\nengine:\n  tags: [x]\n---\nЗдравствуй\n';
    const source = createMemoryCourseSource(testLibrary(), {
      'a/l0/e0/front.md': original,
    });
    const content = await readAsset(source, await open(source), FRONT);
    expect(content.text).toBe('Здравствуй\n');
    expect(content.bytes).toBe(new TextEncoder().encode(original).length);
  });

  it('leaves text that only looks like frontmatter untouched', async () => {
    const prose = '---\nJust prose between two rules.\n---\nBody\n';
    const source = createMemoryCourseSource(testLibrary(), {
      'a/l0/e0/front.md': prose,
    });
    const content = await readAsset(source, await open(source), FRONT);
    expect(content.text).toBe(prose);
  });

  it('reads the material asset of a course', async () => {
    const source = createMemoryCourseSource(testLibrary(), {
      'a/course_manifest.json': JSON.stringify({
        id: 'a',
        name: 'A',
        course_material: { MarkdownAsset: { path: 'intro.md' } },
      }),
      'a/intro.md': '# Intro\n',
    });
    const content = await readAsset(source, await open(source), {
      unitId: 'a',
      path: 'a/intro.md',
    });
    expect(content.text).toBe('# Intro\n');
  });

  it.each([
    ['a parent directory', '../secret.md'],
    ['an absolute path', '/etc/hosts'],
    ['a non-normalised alias of an own asset', 'a/l0/e0/../e0/front.md'],
    ['an asset of another unit', 'a/l0/e1/front.md'],
    ['a file that is not an asset at all', 'a/course_manifest.json'],
  ])('refuses %s without touching the file system', async (_, path) => {
    const memory = createMemoryCourseSource(testLibrary(), {
      '../secret.md': 'secret',
    });
    const library = await open(memory);
    const reads: string[] = [];
    const source: CourseSource = {
      ...memory,
      stat: (target) => {
        reads.push(target);
        return memory.stat(target);
      },
      readBytes: (target) => {
        reads.push(target);
        return memory.readBytes(target);
      },
    };
    const code = await failure(
      readAsset(source, library, { unitId: FRONT.unitId, path }),
    );
    expect(code).toBe('ASSET_OUTSIDE_LIBRARY');
    expect(reads).toEqual([]);
  });

  it('refuses a manifest path that leaves the library root even if the manifest lists it', async () => {
    const memory = createMemoryCourseSource(testLibrary());
    const library = await open(memory);
    const escaping = {
      ...(library.getExercise(FRONT.unitId) as ExerciseManifest),
      exercise_asset: {
        FlashcardAsset: { front_path: '../outside.md', back_path: null },
      },
    };
    const tampered: Library = {
      ...library,
      getExercise: (id) => (id === FRONT.unitId ? escaping : undefined),
    };
    const code = await failure(
      readAsset(memory, tampered, {
        unitId: FRONT.unitId,
        path: '../outside.md',
      }),
    );
    expect(code).toBe('ASSET_OUTSIDE_LIBRARY');
  });

  it('an unknown unit and a file that disappeared are NOT_FOUND', async () => {
    const memory = createMemoryCourseSource(testLibrary());
    const library = await open(memory);
    expect(
      await failure(
        readAsset(memory, library, { unitId: 'a::ghost', path: 'x' }),
      ),
    ).toBe('NOT_FOUND');
    (memory.files as Map<string, string>).delete(FRONT.path);
    expect(await failure(readAsset(memory, library, FRONT))).toBe('NOT_FOUND');
  });

  it('accepts a file of exactly 2 MiB and refuses one byte more', async () => {
    const memory = createMemoryCourseSource(testLibrary());
    const library = await open(memory);
    const files = memory.files as Map<string, string>;
    files.set(FRONT.path, 'x'.repeat(MAX_ASSET_BYTES));
    const content = await readAsset(memory, library, FRONT);
    expect(content.bytes).toBe(2 * 1024 * 1024);

    files.set(FRONT.path, 'x'.repeat(MAX_ASSET_BYTES + 1));
    expect(await failure(readAsset(memory, library, FRONT))).toBe(
      'ASSET_TOO_LARGE',
    );
  });

  it('checks the size after reading too: a file that grew since stat is refused', async () => {
    const memory = createMemoryCourseSource(testLibrary());
    const library = await open(memory);
    const source: CourseSource = {
      ...memory,
      readBytes: async () => new Uint8Array(MAX_ASSET_BYTES + 1),
    };
    expect(await failure(readAsset(source, library, FRONT))).toBe(
      'ASSET_TOO_LARGE',
    );
  });
});

describe('symbolic links on the real file system', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  const setup = async () => {
    const base = mkdtempSync(`${tmpdir()}/read-asset-`);
    roots.push(base);
    const root = `${base}/lib`;
    mkdirSync(`${root}/a/l0/e0`, { recursive: true });
    const json = (path: string, value: unknown) =>
      writeFileSync(`${root}/${path}`, JSON.stringify(value));
    json('a/course_manifest.json', { id: 'a', name: 'A' });
    json('a/l0/lesson_manifest.json', {
      id: 'a::l0',
      course_id: 'a',
      name: 'L',
    });
    json('a/l0/e0/exercise_manifest.json', {
      id: 'a::l0::e0',
      lesson_id: 'a::l0',
      course_id: 'a',
      name: 'E',
      exercise_asset: { FlashcardAsset: { front_path: 'front.md' } },
    });
    writeFileSync(`${root}/a/l0/e0/front.md`, 'inside\n');
    writeFileSync(`${base}/secret.md`, 'outside\n');
    const source = createNodeFsCourseSource(root);
    return { base, root, source, library: await open(source) };
  };

  it('a link that points outside the library root is refused', async () => {
    const { base, root, source, library } = await setup();
    const path = `${root}/a/l0/e0/front.md`;
    unlinkSync(path);
    symlinkSync(`${base}/secret.md`, path);
    expect(await failure(readAsset(source, library, FRONT))).toBe(
      'ASSET_OUTSIDE_LIBRARY',
    );
  });

  it('a link that stays inside the library root is readable', async () => {
    const { root, source, library } = await setup();
    writeFileSync(`${root}/a/shared.md`, 'shared\n');
    const path = `${root}/a/l0/e0/front.md`;
    unlinkSync(path);
    symlinkSync(`${root}/a/shared.md`, path);
    const content = await readAsset(source, library, FRONT);
    expect(content.text).toBe('shared\n');
  });

  it('a link to a directory outside the root hides its files too', async () => {
    const { base, root, library } = await setup();
    mkdirSync(`${base}/elsewhere`);
    writeFileSync(`${base}/elsewhere/front.md`, 'outside\n');
    rmSync(`${root}/a/l0/e0`, { recursive: true });
    symlinkSync(`${base}/elsewhere`, `${root}/a/l0/e0`);
    // новый источник: кэш каталогов прежнего описывает прежнее состояние диска
    expect(
      await failure(readAsset(createNodeFsCourseSource(root), library, FRONT)),
    ).toBe('ASSET_OUTSIDE_LIBRARY');
  });
});
