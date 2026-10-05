import { describe, expectTypeOf, it } from 'vitest';
import type {
  ExerciseTypeHandler,
  ExtensionContext,
  GradeResult,
  JsonValue,
  LearningEventHandler,
  LearningEventName,
  LearningEventPayloads,
  PanelContext,
  PanelContextInfo,
  PanelModule,
  SettingContribution,
  SettingValue,
  WidgetModule,
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
    // @ts-expect-error session.started has no grade
    events.on('session.started', ({ grade }) => void grade);
    // @ts-expect-error unknown event
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

  it('a command handler may return nothing, an effect, JSON or a promise of them', () => {
    const commands: ExtensionContext['commands'] = {
      register: () => ({ dispose: () => undefined }),
    };
    commands.register('a.none', () => undefined);
    commands.register('a.notify', () => ({ notify: 'done' }));
    commands.register('a.open', () => ({ openPanel: 'p', props: { n: 1 } }));
    commands.register('a.json', () => ({ list: [1, null, 'x'] }));
    commands.register('a.async', async () => ({ notify: 'later' }));
    commands.register('a.args', (args) => {
      expectTypeOf(args).toEqualTypeOf<JsonValue | undefined>();
    });
    // @ts-expect-error a function is not JSON
    commands.register('a.bad', () => () => 1);
  });

  it('a panel module receives call, onProps, signal, panelId and props', () => {
    const module: PanelModule<{ id: string }> = {
      mount: (container, ctx) => {
        expectTypeOf(container).toEqualTypeOf<{ id: string }>();
        expectTypeOf(ctx.panelId).toEqualTypeOf<string>();
        expectTypeOf(ctx.props).toEqualTypeOf<JsonValue | undefined>();
        expectTypeOf(ctx.signal.aborted).toEqualTypeOf<boolean>();
        expectTypeOf(ctx.call).returns.toEqualTypeOf<
          Promise<JsonValue | undefined>
        >();
        expectTypeOf(ctx.onProps).returns.toEqualTypeOf<() => void>();
        expectTypeOf(ctx.context).toEqualTypeOf<PanelContextInfo>();
        expectTypeOf(ctx.context.courseId).toEqualTypeOf<string | null>();
        expectTypeOf(ctx.onContextChange).returns.toEqualTypeOf<() => void>();
      },
    };
    expectTypeOf(module.mount).toBeFunction();
  });

  it('a widget module gets the frame context without properties', () => {
    const module: WidgetModule<{ id: string }, 'a.run'> = {
      mount: (container, ctx) => {
        expectTypeOf(container).toEqualTypeOf<{ id: string }>();
        expectTypeOf(ctx.widgetId).toEqualTypeOf<string>();
        expectTypeOf(ctx.context.courseId).toEqualTypeOf<string | null>();
        expectTypeOf(ctx.call).parameter(0).toEqualTypeOf<'a.run'>();
        // a widget is not opened with properties
        expectTypeOf(ctx).not.toHaveProperty('props');
      },
    };
    expectTypeOf(module.mount).toBeFunction();
  });

  describe('narrowed ids', () => {
    interface Ids {
      exerciseTypes: 'a.type';
      gradePolicies: 'a.policy';
      commands: 'a.run' | 'a.stop';
      events: 'attempt.closed';
      panels: 'a.panel';
      widgets: 'a.widget';
      markdownLanguages: 'a';
      settings: { 'a.goal': number; 'a.mode': 'fast' | 'slow' };
    }
    type Narrow = ExtensionContext<Ids>;

    it('a context without parameters accepts any id, as the engine and host use it', () => {
      expectTypeOf<ExtensionContext['commands']['register']>()
        .parameter(0)
        .toEqualTypeOf<string>();
      expectTypeOf<
        ExtensionContext['settings']['get']
      >().returns.toEqualTypeOf<SettingValue>();
      expectTypeOf<ExtensionContext['registerExerciseType']>()
        .parameter(0)
        .toEqualTypeOf<string>();
      expectTypeOf<ExtensionContext['events']['on']>()
        .parameter(0)
        .toEqualTypeOf<LearningEventName>();
    });

    it('settings.get returns the declared type of the setting', () => {
      const settings: Narrow['settings'] = {
        get: () => {
          throw new Error('unused');
        },
        onDidChange: () => ({ dispose: () => undefined }),
      };
      expectTypeOf(settings.get('a.goal')).toEqualTypeOf<number>();
      expectTypeOf(settings.get('a.mode')).toEqualTypeOf<'fast' | 'slow'>();
      // @ts-expect-error not a declared setting
      settings.get('a.other');
    });

    it('onDidChange hands over a change that narrows value by id', () => {
      type Handler = Parameters<Narrow['settings']['onDidChange']>[0];
      expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<
        | { id: 'a.goal'; value: number }
        | { id: 'a.mode'; value: 'fast' | 'slow' }
      >();
    });

    it('commands, events and registrations take the declared ids only', () => {
      expectTypeOf<Narrow['commands']['register']>()
        .parameter(0)
        .toEqualTypeOf<'a.run' | 'a.stop'>();
      expectTypeOf<Narrow['events']['on']>()
        .parameter(0)
        .toEqualTypeOf<'attempt.closed'>();
      expectTypeOf<Narrow['registerExerciseType']>()
        .parameter(0)
        .toEqualTypeOf<'a.type'>();
      expectTypeOf<Narrow['registerGradePolicy']>()
        .parameter(0)
        .toEqualTypeOf<'a.policy'>();
    });

    it('a panel context calls the declared commands only', () => {
      expectTypeOf<PanelContext<'a.run'>['call']>()
        .parameter(0)
        .toEqualTypeOf<'a.run'>();
      expectTypeOf<PanelContext['call']>().parameter(0).toEqualTypeOf<string>();
    });
  });
});
