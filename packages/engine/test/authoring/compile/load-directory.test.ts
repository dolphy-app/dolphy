import { buildLibrary, createMemoryCourseSource } from '@lms/testkit';
import { describe, expect, it } from 'vitest';
import { loadDirectory } from '../../../src/authoring/load-directory.ts';

const base = () =>
  buildLibrary({
    courses: [
      {
        id: 'a',
        lessons: [
          { id: 'l0', exercises: 1 },
          { id: 'l1', dependencies: ['l0'], exercises: 1 },
        ],
      },
    ],
  });

/** Манифест урока `a::<name>` (файл заменяет сгенерированный). */
const lesson = (name: string, fields: Record<string, unknown> = {}) => ({
  [`a/${name}/lesson_manifest.json`]: JSON.stringify({
    id: `a::${name}`,
    course_id: 'a',
    name,
    ...fields,
  }),
});

const load = (extra: Record<string, string>) =>
  loadDirectory(createMemoryCourseSource(base(), extra));

const codesOf = (diagnostics: ReadonlyArray<{ code: string }>) =>
  diagnostics.map((d) => d.code);

describe('loadDirectory', () => {
  it('a clean library loads with its graph', async () => {
    const { library, summary } = await load({});
    expect(summary.errors).toBe(0);
    expect(library?.getLessonIds('a')).toEqual(['a::l0', 'a::l1']);
    expect(library?.graph.getDependencies('a::l1')).toEqual(new Set(['a::l0']));
  });

  it('does not run the semantic checks of the compiler: a dangling dependency loads, as in Trane', async () => {
    const { library, diagnostics } = await load(
      lesson('l1', { dependencies: ['a::ghost'] }),
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(library?.graph.getDependencies('a::l1')).toEqual(
      new Set(['a::ghost']),
    );
  });

  it.each([
    [
      'a self-dependency',
      lesson('l1', { dependencies: ['a::l1'] }),
      'E_DEP_SELF',
    ],
    [
      'an encompassed weight outside [0, 1]',
      lesson('l1', { dependencies: ['a::l0'], encompassed: [['a::l0', 1.5]] }),
      'E_ENC_WEIGHT',
    ],
    [
      'a dependency cycle',
      lesson('l0', { dependencies: ['a::l1'] }),
      'E_CYCLE_DEPENDENCY',
    ],
    [
      'a superseded cycle',
      {
        ...lesson('l0', { superseded: ['a::l1'] }),
        ...lesson('l1', { superseded: ['a::l0'] }),
      },
      'E_CYCLE_SUPERSEDED',
    ],
    [
      'an encompassed cycle',
      {
        ...lesson('l0', { encompassed: [['a::l1', 0.5]] }),
        ...lesson('l1', { encompassed: [['a::l0', 0.5]] }),
      },
      'E_CYCLE_ENCOMPASSED',
    ],
    [
      'an id shared by a lesson and its course',
      {
        'a/dup/lesson_manifest.json': JSON.stringify({
          id: 'a',
          course_id: 'a',
          name: 'dup',
        }),
      },
      'E_ID_DUPLICATE',
    ],
    [
      'a lesson whose course_id names another course',
      lesson('l1', { course_id: 'other' }),
      'E_ID_MISMATCH',
    ],
  ])(
    '%s gives no library and a diagnostic instead of an exception',
    async (_, extra, code) => {
      const { library, diagnostics, summary } = await load(extra);
      expect(library).toBeNull();
      expect(codesOf(diagnostics)).toContain(code);
      expect(summary.errors).toBeGreaterThan(0);
    },
  );

  it('a cycle diagnostic carries the full path', async () => {
    const { diagnostics } = await load(
      lesson('l0', { dependencies: ['a::l1'] }),
    );
    const cycle = diagnostics.find((d) => d.code === 'E_CYCLE_DEPENDENCY');
    expect(cycle?.related).toEqual(['a::l0', 'a::l1', 'a::l0']);
    expect(cycle?.path).toBe('a/l0/lesson_manifest.json');
  });

  it('a scan error (broken manifest) also gives no library, with every diagnostic', async () => {
    const { library, diagnostics } = await load({
      'a/l1/lesson_manifest.json': '{ nope',
      ...lesson('l0', { dependencies: ['a::l0'] }),
    });
    expect(library).toBeNull();
    expect(codesOf(diagnostics)).toEqual(
      expect.arrayContaining(['E_JSON_PARSE', 'E_DEP_SELF']),
    );
  });
});
