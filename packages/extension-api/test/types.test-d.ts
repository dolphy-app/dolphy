import { describe, expectTypeOf, it } from 'vitest';
import type {
  ExerciseTypeHandler,
  ExtensionContext,
  GradeResult,
  LearningEventHandler,
  LearningEventPayloads,
  SettingContribution,
} from '../src/index.ts';

describe('extension-api types', () => {
  it('GradeResult is discriminated by outcome', () => {
    const narrow = (result: GradeResult) => {
      if (result.outcome === 'failed') return result.reason;
      if (result.outcome === 'error') return result.reason;
      return null;
    };
    expectTypeOf(narrow).returns.toEqualTypeOf<string | null>();
  });

  it('a typed handler is registrable through the untyped context', () => {
    const handler: ExerciseTypeHandler<{ a: 1 }, string> = {
      project: ({ spec }) => spec.a,
      grade: ({ answer }) => ({
        outcome: answer === 'x' ? 'passed' : 'failed',
        reason: 'mismatch',
      }),
    };
    type Register = ExtensionContext['registerExerciseType'];
    expectTypeOf(handler).toExtend<Parameters<Register>[1]>();
  });

  it('the event handler payload follows the event name', () => {
    const events: ExtensionContext['events'] = {
      on: () => ({ dispose: () => undefined }),
    };
    events.on('attempt.closed', ({ grade }) => void grade);
    // @ts-expect-error у session.started нет оценки
    events.on('session.started', ({ grade }) => void grade);
    // @ts-expect-error неизвестное событие
    events.on('attempt.opened', () => undefined);
    expectTypeOf<LearningEventHandler<'session.finished'>>()
      .parameter(0)
      .toEqualTypeOf<LearningEventPayloads['session.finished']>();
  });

  it('a setting is discriminated by its type', () => {
    const narrow = (setting: SettingContribution) => {
      if (setting.type === 'number') return setting.min;
      if (setting.type === 'enum') return setting.options;
      return null;
    };
    expectTypeOf(narrow).returns.toEqualTypeOf<
      number | undefined | { value: string; label: string }[] | null
    >();
  });
});
