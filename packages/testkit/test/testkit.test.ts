import type { ExtensionInfoDto } from '@dolphy-app/engine-contract';
import { ExtensionInstallError } from '@dolphy-app/engine/ports';
import { describe, expect, it } from 'vitest';
import {
  FAKE_CATALOG_URL,
  buildAttempt,
  buildLibrary,
  buildProgressReset,
  buildUnitFlag,
  createFakeClock,
  createFakeExerciseTypes,
  createFakeExtensionInstaller,
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
        settings: [],
        events: [],
        commands: [],
        widgets: [],
        panels: [],
        importers: [],
        exporters: [],
      },
      diagnostics: [{ code: 'load-failed', data: { reason: 'broken' } }],
      permissions: [],
      isolation: 'isolated',
      toggleable: false,
      name: null,
      description: null,
      author: null,
      icon: null,
      titles: {},
      messages: {},
      tags: [],
      installed: null,
      removable: true,
      revoked: null,
      deprecated: null,
    };
    expect(createFakeExtensionRegistry([{ ...item }]).list()).toEqual([item]);
  });

  it('has empty contributions by default and returns the given ones', () => {
    const empty = {
      exerciseTypes: [],
      themes: [],
      markdownRenderers: [],
      gradePolicies: [],
      settings: [],
      commands: [],
      panels: [],
      widgets: [],
      importers: [],
      exporters: [],
      messages: {},
    };
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
    const policy = createFakeExtensionPolicy({ bundled: ['dolphy.sql'] });
    expect(policy.isIsolated('acme.x')).toBe(true);
    expect(policy.isIsolated('dolphy.sql')).toBe(false);
    expect(policy.isEnabled('acme.x')).toBe(true);
    policy.update({
      disabled: ['acme.x', 'dolphy.sql'],
      trusted: ['acme.x'],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
    });
    expect(policy.isEnabled('acme.x')).toBe(false);
    expect(policy.isEnabled('dolphy.sql')).toBe(true);
    expect(policy.isIsolated('acme.x')).toBe(false);
    expect(policy.updates).toHaveLength(1);
  });

  it('revoked extensions are disabled regardless of settings, except bundled', () => {
    const policy = createFakeExtensionPolicy({
      bundled: ['dolphy.sql'],
      revoked: { 'acme.x': 'bad', 'dolphy.sql': 'bad' },
    });
    expect(policy.isEnabled('acme.x')).toBe(false);
    expect(policy.isEnabled('dolphy.sql')).toBe(true);
    policy.setRevoked('acme.x', null);
    expect(policy.isEnabled('acme.x')).toBe(true);
    policy.setRevoked('acme.x', 'again');
    expect(policy.isEnabled('acme.x')).toBe(false);
  });
});

describe('createFakeExtensionInstaller', () => {
  it('records calls and returns scripted results; handlers may throw', async () => {
    const installer = createFakeExtensionInstaller({
      revoked: { 'acme.x': 'bad' },
      handlers: {
        install: async (id) => {
          if (id === 'acme.broken') {
            throw new ExtensionInstallError('network', id, 'offline');
          }
          return {
            id,
            version: '2.0.0',
            previousVersion: '1.0.0',
          };
        },
      },
    });
    expect(await installer.install('acme.ok')).toMatchObject({
      version: '2.0.0',
    });
    await expect(
      installer.install('acme.broken', '1.0.0'),
    ).rejects.toMatchObject({ cause: 'network' });
    expect(await installer.updates()).toEqual([]);
    expect(await installer.checkForUpdates()).toBe(0);
    expect(installer.revocationOf('acme.x', '1.0.0', FAKE_CATALOG_URL)).toBe(
      'bad',
    );
    expect(
      installer.revocationOf('acme.y', '1.0.0', FAKE_CATALOG_URL),
    ).toBeNull();
    expect(installer.calls).toEqual([
      { method: 'install', args: ['acme.ok'] },
      { method: 'install', args: ['acme.broken', '1.0.0'] },
      { method: 'updates', args: [] },
      { method: 'checkForUpdates', args: [] },
    ]);
  });
});

describe('createFakeExtensionInstaller: docs and deprecation', () => {
  const deprecation = {
    versions: null,
    reason: 'Old',
    alternatives: [{ id: 'acme.new', name: null }],
  };

  it('answers deprecationOf from the table (copies) and setDeprecated changes it', () => {
    const installer = createFakeExtensionInstaller({
      deprecated: { 'acme.x': deprecation },
    });
    const first = installer.deprecationOf('acme.x', '1.0.0', FAKE_CATALOG_URL);
    expect(first).toEqual(deprecation);
    first?.alternatives.pop();
    expect(
      installer.deprecationOf('acme.x', '1.0.0', FAKE_CATALOG_URL),
    ).toEqual(deprecation);
    installer.setDeprecated('acme.x', null);
    expect(
      installer.deprecationOf('acme.x', '1.0.0', FAKE_CATALOG_URL),
    ).toBeNull();
    installer.setDeprecated('acme.y', deprecation);
    expect(
      installer.deprecationOf('acme.y', '9.9.9', FAKE_CATALOG_URL),
    ).toEqual(deprecation);
  });

  it('revocation and deprecation apply only to extensions installed from the current catalog, which useCatalog switches', async () => {
    const installer = createFakeExtensionInstaller({
      revoked: { 'acme.x': 'bad' },
      deprecated: { 'acme.x': deprecation },
    });
    const other = 'https://other.test/index.json';
    expect(installer.revocationOf('acme.x', '1.0.0', other)).toBeNull();
    expect(installer.deprecationOf('acme.x', '1.0.0', other)).toBeNull();
    await installer.useCatalog(other);
    expect(installer.catalogSource()).toEqual({
      url: other,
      default: FAKE_CATALOG_URL,
      origin: 'setting',
    });
    expect(installer.revocationOf('acme.x', '1.0.0', other)).toBe('bad');
    expect(
      installer.revocationOf('acme.x', '1.0.0', FAKE_CATALOG_URL),
    ).toBeNull();
    await installer.useCatalog(null);
    expect(installer.catalogSource().origin).toBe('default');
  });

  it('records docs, docImage and versionFile; handlers override the defaults', async () => {
    const installer = createFakeExtensionInstaller({
      handlers: {
        docs: (id) => ({
          version: '3.0.0',
          readme: id,
          changelog: null,
          truncated: false,
          source: 'cache',
        }),
      },
    });
    expect(await installer.docs('acme.x')).toMatchObject({
      version: '3.0.0',
      readme: 'acme.x',
      source: 'cache',
    });
    expect(await installer.docs('acme.y', '1.0.0')).toMatchObject({
      readme: 'acme.y',
    });
    expect(await installer.docImage('acme.x', '1.0.0', 'a.png')).toMatch(
      /^data:image\/png/,
    );
    expect(
      (await installer.versionFile('acme.x', '1.0.0', 'README.md')).bytes,
    ).toHaveLength(0);
    expect(installer.calls).toEqual([
      { method: 'docs', args: ['acme.x'] },
      { method: 'docs', args: ['acme.y', '1.0.0'] },
      { method: 'docImage', args: ['acme.x', '1.0.0', 'a.png'] },
      { method: 'versionFile', args: ['acme.x', '1.0.0', 'README.md'] },
    ]);
  });
});
