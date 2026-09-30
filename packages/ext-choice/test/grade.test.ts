import { describe, expect, it } from 'vitest';
import { grade, project } from '../src/grade.ts';
import type { ChoiceSpec } from '../src/grade.ts';

const single: ChoiceSpec = { options: ['a', 'b', 'c'], correct: [1] };
const multi: ChoiceSpec = {
  options: ['a', 'b', 'c', 'd'],
  correct: [0, 1, 3],
  multiple: true,
};

describe('dolphy.choice: grade', () => {
  const table: [string, ChoiceSpec, number[], object][] = [
    ['одиночный верный', single, [1], { outcome: 'passed' }],
    [
      'одиночный неверный',
      single,
      [0],
      { outcome: 'failed', reason: 'mismatch' },
    ],
    ['множественный полный', multi, [3, 0, 1], { outcome: 'passed' }],
    [
      'множественный частичный',
      multi,
      [0, 1],
      { outcome: 'failed', reason: 'mismatch' },
    ],
    [
      'множественный лишний',
      multi,
      [0, 1, 2, 3],
      { outcome: 'failed', reason: 'mismatch' },
    ],
    [
      'одиночный: два индекса',
      single,
      [0, 1],
      { outcome: 'failed', reason: 'invalid_answer' },
    ],
    [
      'индекс вне вариантов',
      single,
      [7],
      { outcome: 'failed', reason: 'invalid_answer' },
    ],
    [
      'пустой ответ на одиночный',
      single,
      [],
      { outcome: 'failed', reason: 'invalid_answer' },
    ],
    [
      'correct вне вариантов',
      { options: ['a', 'b'], correct: [5] },
      [0],
      { outcome: 'error', reason: 'invalid_spec' },
    ],
    [
      'одиночный с двумя верными',
      { options: ['a', 'b'], correct: [0, 1] },
      [0],
      { outcome: 'error', reason: 'invalid_spec' },
    ],
  ];
  it.each(table)('%s', (_name, spec, answer, expected) => {
    expect(grade(spec, answer, false)).toMatchObject(expected);
  });

  it('detail только в режиме автора и только у mismatch', () => {
    const learner = grade(multi, [0], false);
    expect(learner).not.toHaveProperty('detail');
    expect(grade(multi, [0], true)).toMatchObject({
      detail: 'expected: 0, 1, 3',
    });
    expect(grade(multi, [0, 1, 3], true)).toEqual({ outcome: 'passed' });
  });

  it('project не раскрывает правильные ответы', () => {
    expect(project(multi)).toEqual({
      multiple: true,
      options: multi.options,
    });
    expect(project(single)).toEqual({
      multiple: false,
      options: single.options,
    });
  });
});
