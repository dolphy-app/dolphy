import { describe, expectTypeOf, it } from 'vitest';
import type {
  AnswerChange,
  AnswerVerdict,
  AnswerViewProps,
  BytesImportInput,
  CourseExportInput,
  ExerciseTypeHandler,
  ExtensionContext,
  GradeResult,
  ImportInput,
  JsonValue,
  LearningEventHandler,
  LearningEventName,
  LearningEventPayloads,
  PanelContextInfo,
  PanelHandle,
  ProgressExportInput,
  SettingContribution,
  SettingValue,
  WidgetHandle,
  TextImportInput,
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

  it('an importer takes the text or bytes form, an exporter the course or progress form', () => {
    const importers: ExtensionContext['importers'] = {
      register: () => ({ dispose: () => undefined }),
    };
    importers.register('a.text', ({ name, text }: TextImportInput) => ({
      files: { [name]: text },
    }));
    importers.register('a.bytes', ({ bytes }: BytesImportInput) => ({
      files: { size: String(bytes.length) },
    }));
    importers.register('a.any', async (input) => {
      expectTypeOf(input).toEqualTypeOf<ImportInput>();
      return { files: {} };
    });
    // @ts-expect-error the result needs `files`
    importers.register('a.bad', () => ({ file: {} }));
    // @ts-expect-error a file content is text
    importers.register('a.number', () => ({ files: { a: 1 } }));

    const exporters: ExtensionContext['exporters'] = {
      register: () => ({ dispose: () => undefined }),
    };
    exporters.register('a.course', ({ title, files }: CourseExportInput) => ({
      filename: `${title}.json`,
      text: JSON.stringify(files),
    }));
    exporters.register('a.progress', (input: ProgressExportInput) => {
      expectTypeOf(input.scope).toEqualTypeOf<'progress'>();
      return { filename: 'p.bin', bytes: new Uint8Array() };
    });
    // @ts-expect-error `filename` is required
    exporters.register('a.nameless', () => ({ text: 'x' }));
    // @ts-expect-error a file is text or bytes, not both missing
    exporters.register('a.empty', () => ({ filename: 'a' }));
  });

  it('a panel handle gives the id, reactive props and surroundings, and a command call', () => {
    const handle: PanelHandle<'a.run'> = {
      panelId: 'a.panel',
      props: undefined,
      context: { courseId: null },
      call: () => Promise.resolve(undefined),
    };
    expectTypeOf(handle.panelId).toEqualTypeOf<string>();
    expectTypeOf(handle.props).toEqualTypeOf<JsonValue | undefined>();
    expectTypeOf(handle.context).toEqualTypeOf<PanelContextInfo>();
    expectTypeOf(handle.call).parameter(0).toEqualTypeOf<'a.run'>();
    expectTypeOf(handle.call).returns.toEqualTypeOf<
      Promise<JsonValue | undefined>
    >();
    expectTypeOf<PanelHandle['call']>().parameter(0).toEqualTypeOf<string>();
  });

  it('an answer view gets typed props and emits an answer change', () => {
    type Props = AnswerViewProps<{ options: string[] }, number>;
    expectTypeOf<Props['view']>().toEqualTypeOf<{ options: string[] }>();
    expectTypeOf<Props['value']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Props['disabled']>().toEqualTypeOf<boolean>();
    expectTypeOf<Props['verdict']>().toEqualTypeOf<AnswerVerdict | null>();
    expectTypeOf<Props['label']>().toEqualTypeOf<string | null>();
    expectTypeOf<AnswerChange<number>>().toEqualTypeOf<{
      value: number;
      complete: boolean;
    }>();
    expectTypeOf<AnswerVerdict['outcome']>().toEqualTypeOf<
      'passed' | 'failed' | 'error'
    >();
  });

  it('a widget handle gives the id, the reactive surroundings and a command call', () => {
    const handle: WidgetHandle<'a.run'> = {
      widgetId: 'a.widget',
      context: { courseId: null },
      call: () => Promise.resolve(undefined),
    };
    expectTypeOf(handle.widgetId).toEqualTypeOf<string>();
    expectTypeOf(handle.context.courseId).toEqualTypeOf<string | null>();
    expectTypeOf(handle.call).parameter(0).toEqualTypeOf<'a.run'>();
    expectTypeOf(handle.call).returns.toEqualTypeOf<
      Promise<JsonValue | undefined>
    >();
    // a widget is not opened with properties
    expectTypeOf(handle).not.toHaveProperty('props');
  });

  describe('narrowed ids', () => {
    interface Ids {
      exerciseTypes: 'a.type';
      gradePolicies: 'a.policy';
      commands: 'a.run' | 'a.stop';
      events: 'attempt.closed';
      panels: 'a.panel';
      widgets: 'a.widget';
      schedules: 'a.morning' | 'a.hourly';
      importers: 'a.in';
      exporters: 'a.out';
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

    it('commands, schedules, events and registrations take the declared ids only', () => {
      expectTypeOf<Narrow['commands']['register']>()
        .parameter(0)
        .toEqualTypeOf<'a.run' | 'a.stop'>();
      expectTypeOf<Narrow['schedule']['on']>()
        .parameter(0)
        .toEqualTypeOf<'a.morning' | 'a.hourly'>();
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
  });
});
