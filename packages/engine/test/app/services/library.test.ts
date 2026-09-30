import { CONTRACT_VERSION } from '@lms/engine-contract';
import type { Diagnostic } from '@lms/engine-contract';
import {
  buildAttempt,
  buildLibrary,
  createFakeExerciseTypes,
  createMemoryCourseSource,
} from '@lms/testkit';
import type { MemoryCourseSource } from '@lms/testkit';
import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryEventStore,
  createNodeFsCourseSource,
} from '../../../src/node/index.ts';
import type { CourseSource, RawVerdict } from '../../../src/ports/index.ts';
import { createTestEngine } from '../../helpers/engine.ts';

const ARTIFACT = '.engine/compiled.json';

const sampleLibrary = () =>
  buildLibrary({
    courses: [
      {
        id: 'a',
        lessons: [
          { id: 'l0', exercises: 3 },
          { id: 'l1', dependencies: ['l0'], exercises: 2 },
        ],
      },
      { id: 'b', dependencies: ['a'], lessons: [{ id: 'l0', exercises: 1 }] },
      { id: 'c', lessons: [{ id: 'l0', exercises: 1 }] },
    ],
  });

const filesOf = (source: MemoryCourseSource) =>
  source.files as Map<string, string>;

const lessonManifest = (id: string, courseId: string, dependencies: string[]) =>
  `${JSON.stringify({ id, course_id: courseId, name: id, dependencies })}\n`;

/** Цикл зависимостей: `a::l0` ↔ `a::l1`. */
const CYCLE = {
  'a/l0/lesson_manifest.json': lessonManifest('a::l0', 'a', ['a::l1']),
};

const openWith = (
  extraFiles: Record<string, string> = {},
  options: Parameters<typeof createTestEngine>[0] = {},
) => {
  const source = createMemoryCourseSource(sampleLibrary(), extraFiles);
  return createTestEngine({ ...options, library: source }).then(
    (testEngine) => ({
      ...testEngine,
      files: filesOf(source),
    }),
  );
};

const editJson = (
  files: Map<string, string>,
  path: string,
  change: (manifest: Record<string, unknown>) => void,
) => {
  const manifest = JSON.parse(files.get(path) as string) as Record<
    string,
    unknown
  >;
  change(manifest);
  files.set(path, `${JSON.stringify(manifest, null, 2)}\n`);
};

const codes = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.map(({ code }) => code);

const PASSED: RawVerdict = { outcome: 'passed', durationMs: 1 };

/** Вид `lms.sql` с эталоном; `decide` выбирает вердикт по запросу. */
const stubExerciseTypes = (
  decide: (request: { exerciseId: string }) => RawVerdict = () => PASSED,
) => {
  const types = createFakeExerciseTypes({
    types: { 'lms.sql': { reference: 'select 1' } },
  });
  const calls: { exerciseId: string }[] = [];
  types.grade = async (request) => {
    calls.push(request);
    return decide(request);
  };
  return Object.assign(types, { calls });
};

describe('library.getInfo', () => {
  it('describes a ready library', async () => {
    const { engine, source, clock } = await openWith();
    const info = await engine.library.getInfo();
    expect(info).toMatchObject({
      contractVersion: CONTRACT_VERSION,
      root: source.root,
      state: 'ready',
      artifact: 'fresh',
      counts: { courses: 3, lessons: 4, exercises: 7, dependencyEdges: 2 },
      diagnostics: { errors: 0, warnings: 0 },
      loadedAt: clock.now(),
    });
    expect(info.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(info.loadMs).toBeGreaterThanOrEqual(0);
  });

  it('describes an invalid library without a graph', async () => {
    const { engine } = await openWith(CYCLE);
    const info = await engine.library.getInfo();
    expect(info).toMatchObject({
      state: 'invalid',
      revision: '',
      counts: { courses: 0, lessons: 0, exercises: 0, dependencyEdges: 0 },
    });
    expect(info.diagnostics.errors).toBeGreaterThan(0);
    const { items } = await engine.library.getDiagnostics();
    expect(codes(items)).toContain('E_CYCLE_DEPENDENCY');
  });

  it('reads of an invalid library fail with LIBRARY_INVALID, tools stay available', async () => {
    const { engine } = await openWith(CYCLE);
    await expect(engine.library.listCourses()).rejects.toMatchObject({
      code: 'LIBRARY_INVALID',
    });
    await expect(engine.library.getUnit('a')).rejects.toMatchObject({
      code: 'LIBRARY_INVALID',
    });
    await expect(engine.library.getGraph()).rejects.toMatchObject({
      code: 'LIBRARY_INVALID',
    });
    const validation = await engine.library.validate();
    expect(validation.summary.errors).toBeGreaterThan(0);
  });
});

describe('library.getDiagnostics', () => {
  const WARNING_FILES = {
    'b/course_manifest.json': `${JSON.stringify({ id: 'b', name: 'b', dependencies: ['a'], bogus: 1 })}\n`,
    'c/course_manifest.json': `${JSON.stringify({ id: 'c', name: 'c', bogus: 1 })}\n`,
  };

  it('returns warnings sorted, filters by minSeverity and pages by cursor', async () => {
    const { engine } = await openWith(WARNING_FILES);
    const all = await engine.library.getDiagnostics();
    expect(codes(all.items)).toEqual(['W_UNKNOWN_KEY', 'W_UNKNOWN_KEY']);
    expect(all.items.map(({ path }) => path)).toEqual([
      'b/course_manifest.json',
      'c/course_manifest.json',
    ]);
    const errors = await engine.library.getDiagnostics({
      minSeverity: 'error',
    });
    expect(errors.items).toEqual([]);
    const first = await engine.library.getDiagnostics({ limit: 1 });
    expect(first.items).toHaveLength(1);
    const second = await engine.library.getDiagnostics({
      limit: 1,
      cursor: first.nextCursor as string,
    });
    expect(second.items).toEqual([all.items[1]]);
    expect(second.nextCursor).toBeUndefined();
    await expect(
      engine.library.getDiagnostics({ minSeverity: 'fatal' as 'error' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('library lists', () => {
  it('lists courses sorted by id with lesson counts', async () => {
    const { engine } = await openWith();
    const { items, nextCursor } = await engine.library.listCourses();
    expect(nextCursor).toBeUndefined();
    expect(items.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect(items.map(({ lessonCount }) => lessonCount)).toEqual([2, 1, 1]);
    expect(items[1]).toMatchObject({ dependencies: ['a'], metadata: {} });
  });

  it('pages by cursor without gaps and rejects bad arguments', async () => {
    const { engine } = await openWith();
    const first = await engine.library.listCourses({ limit: 2 });
    expect(first.items.map(({ id }) => id)).toEqual(['a', 'b']);
    const second = await engine.library.listCourses({
      limit: 2,
      cursor: first.nextCursor as string,
    });
    expect(second.items.map(({ id }) => id)).toEqual(['c']);
    expect(second.nextCursor).toBeUndefined();
    for (const req of [{ limit: 0 }, { limit: 501 }, { cursor: 'garbage!' }]) {
      await expect(engine.library.listCourses(req)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
    }
  });

  it('lists lessons and exercises of a parent, NOT_FOUND for an unknown one', async () => {
    const { engine } = await openWith();
    const lessons = await engine.library.listLessons('a');
    expect(lessons.items.map(({ id }) => id)).toEqual(['a::l0', 'a::l1']);
    expect(lessons.items.map(({ exerciseCount }) => exerciseCount)).toEqual([
      3, 2,
    ]);
    const exercises = await engine.library.listExercises('a::l0', {
      limit: 2,
    });
    expect(exercises.items.map(({ id }) => id)).toEqual([
      'a::l0::e0',
      'a::l0::e1',
    ]);
    expect(exercises.nextCursor).toBeDefined();
    for (const run of [
      () => engine.library.listLessons('nope'),
      () => engine.library.listLessons('a::l0'),
      () => engine.library.listExercises('a'),
    ]) {
      await expect(run()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('getUnit resolves every kind and NOT_FOUND otherwise', async () => {
    const { engine } = await openWith();
    expect(await engine.library.getUnit('a')).toMatchObject({
      kind: 'course',
    });
    expect(await engine.library.getUnit('a::l1')).toMatchObject({
      kind: 'lesson',
      dependencies: ['a::l0'],
    });
    expect(await engine.library.getUnit('a::l1::e1')).toMatchObject({
      kind: 'exercise',
      lessonId: 'a::l1',
    });
    await expect(engine.library.getUnit('zzz')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('matchPrefix filters by kind, sorts and pages', async () => {
    const { engine } = await openWith();
    const all = await engine.library.matchPrefix('a');
    expect(all.items[0]).toBe('a');
    expect(all.items).toEqual([...all.items].sort());
    expect(all.items).toHaveLength(1 + 2 + 5);
    const lessons = await engine.library.matchPrefix('a', 'lesson');
    expect(lessons.items).toEqual(['a::l0', 'a::l1']);
    const paged = await engine.library.matchPrefix('a::l0', 'exercise', {
      limit: 2,
    });
    expect(paged.items).toEqual(['a::l0::e0', 'a::l0::e1']);
    expect(paged.nextCursor).toBeDefined();
    expect((await engine.library.matchPrefix('none')).items).toEqual([]);
    await expect(
      engine.library.matchPrefix('a', 'unit' as 'course'),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('getGraph honours limit and reports truncation', async () => {
    const { engine } = await openWith();
    const full = await engine.library.getGraph();
    expect(full.truncated).toBe(false);
    expect(full.nodes).toHaveLength(3 + 4 + 7);
    expect(full.edges).toContainEqual({
      from: 'b',
      to: 'a',
      type: 'dependency',
    });
    const cut = await engine.library.getGraph({ limit: 4 });
    expect(cut.truncated).toBe(true);
    expect(cut.nodes).toHaveLength(4);
    await expect(
      engine.library.getGraph({ limit: 2001 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('library.readAsset', () => {
  it('reads an asset referenced by the unit DTO', async () => {
    const { engine } = await openWith();
    const unit = await engine.library.getUnit('a::l0::e0');
    if (unit.kind !== 'exercise' || unit.content.type !== 'flashcard') {
      expect.unreachable('a flashcard exercise was expected');
    }
    const asset = await engine.library.readAsset(unit.content.front);
    expect(asset).toEqual({
      ref: unit.content.front,
      mime: 'text/markdown',
      text: 'Front of a::l0::e0\n',
      bytes: 19,
    });
  });

  it('reads assets of a library on disk', async () => {
    const { engine } = await createTestEngine({ library: 'embedded' });
    const course = await engine.library.getUnit('embedded::raw_course');
    if (course.kind !== 'course' || course.material === undefined) {
      expect.unreachable('a course with material was expected');
    }
    const asset = await engine.library.readAsset(course.material);
    expect(asset.text.length).toBeGreaterThan(0);
  });

  it('refuses paths that leave the root, are not unit assets, or units that do not exist', async () => {
    const { engine } = await openWith();
    for (const path of [
      '../secret.md',
      '/etc/passwd',
      'a/course_manifest.json',
    ]) {
      await expect(
        engine.library.readAsset({ unitId: 'a::l0::e0', path }),
      ).rejects.toMatchObject({ code: 'ASSET_OUTSIDE_LIBRARY' });
    }
    await expect(
      engine.library.readAsset({ unitId: 'nope', path: 'x.md' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('library.validate', () => {
  it('rechecks the files without replacing the graph or the artifact', async () => {
    const { engine, files } = await openWith();
    const before = await engine.library.getInfo();
    const artifactBefore = files.get(ARTIFACT);
    editJson(files, 'a/l1/lesson_manifest.json', (manifest) => {
      manifest.dependencies = ['a::missing'];
    });
    const result = await engine.library.validate();
    expect(codes(result.items)).toContain('E_DEP_MISSING');
    expect(result.summary.errors).toBeGreaterThan(0);
    expect(result.checksRun).toBe(false);
    expect(result.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(result.revision).not.toBe(before.revision);
    expect(await engine.library.getInfo()).toEqual(before);
    expect(files.get(ARTIFACT)).toBe(artifactBefore);
    const lesson = await engine.library.getUnit('a::l1');
    expect(lesson).toMatchObject({ dependencies: ['a::l0'] });
    const loaded = await engine.library.getDiagnostics();
    expect(loaded.items).toEqual([]);
  });

  it('a clean library validates with the loaded revision', async () => {
    const { engine } = await openWith();
    const info = await engine.library.getInfo();
    const result = await engine.library.validate();
    expect(result.summary).toMatchObject({ errors: 0, warnings: 0 });
    expect(result.items.every(({ severity }) => severity === 'info')).toBe(
      true,
    );
    expect(result.revision).toBe(info.revision);
  });

  it('pages one result and invalidates old cursors on the next validate', async () => {
    const { engine, files } = await openWith();
    for (const course of ['a', 'b', 'c']) {
      files.set(`${course}/course_manifest.json`, '{ not json');
    }
    const first = await engine.library.validate({ limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeDefined();
    const second = await engine.library.validate({
      limit: 1,
      cursor: first.nextCursor as string,
    });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]).not.toEqual(first.items[0]);
    expect(second.summary).toEqual(first.summary);
    expect(second.revision).toBe(first.revision);

    await engine.library.validate();
    await expect(
      engine.library.validate({
        limit: 1,
        cursor: first.nextCursor as string,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('cursors that never came from validate are rejected', async () => {
    const { engine } = await openWith();
    await expect(
      engine.library.validate({ cursor: 'abc~MQ' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await engine.library.validate();
    await expect(
      engine.library.validate({ cursor: 'MQ' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('minSeverity filters items but not the summary', async () => {
    const { engine } = await openWith({
      'c/course_manifest.json': `${JSON.stringify({ id: 'c', name: 'c', bogus: 1 })}\n`,
    });
    const all = await engine.library.validate();
    const errorsOnly = await engine.library.validate({ minSeverity: 'error' });
    expect(all.summary.warnings).toBe(1);
    expect(errorsOnly.items).toEqual([]);
    expect(errorsOnly.summary).toEqual(all.summary);
  });

  it('runChecks runs the reference solutions through the exercise types', async () => {
    const verifier = stubExerciseTypes(({ exerciseId }) =>
      exerciseId === 'sql_kb::join::q1'
        ? { outcome: 'failed', reason: 'mismatch', durationMs: 1 }
        : PASSED,
    );
    const { engine } = await createTestEngine({
      library: 'sql-course-kb',
      exerciseTypes: verifier,
    });
    const plain = await engine.library.validate();
    expect(plain.checksRun).toBe(false);
    expect(verifier.calls).toHaveLength(0);
    const checked = await engine.library.validate({ runChecks: true });
    expect(checked.checksRun).toBe(true);
    expect(verifier.calls).toHaveLength(21);
    const failures = checked.items.filter(
      ({ code }) => code === 'E_REFERENCE_FAILS',
    );
    expect(failures.map(({ unitId }) => unitId)).toEqual(['sql_kb::join::q1']);
    expect(checked.summary.errors).toBe(1);
  });
});

describe('library.compile', () => {
  it('a fresh artifact is not rewritten', async () => {
    const { engine, events } = await openWith();
    const info = await engine.library.getInfo();
    const result = await engine.library.compile();
    expect(result).toEqual({
      revision: info.revision,
      diagnosticsSummary: info.diagnostics,
      artifactWritten: false,
    });
    expect(events).toContainEqual({
      type: 'library-compiled',
      revision: info.revision,
      artifactWritten: false,
      errors: 0,
      warnings: 0,
    });
  });

  it('writes the artifact of a changed library without replacing the graph; reload picks it up', async () => {
    const { engine, files, events } = await openWith();
    const before = await engine.library.getInfo();
    editJson(files, 'a/l1/lesson_manifest.json', (manifest) => {
      manifest.description = 'Changed';
    });
    const compiled = await engine.library.compile();
    expect(compiled.artifactWritten).toBe(true);
    expect(compiled.revision).not.toBe(before.revision);
    expect(files.get(ARTIFACT)).toContain(compiled.revision);
    expect(events).toContainEqual({
      type: 'library-compiled',
      revision: compiled.revision,
      artifactWritten: true,
      errors: 0,
      warnings: 0,
    });
    const loaded = await engine.library.getInfo();
    expect(loaded.revision).toBe(before.revision);
    expect(await engine.library.getUnit('a::l1')).not.toHaveProperty(
      'description',
    );

    const reloaded = await engine.library.reload();
    expect(reloaded.revision).toBe(compiled.revision);
    expect(reloaded.artifact).toBe('fresh');
    expect(await engine.library.getUnit('a::l1')).toMatchObject({
      description: 'Changed',
    });
  });

  it('recreates a missing artifact of the loaded library and marks it fresh', async () => {
    const { engine, files } = await openWith();
    files.delete(ARTIFACT);
    const result = await engine.library.compile();
    expect(result.artifactWritten).toBe(true);
    expect(files.has(ARTIFACT)).toBe(true);
    expect((await engine.library.getInfo()).artifact).toBe('fresh');
  });

  it('does not write an artifact for a library with errors', async () => {
    const { engine, files, events } = await openWith();
    const artifactBefore = files.get(ARTIFACT);
    editJson(files, 'a/l1/lesson_manifest.json', (manifest) => {
      manifest.dependencies = ['a::missing'];
    });
    const result = await engine.library.compile();
    expect(result.artifactWritten).toBe(false);
    expect(result.diagnosticsSummary.errors).toBeGreaterThan(0);
    expect(files.get(ARTIFACT)).toBe(artifactBefore);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'library-compiled',
        artifactWritten: false,
      }),
    );
  });
});

describe('library.reload', () => {
  it('swaps the library, resets derived state and sends the event', async () => {
    const { engine, ctx, files, events } = await openWith();
    const invalidate = vi.spyOn(ctx, 'invalidateDerived');
    editJson(files, 'a/l1/lesson_manifest.json', (manifest) => {
      manifest.description = 'Changed';
    });
    const info = await engine.library.reload();
    expect(info).toMatchObject({ state: 'ready', artifact: 'fresh' });
    expect(info).toEqual(await engine.library.getInfo());
    expect(await engine.library.getUnit('a::l1')).toMatchObject({
      description: 'Changed',
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: 'library-reloaded',
      revision: info.revision,
      errors: 0,
      warnings: 0,
    });
  });

  it('keeps the previous graph on errors, shows the diagnostics and recovers', async () => {
    const { engine, ctx, files, events } = await openWith();
    const invalidate = vi.spyOn(ctx, 'invalidateDerived');
    const before = await engine.library.getInfo();
    const original = files.get('a/l0/lesson_manifest.json') as string;
    files.set(
      'a/l0/lesson_manifest.json',
      lessonManifest('a::l0', 'a', ['a::l1']),
    );

    const failed = await engine.library.reload();
    expect(failed).toMatchObject({
      state: 'ready',
      revision: before.revision,
      counts: before.counts,
    });
    expect(failed.diagnostics.errors).toBeGreaterThan(0);
    expect(invalidate).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'library-reloaded',
      revision: before.revision,
      errors: failed.diagnostics.errors,
      warnings: 0,
    });
    const { items } = await engine.library.getDiagnostics();
    expect(codes(items)).toContain('E_CYCLE_DEPENDENCY');
    expect((await engine.library.listCourses()).items).toHaveLength(3);
    expect(await engine.library.getUnit('a::l0')).toMatchObject({
      dependencies: [],
    });

    files.set('a/l0/lesson_manifest.json', original);
    const recovered = await engine.library.reload();
    expect(recovered.diagnostics.errors).toBe(0);
    expect((await engine.library.getDiagnostics()).items).toEqual([]);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('a first-time invalid library becomes ready after a fix', async () => {
    const { engine, files } = await openWith(CYCLE);
    expect((await engine.library.getInfo()).state).toBe('invalid');
    files.set('a/l0/lesson_manifest.json', lessonManifest('a::l0', 'a', []));
    const info = await engine.library.reload();
    expect(info).toMatchObject({ state: 'ready' });
    expect(info.counts.courses).toBe(3);
  });

  it('applies ignoredPaths from the preferences to a recompiled library', async () => {
    const { engine, files } = await openWith();
    await engine.settings.setPreferences({ ignoredPaths: ['c'] });
    editJson(files, 'a/l1/lesson_manifest.json', (manifest) => {
      manifest.description = 'Changed';
    });
    const info = await engine.library.reload();
    expect(info.counts.courses).toBe(2);
    expect(
      (await engine.library.listCourses()).items.map(({ id }) => id),
    ).toEqual(['a', 'b']);
  });
});

describe('missing library root', () => {
  const vanishing = (
    problem: 'missing' | 'unreadable' = 'missing',
  ): { source: CourseSource; vanish: (isGone: boolean) => void } => {
    const inner = createMemoryCourseSource(sampleLibrary());
    let isGone = false;
    const source: CourseSource = {
      root: inner.root,
      list: (dir) => inner.list(dir),
      readText: (path) => inner.readText(path),
      readBytes: (path) => inner.readBytes(path),
      readArtifact: () => inner.readArtifact(),
      writeArtifact: (text) => inner.writeArtifact(text),
      stat: async (path) => {
        if (isGone && path === '') {
          if (problem === 'unreadable') throw new Error('EACCES');
          return null;
        }
        return inner.stat(path);
      },
    };
    return {
      source,
      vanish: (gone) => {
        isGone = gone;
      },
    };
  };

  const ioErrors = (diagnostics: readonly Diagnostic[]) =>
    diagnostics.filter(({ code }) => code === 'E_IO');

  it('opens as invalid; validate, compile and reload report E_IO instead of throwing', async () => {
    const source = createNodeFsCourseSource('/nonexistent/lms-root');
    const { engine, events } = await createTestEngine({ library: source });
    const info = await engine.library.getInfo();
    expect(info).toMatchObject({ state: 'invalid', revision: '' });
    expect(info.diagnostics.errors).toBe(1);

    const validation = await engine.library.validate({ runChecks: false });
    expect(ioErrors(validation.items)).toHaveLength(1);
    expect(validation).toMatchObject({
      summary: { errors: 1, warnings: 0 },
      revision: '',
      checksRun: false,
    });

    const compiled = await engine.library.compile();
    expect(compiled).toEqual({
      revision: '',
      diagnosticsSummary: { errors: 1, warnings: 0, infos: 0 },
      artifactWritten: false,
    });
    expect(events).toContainEqual({
      type: 'library-compiled',
      revision: '',
      artifactWritten: false,
      errors: 1,
      warnings: 0,
    });

    const reloaded = await engine.library.reload();
    expect(reloaded).toMatchObject({ state: 'invalid' });
    expect(reloaded.diagnostics.errors).toBe(1);
    expect(events).toContainEqual({
      type: 'library-reloaded',
      revision: '',
      errors: 1,
      warnings: 0,
    });
    expect(
      ioErrors((await engine.library.getDiagnostics()).items),
    ).toHaveLength(1);
    await expect(engine.library.listCourses()).rejects.toMatchObject({
      code: 'LIBRARY_INVALID',
    });
  });

  it.each(['missing', 'unreadable'] as const)(
    'a %s root after opening keeps the working library on reload',
    async (problem) => {
      const { source, vanish } = vanishing(problem);
      const { engine, ctx, events } = await createTestEngine({
        library: source,
      });
      const invalidate = vi.spyOn(ctx, 'invalidateDerived');
      const before = await engine.library.getInfo();

      vanish(true);
      const info = await engine.library.reload();
      expect(info).toMatchObject({
        state: 'ready',
        revision: before.revision,
        counts: before.counts,
      });
      expect(info.diagnostics.errors).toBe(1);
      expect(invalidate).not.toHaveBeenCalled();
      expect(events).toContainEqual({
        type: 'library-reloaded',
        revision: before.revision,
        errors: 1,
        warnings: 0,
      });
      expect(
        ioErrors((await engine.library.getDiagnostics()).items),
      ).toHaveLength(1);
      expect((await engine.library.listCourses()).items).toHaveLength(3);

      const validation = await engine.library.validate();
      expect(validation.summary.errors).toBe(1);
      expect((await engine.library.compile()).artifactWritten).toBe(false);

      vanish(false);
      const recovered = await engine.library.reload();
      expect(recovered.diagnostics.errors).toBe(0);
      expect(await engine.library.getDiagnostics()).toEqual({ items: [] });
    },
  );
});

describe('W_ORPHAN_EVENTS', () => {
  const ghostEntry = () => {
    const entry = buildAttempt({ exerciseId: 'old::l::e0' });
    return entry;
  };

  it('lists journal units that are absent from the library, without a path', async () => {
    const { engine } = await openWith(
      {},
      {
        eventStore: createMemoryEventStore({ entries: [ghostEntry()] }),
      },
    );
    const { items } = await engine.library.getDiagnostics();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      code: 'W_ORPHAN_EVENTS',
      severity: 'warning',
      unitId: 'old::l::e0',
    });
    expect(items[0]).not.toHaveProperty('path');
    const info = await engine.library.getInfo();
    expect(info.diagnostics.warnings).toBe(1);
    const validation = await engine.library.validate();
    expect(codes(validation.items)).not.toContain('W_ORPHAN_EVENTS');
  });

  it('appears after a reload removes a unit that has attempts', async () => {
    const { engine, files } = await openWith();
    await engine.practice.recordAttempt({
      requestId: 'r1',
      exerciseId: 'a::l0::e2',
      grade: 4,
    });
    expect((await engine.library.getDiagnostics()).items).toEqual([]);
    for (const path of [...files.keys()]) {
      if (path.startsWith('a/l0/e2/')) files.delete(path);
    }
    const info = await engine.library.reload();
    expect(info.diagnostics.warnings).toBe(1);
    const { items } = await engine.library.getDiagnostics();
    expect(items.map(({ code, unitId }) => [code, unitId])).toEqual([
      ['W_ORPHAN_EVENTS', 'a::l0::e2'],
    ]);
  });
});
