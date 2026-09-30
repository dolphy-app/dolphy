import type { ExtensionInfoDto } from '@lms/engine-contract';
import { describe, expect, it } from 'vitest';
import {
  buildAttempt,
  buildLibrary,
  buildProgressReset,
  buildUnitFlag,
  createFakeClock,
  createFakeExerciseTypes,
  createFakeExtensionPolicy,
  createFakeExtensionRegistry,
  createJournalBuilder,
  createMemoryCourseSource,
  createSeededRng,
  createTestIds,
  generateLibrary,
  T0_MS,
} from '../src/index.ts';

const hasCycle = (deps: Map<string, string[]>) => {
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 'open') return true;
    if (state.get(id) === 'done') return false;
    state.set(id, 'open');
    const cyclic = (deps.get(id) ?? []).some(visit);
    state.set(id, 'done');
    return cyclic;
  };
  return [...deps.keys()].some(visit);
};

describe('FakeClock', () => {
  it('moves only when told to', () => {
    const clock = createFakeClock();
    expect(clock.now()).toBe(T0_MS);
    expect(clock.now()).toBe(T0_MS);
    expect(clock.advance(500)).toBe(T0_MS + 500);
    expect(clock.set(42)).toBe(42);
    expect(clock.now()).toBe(42);
  });
});

describe('createTestIds', () => {
  it('issues unique deterministic ids', () => {
    const ids = createTestIds('e');
    expect([ids.next(), ids.next()]).toEqual(['e-000001', 'e-000002']);
    expect(ids.issued).toBe(2);
    expect(createTestIds('e').next()).toBe('e-000001');
  });
});

describe('SeededRng', () => {
  it('is reproducible per seed and differs across seeds', () => {
    const draw = (seed: number) => {
      const rng = createSeededRng(seed);
      return Array.from({ length: 8 }, () => rng.random());
    };
    expect(draw(7)).toEqual(draw(7));
    expect(draw(7)).not.toEqual(draw(8));
  });

  it('draws from [0, 1) with a roughly uniform mean', () => {
    const rng = createSeededRng(20260929);
    const draws = Array.from({ length: 20_000 }, () => rng.random());
    expect(draws.every((x) => x >= 0 && x < 1)).toBe(true);
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });

  it('survives seed 0 and negative seeds', () => {
    for (const seed of [0, -1]) {
      const rng = createSeededRng(seed);
      const draws = new Set(Array.from({ length: 16 }, () => rng.random()));
      expect(draws.size).toBe(16);
    }
  });
});

describe('journal builders', () => {
  it('writes contiguous seq and strictly increasing at', () => {
    const journal = createJournalBuilder({ deviceId: 'd1' });
    journal.attempt('c::l::e', 4);
    journal.unitFlag('c::l::e', 'blacklist');
    journal.wait(60_000);
    journal.progressReset('c', 'rev-1');
    const { entries } = journal;
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(entries.map((e) => e.kind)).toEqual([
      'attempt',
      'unit_flag',
      'progress_reset',
    ]);
    const times = entries.map((e) => e.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(3);
    expect(new Set(entries.map((e) => e.id)).size).toBe(3);
    expect(entries.every((e) => e.deviceId === 'd1')).toBe(true);
    expect(entries[2]).toMatchObject({ libraryRevision: 'rev-1' });
  });

  it('standalone builders fill valid defaults and honour overrides', () => {
    expect(buildAttempt({ exerciseId: 'c::l::e' })).toMatchObject({
      kind: 'attempt',
      grade: 3,
      source: 'self',
      seq: 1,
      at: T0_MS,
      recordedAt: T0_MS,
    });
    expect(
      buildAttempt({
        exerciseId: 'x',
        grade: 1,
        seq: 9,
        at: 5,
        source: 'runner',
      }),
    ).toMatchObject({ grade: 1, seq: 9, at: 5, source: 'runner' });
    expect(buildUnitFlag({ unitId: 'u', flag: 'review' })).toMatchObject({
      op: 'set',
    });
    expect(buildProgressReset({ unitId: 'u' })).not.toHaveProperty(
      'libraryRevision',
    );
  });
});

describe('library builders', () => {
  it('expands a compact spec into qualified manifests', () => {
    const library = buildLibrary({
      courses: [
        {
          id: 'c',
          lessons: [
            { id: 'a', exercises: 2 },
            { id: 'b', dependencies: ['a'], exercises: ['x'] },
          ],
        },
      ],
    });
    expect(library.lessons.map((l) => [l.id, l.dependencies])).toEqual([
      ['c::a', []],
      ['c::b', ['c::a']],
    ]);
    expect(
      library.exercises.map((e) => [e.id, e.lesson_id, e.course_id]),
    ).toEqual([
      ['c::a::e0', 'c::a', 'c'],
      ['c::a::e1', 'c::a', 'c'],
      ['c::b::x', 'c::b', 'c'],
    ]);
  });

  it('generates the requested shape deterministically without cycles', () => {
    for (const seed of [1, 2, 3, 99, 20260929]) {
      const options = {
        courses: 3,
        lessonsPerCourse: 12,
        exercisesPerLesson: 4,
        maxDependencies: 4,
        chainCourses: true,
        seed,
      };
      const library = generateLibrary(options);
      expect(library.courses).toHaveLength(3);
      expect(library.lessons).toHaveLength(36);
      expect(library.exercises).toHaveLength(144);
      expect(library).toEqual(generateLibrary(options));
      const ids = new Set(library.lessons.map((l) => l.id));
      const deps = new Map(library.lessons.map((l) => [l.id, l.dependencies]));
      for (const course of library.courses)
        deps.set(course.id, course.dependencies);
      for (const lesson of library.lessons) {
        expect(lesson.dependencies.length).toBeLessThanOrEqual(4);
        expect(lesson.dependencies.every((d) => ids.has(d))).toBe(true);
      }
      expect(hasCycle(deps)).toBe(false);
    }
    expect(
      generateLibrary({
        courses: 1,
        lessonsPerCourse: 30,
        exercisesPerLesson: 1,
        seed: 1,
      }).lessons,
    ).not.toEqual(
      generateLibrary({
        courses: 1,
        lessonsPerCourse: 30,
        exercisesPerLesson: 1,
        seed: 2,
      }).lessons,
    );
  });
});

describe('MemoryCourseSource', () => {
  const library = buildLibrary({
    courses: [{ id: 'c', lessons: [{ id: 'l', exercises: 1 }] }],
  });

  it('serves the Trane layout and round-trips manifests', async () => {
    const source = createMemoryCourseSource(library, { 'c/notes.txt': 'hi' });
    expect((await source.list('')).map((e) => e.name)).toEqual(['c']);
    expect(await source.list('c')).toEqual([
      { name: 'course_manifest.json', kind: 'file' },
      { name: 'l', kind: 'directory' },
      { name: 'notes.txt', kind: 'file' },
    ]);
    const manifest = JSON.parse(
      await source.readText('c/l/e0/exercise_manifest.json'),
    );
    expect(manifest).toEqual(library.exercises[0]);
    expect(await source.stat('c/l')).toMatchObject({ kind: 'directory' });
    expect(await source.stat('c/notes.txt')).toMatchObject({
      kind: 'file',
      bytes: 2,
    });
    expect(await source.stat('c/none')).toBeNull();
  });

  it('rejects missing paths and stores the artifact', async () => {
    const source = createMemoryCourseSource(library);
    await expect(source.readText('nope.json')).rejects.toThrow('ENOENT');
    await expect(source.list('nope')).rejects.toThrow('ENOENT');
    expect(await source.readArtifact()).toBeNull();
    await source.writeArtifact('{"revision":"r"}');
    expect(await source.readArtifact()).toBe('{"revision":"r"}');
  });
});

describe('createFakeExerciseTypes', () => {
  const passed = { outcome: 'passed', durationMs: 1 } as const;
  const failed = {
    outcome: 'failed',
    reason: 'mismatch',
    durationMs: 1,
  } as const;
  const request = (answer: unknown) => ({
    type: 'fake.t',
    exerciseId: 'c::l::e',
    spec: {},
    answer,
    timeoutMs: 2000,
    authorMode: false,
  });

  it('plays the script in order and records every request', async () => {
    const types = createFakeExerciseTypes({
      types: { 'fake.t': { script: [failed, passed] } },
    });
    expect(await types.grade(request('a'))).toBe(failed);
    expect(await types.grade(request('b'))).toBe(passed);
    expect(types.requests.map((r) => r.answer)).toEqual(['a', 'b']);
    await expect(types.grade(request('c'))).rejects.toThrow(
      'script is exhausted',
    );
  });

  it('describes only configured types and reports missing references', async () => {
    const types = createFakeExerciseTypes({
      types: { 'fake.t': { element: 'fake-el' } },
    });
    expect(types.describe('fake.t')?.element).toBe('fake-el');
    expect(types.describe('other')).toBeUndefined();
    expect(types.validateSpec('other', {})).toEqual(['unknown exercise type']);
    expect(
      await types.referenceAnswer({
        type: 'fake.t',
        exerciseId: 'x',
        spec: {},
      }),
    ).toEqual({ found: false });
    await types.close();
    expect(types.closed).toBe(true);
  });
});

describe('createFakeExtensionRegistry', () => {
  it('is empty by default and returns the given items', () => {
    expect(createFakeExtensionRegistry().list()).toEqual([]);
    const item: ExtensionInfoDto = {
      id: 'a.b',
      version: null,
      origin: 'user',
      state: 'invalid',
      contributes: {
        exerciseTypes: [],
        themes: [],
        markdownRenderers: [],
        gradePolicies: [],
      },
      message: 'broken',
      permissions: [],
      isolation: 'isolated',
      toggleable: false,
    };
    expect(createFakeExtensionRegistry([{ ...item }]).list()).toEqual([item]);
  });

  it('has empty contributions by default and returns the given ones', () => {
    const empty = { themes: [], markdownRenderers: [], gradePolicies: [] };
    expect(createFakeExtensionRegistry().contributions()).toEqual(empty);
    const given = {
      ...empty,
      gradePolicies: [{ id: 'a.p', extensionId: 'a', label: 'P' }],
    };
    expect(createFakeExtensionRegistry([], given).contributions()).toEqual(
      given,
    );
  });
});

describe('createFakeExtensionPolicy', () => {
  it('isolates everything except bundled and trusted; disabled only by settings', () => {
    const policy = createFakeExtensionPolicy({ bundled: ['lms.sql'] });
    expect(policy.isIsolated('acme.x')).toBe(true);
    expect(policy.isIsolated('lms.sql')).toBe(false);
    expect(policy.isEnabled('acme.x')).toBe(true);
    policy.update({ disabled: ['acme.x', 'lms.sql'], trusted: ['acme.x'] });
    expect(policy.isEnabled('acme.x')).toBe(false);
    expect(policy.isEnabled('lms.sql')).toBe(true);
    expect(policy.isIsolated('acme.x')).toBe(false);
    expect(policy.updates).toHaveLength(1);
  });
});
