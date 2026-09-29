import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { CourseLibrary, MemoryCourseSource } from '@lms/testkit';
import {
  buildLibrary,
  createFakeClock,
  createMemoryCourseSource,
} from '@lms/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineError } from '../../../src/app/errors.ts';
import { probeArtifact } from '../../../src/authoring/freshness.ts';
import {
  createLibraryHolder,
  openLibrary,
  reloadLibrary,
} from '../../../src/authoring/library-holder.ts';
import { createNodeFsCourseSource } from '../../../src/node/index.ts';
import type { CourseSource } from '../../../src/ports/index.ts';
import { generateLibrary } from '../../helpers/gen.ts';

const library = (): CourseLibrary =>
  buildLibrary({
    courses: [
      {
        id: 'a',
        lessons: [
          { id: 'l0', exercises: 3 },
          { id: 'l1', dependencies: ['l0'], exercises: 3 },
        ],
      },
    ],
  });

const lessonManifest = (id: string, dependencies: string[]) =>
  `${JSON.stringify({
    id,
    course_id: 'a',
    name: id,
    dependencies,
  })}\n`;

/** Файловая раскладка памяти изменяема: тест правит «диск» между открытиями. */
const files = (source: MemoryCourseSource) =>
  source.files as Map<string, string>;

const CYCLE = {
  'a/l0/lesson_manifest.json': lessonManifest('a::l0', ['a::l1']),
};

interface Counted {
  source: CourseSource;
  reads: { text: number; bytes: number };
}

const counted = (source: CourseSource): Counted => {
  const reads = { text: 0, bytes: 0 };
  return {
    reads,
    source: {
      ...source,
      readText: (path) => {
        reads.text++;
        return source.readText(path);
      },
      readBytes: (path) => {
        reads.bytes++;
        return source.readBytes(path);
      },
    },
  };
};

const expectEngineError = (action: () => unknown, code: string) => {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).code).toBe(code);
    return error as EngineError;
  }
  throw new Error(`expected EngineError ${code}`);
};

describe('holder states', () => {
  it('require() before any open is LIBRARY_NOT_LOADED', () => {
    const holder = createLibraryHolder();
    expect(holder.current()).toBeNull();
    expectEngineError(() => holder.require(), 'LIBRARY_NOT_LOADED');
  });

  it('a library opened with errors is invalid: no library, LIBRARY_INVALID with the error count', async () => {
    const source = createMemoryCourseSource(library(), CYCLE);
    const holder = createLibraryHolder();
    const { swapped, status } = await reloadLibrary(holder, source, {
      clock: createFakeClock(),
    });
    expect(swapped).toBe(true);
    expect(status.state).toBe('invalid');
    expect(status.library).toBeNull();
    expect(status.diagnostics.map((d) => d.code)).toContain(
      'E_CYCLE_DEPENDENCY',
    );
    const error = expectEngineError(() => holder.require(), 'LIBRARY_INVALID');
    expect(error.details).toEqual({ errors: status.summary.errors });
    expect(status.summary.errors).toBeGreaterThan(0);
    // артефакт с ошибками не пишется
    expect(source.files.has('.engine/compiled.json')).toBe(false);
  });
});

describe('openLibrary', () => {
  it('without an artifact compiles and writes it; a valid library is ready', async () => {
    const source = createMemoryCourseSource(library());
    const status = await openLibrary(source, { clock: createFakeClock() });
    expect(status.state).toBe('ready');
    expect(status.artifact).toBe('fresh');
    expect(status.summary.errors).toBe(0);
    expect(status.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(status.library?.getCourseIds()).toEqual(['a']);
    expect(source.files.has('.engine/compiled.json')).toBe(true);
  });

  it('a fresh artifact is loaded without reading a single manifest', async () => {
    const memory = createMemoryCourseSource(library());
    const first = await openLibrary(memory, { clock: createFakeClock() });
    const second = counted(memory);
    const again = await openLibrary(second.source, {
      clock: createFakeClock(),
    });
    expect(second.reads).toEqual({ text: 0, bytes: 0 });
    expect(again.state).toBe('ready');
    expect(again.revision).toBe(first.revision);
    expect(again.library?.getLessonIds('a')).toEqual(['a::l0', 'a::l1']);
    expect(again.library?.graph.getDependencies('a::l1')).toEqual(
      new Set(['a::l0']),
    );
  });

  it('a stale artifact is recompiled and rewritten', async () => {
    const memory = createMemoryCourseSource(library());
    const first = await openLibrary(memory, { clock: createFakeClock() });
    files(memory).set(
      'a/l2/lesson_manifest.json',
      lessonManifest('a::l2', ['a::l1']),
    );
    const counting = counted(memory);
    const second = await openLibrary(counting.source, {
      clock: createFakeClock(),
    });
    expect(counting.reads.text + counting.reads.bytes).toBeGreaterThan(0);
    expect(second.state).toBe('ready');
    expect(second.revision).not.toBe(first.revision);
    expect(second.library?.getLessonIds('a')).toEqual([
      'a::l0',
      'a::l1',
      'a::l2',
    ]);
    const third = counted(memory);
    await openLibrary(third.source, { clock: createFakeClock() });
    expect(third.reads).toEqual({ text: 0, bytes: 0 });
  });

  it('a corrupt artifact is silently recompiled', async () => {
    const memory = createMemoryCourseSource(library(), {
      '.engine/compiled.json': '{"formatVersion":1,',
    });
    const status = await openLibrary(memory, { clock: createFakeClock() });
    expect(status.state).toBe('ready');
    expect(status.artifact).toBe('fresh');
  });

  it('a read-only library opens without a cache: ready, artifact missing', async () => {
    const memory = createMemoryCourseSource(library());
    const source: CourseSource = {
      ...memory,
      writeArtifact: () => Promise.reject(new Error('EROFS')),
    };
    const status = await openLibrary(source, { clock: createFakeClock() });
    expect(status.state).toBe('ready');
    expect(status.artifact).toBe('missing');
  });

  it('loadedAt and loadMs come from the injected clock', async () => {
    const clock = createFakeClock();
    const memory = createMemoryCourseSource(library());
    const start = clock.now();
    let slow = true;
    const source: CourseSource = {
      ...memory,
      list: (dir) => {
        // время проходит один раз, при первом обращении к источнику
        if (slow) clock.advance(7);
        slow = false;
        return memory.list(dir);
      },
    };
    const status = await openLibrary(source, { clock });
    expect(status.loadMs).toBe(7);
    expect(status.loadedAt).toBe(start + 7);
  });
});

describe('reloadLibrary (T-14)', () => {
  it('a reload with errors keeps the previous library and returns the diagnostics', async () => {
    const memory = createMemoryCourseSource(library());
    const holder = createLibraryHolder();
    const clock = createFakeClock();
    await reloadLibrary(holder, memory, { clock });
    const before = holder.current();
    const previous = holder.require();

    for (const [path, text] of Object.entries(CYCLE)) {
      files(memory).set(path, text);
    }
    const { swapped, status } = await reloadLibrary(holder, memory, { clock });
    expect(swapped).toBe(false);
    expect(status.state).toBe('invalid');
    expect(status.diagnostics.map((d) => d.code)).toContain(
      'E_CYCLE_DEPENDENCY',
    );
    expect(holder.current()).toBe(before);
    expect(holder.require()).toBe(previous);
    expect(holder.require().graph.getDependencies('a::l0')).toEqual(new Set());
  });

  it('after the error is fixed the next reload swaps in the new library', async () => {
    const memory = createMemoryCourseSource(library());
    const holder = createLibraryHolder();
    const clock = createFakeClock();
    await reloadLibrary(holder, memory, { clock });
    const original = memory.files.get('a/l0/lesson_manifest.json') as string;
    files(memory).set(
      'a/l0/lesson_manifest.json',
      CYCLE['a/l0/lesson_manifest.json'],
    );
    await reloadLibrary(holder, memory, { clock });
    files(memory).set('a/l0/lesson_manifest.json', `${original}\n`);
    files(memory).set(
      'a/l2/lesson_manifest.json',
      lessonManifest('a::l2', ['a::l1']),
    );
    const { swapped } = await reloadLibrary(holder, memory, { clock });
    expect(swapped).toBe(true);
    expect(holder.require().getLessonIds('a')).toEqual([
      'a::l0',
      'a::l1',
      'a::l2',
    ]);
  });

  it('reads while a reload is in flight see the old library, then the new one, never a mix', async () => {
    const memory = createMemoryCourseSource(library());
    const holder = createLibraryHolder();
    const clock = createFakeClock();
    await reloadLibrary(holder, memory, { clock });
    const old = holder.require();

    files(memory).set(
      'a/l2/lesson_manifest.json',
      lessonManifest('a::l2', ['a::l1']),
    );
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gated: CourseSource = {
      ...memory,
      list: async (dir) => {
        await gate;
        return memory.list(dir);
      },
    };
    const pending = reloadLibrary(holder, gated, { clock });
    await Promise.resolve();
    // перезагрузка ещё идёт: читатели видят прежнюю библиотеку целиком
    expect(holder.require()).toBe(old);
    expect(holder.require().getLessonIds('a')).toEqual(['a::l0', 'a::l1']);
    release();
    const { swapped } = await pending;
    expect(swapped).toBe(true);
    expect(holder.require()).not.toBe(old);
    expect(holder.require().getLessonIds('a')).toEqual([
      'a::l0',
      'a::l1',
      'a::l2',
    ]);
    // прежняя ссылка осталась целой: читатель, взявший её до подмены, не пострадал
    expect(old.getLessonIds('a')).toEqual(['a::l0', 'a::l1']);
  });
});

describe('artifact refresh on the real file system', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('after a bare touch the library opens from the artifact and the refreshed stat is persisted', async () => {
    const root = mkdtempSync(`${tmpdir()}/holder-`);
    roots.push(root);
    generateLibrary({
      out: root,
      lessons: 10,
      exercises: 3,
      courses: 2,
      layout: 'json',
      seed: 5,
    });
    const source = createNodeFsCourseSource(root);
    const clock = createFakeClock();
    const first = await openLibrary(source, { clock });
    expect(first.state).toBe('ready');

    const now = new Date(Date.now() + 5_000);
    utimesSync(`${root}/c00/l00001/e0/front.md`, now, now);
    const counting = counted(createNodeFsCourseSource(root));
    const second = await openLibrary(counting.source, { clock });
    expect(second.state).toBe('ready');
    expect(second.artifact).toBe('fresh');
    expect(second.revision).toBe(first.revision);

    const probe = await probeArtifact(createNodeFsCourseSource(root));
    expect(probe.state).toBe('fresh');
    expect(probe.refreshed).toBe(false);
  });
});
