import { buildLibrary } from '@spirula/testkit';
import { describe, expect, it } from 'vitest';
import { findOrphanDiagnostics } from '../../src/app/index.ts';
import { assembleLibrary } from '../../src/domain/library.ts';

const library = () => {
  const { courses, lessons, exercises } = buildLibrary({
    courses: [{ id: 'a', lessons: [{ id: 'l0', exercises: 2 }] }],
  });
  return assembleLibrary(courses, lessons, exercises, { cycleCheck: true });
};

describe('findOrphanDiagnostics', () => {
  it('reports one sorted warning per unknown unit and skips known ones', () => {
    const diagnostics = findOrphanDiagnostics(
      ['zed', 'a::l0::e0', 'old', 'zed', 'a', 'a::l0', 'old_course::l0'],
      library(),
    );
    expect(diagnostics.map(({ unitId }) => unitId)).toEqual([
      'old',
      'old_course::l0',
      'zed',
    ]);
    for (const diagnostic of diagnostics) {
      expect(diagnostic).toMatchObject({
        code: 'W_ORPHAN_EVENTS',
        severity: 'warning',
      });
      expect(diagnostic.message).toContain(diagnostic.unitId);
      expect('path' in diagnostic).toBe(false);
    }
  });

  it('is empty when every seen unit exists', () => {
    expect(findOrphanDiagnostics(new Set(['a::l0::e1']), library())).toEqual(
      [],
    );
    expect(findOrphanDiagnostics([], library())).toEqual([]);
  });
});
