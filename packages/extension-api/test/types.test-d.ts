import { describe, expectTypeOf, it } from 'vitest';
import { MOUNTABLE, anchorSelector, isMountable } from '../src/index.ts';
import type {
  AnswerChange,
  AnswerVerdict,
  AnswerViewProps,
  AppLocale,
  AppTheme,
  BytesImportInput,
  ClientContext,
  ClientEntry,
  CommandRegistration,
  CourseExportInput,
  Disposable,
  EnumSettingOption,
  ExerciseTypeHandler,
  ExerciseTypeRegistration,
  ImporterRegistration,
  ImportInput,
  JsonValue,
  LearningEventHandler,
  LearningEventName,
  LearningEventPayloads,
  LocalizedText,
  PanelContextInfo,
  PanelHandle,
  ProgressExportInput,
  ScheduleRegistration,
  ServerContext,
  ServerEntry,
  ServerRegistration,
  SettingDefinition,
  SettingValue,
  InjectionHandle,
  InjectionPosition,
  InjectionRegistration,
  MarkdownBlockProps,
  MountContext,
  Mountable,
  PanelProps,
  RpcContract,
  TextImportInput,
  Unmount,
} from '../src/index.ts';

const disposable: Disposable = { dispose: () => undefined };

describe('extension-api types', () => {
  it('LocalizedText is a string or texts by language with a required en', () => {
    expectTypeOf<LocalizedText>().toEqualTypeOf<
      string | { readonly en: string; readonly ru?: string }
    >();
    const plain: LocalizedText = 'Plan';
    const both: LocalizedText = { en: 'Plan', ru: 'План' };
    // @ts-expect-error en is required
    const noEnglish: LocalizedText = { ru: 'План' };
    void [plain, both, noEnglish];
  });

  it('an exercise type registration carries metadata and the handler', () => {
    const registration: ExerciseTypeRegistration<{ a: 1 }, string> = {
      id: 'a.type',
      title: { en: 'Type' },
      specSchema: { type: 'object' },
      answerSchema: { type: 'string' },
      project: ({ spec }) => spec.a,
      grade: ({ answer }) => ({
        outcome: answer === 'x' ? 'passed' : 'failed',
        reason: 'mismatch',
      }),
    };
    expectTypeOf(registration).toExtend<
      ExerciseTypeHandler<{ a: 1 }, string>
    >();
    type Register = ServerContext['registerExerciseType'];
    expectTypeOf(registration).toExtend<Parameters<Register>[0]>();
    expectTypeOf<Register>().returns.toEqualTypeOf<Disposable>();
    expectTypeOf<Parameters<Register>[0]['specSchema']>().toEqualTypeOf<
      Record<string, unknown>
    >();
  });

  it('the event handler payload follows the event name', () => {
    const server = {} as ServerContext;
    server.on('attempt.closed', ({ grade }) => void grade);
    // @ts-expect-error session.started has no grade
    server.on('session.started', ({ grade }) => void grade);
    // @ts-expect-error unknown event
    server.on('attempt.opened', () => undefined);
    expectTypeOf<LearningEventHandler<'session.finished'>>()
      .parameter(0)
      .toEqualTypeOf<LearningEventPayloads['session.finished']>();
    expectTypeOf<ServerContext['on']>()
      .parameter(0)
      .toEqualTypeOf<LearningEventName>();
  });

  it('a setting is discriminated by its type and its texts are localizable', () => {
    const narrow = (setting: SettingDefinition) => {
      if (setting.type === 'number') return setting.min;
      if (setting.type === 'enum') return setting.options;
      return null;
    };
    expectTypeOf(narrow).returns.toEqualTypeOf<
      number | undefined | EnumSettingOption[] | null
    >();
    expectTypeOf<EnumSettingOption['label']>().toEqualTypeOf<LocalizedText>();
    const setting: SettingDefinition = {
      id: 'a.goal',
      type: 'number',
      label: { en: 'Goal', ru: 'Цель' },
      default: 5,
    };
    void setting;
  });

  it('a command registration holds the metadata and a handler that may return nothing, an effect, JSON or a promise of them', () => {
    const server = {} as ServerContext;
    const base = { id: 'a.cmd', title: 'Command' };
    server.registerCommand({ ...base, run: () => undefined });
    server.registerCommand({ ...base, run: () => ({ notify: 'done' }) });
    server.registerCommand({
      ...base,
      run: () => ({ openPanel: 'p', props: { n: 1 } }),
    });
    server.registerCommand({ ...base, run: () => ({ list: [1, null, 'x'] }) });
    server.registerCommand({ ...base, run: async () => ({ notify: 'later' }) });
    server.registerCommand({
      ...base,
      palette: false,
      icon: 'star',
      when: "route == 'courses'",
      keybindings: [{ key: 'Mod+Shift+L' }],
      run: (args) => {
        expectTypeOf(args).toEqualTypeOf<JsonValue | undefined>();
      },
    });
    // @ts-expect-error a function is not JSON
    server.registerCommand({ ...base, run: () => () => 1 });
    // @ts-expect-error a command needs a handler
    server.registerCommand(base);
    expectTypeOf<CommandRegistration['title']>().toEqualTypeOf<LocalizedText>();
  });

  it('a schedule is daily with a time or hourly without one', () => {
    const daily: ScheduleRegistration = {
      id: 'a.morning',
      every: 'daily',
      at: '09:00',
    };
    const hourly: ScheduleRegistration = { id: 'a.hourly', every: 'hourly' };
    // @ts-expect-error a daily schedule needs a time
    const timeless: ScheduleRegistration = { id: 'a.late', every: 'daily' };
    const timed: ScheduleRegistration = {
      id: 'a.hour',
      every: 'hourly',
      // @ts-expect-error an hourly schedule takes no time
      at: '09:00',
    };
    void [daily, hourly, timeless, timed];
    expectTypeOf<ServerContext['schedule']>()
      .parameter(1)
      .toEqualTypeOf<() => void | Promise<void>>();
  });

  it('an importer takes the text or bytes form, an exporter the course or progress form', () => {
    const server = {} as ServerContext;
    const importer = { id: 'a.in', title: 'In', accept: ['.csv'] };
    server.registerImporter({
      ...importer,
      input: 'text',
      run: ({ name, text }: TextImportInput) => ({ files: { [name]: text } }),
    });
    server.registerImporter({
      ...importer,
      input: 'bytes',
      run: ({ bytes }: BytesImportInput) => ({
        files: { size: String(bytes.length) },
      }),
    });
    server.registerImporter({
      ...importer,
      input: 'text',
      run: async (input) => {
        expectTypeOf(input).toEqualTypeOf<ImportInput>();
        return { files: {} };
      },
    });
    // @ts-expect-error the result needs `files`
    server.registerImporter({ ...importer, input: 'text', run: () => ({}) });
    server.registerImporter({
      ...importer,
      input: 'text',
      // @ts-expect-error a file content is text
      run: () => ({ files: { a: 1 } }),
    });
    // @ts-expect-error the input kind is required
    server.registerImporter({ ...importer, run: () => ({ files: {} }) });
    expectTypeOf<ImporterRegistration['input']>().toEqualTypeOf<
      'text' | 'bytes'
    >();

    const exporter = { id: 'a.out', title: 'Out' };
    server.registerExporter({
      ...exporter,
      scope: 'course',
      run: ({ title, files }: CourseExportInput) => ({
        filename: `${title}.json`,
        text: JSON.stringify(files),
      }),
    });
    server.registerExporter({
      ...exporter,
      scope: 'progress',
      run: (input: ProgressExportInput) => {
        expectTypeOf(input.scope).toEqualTypeOf<'progress'>();
        return { filename: 'p.bin', bytes: new Uint8Array() };
      },
    });
    server.registerExporter({
      ...exporter,
      scope: 'course',
      // @ts-expect-error `filename` is required
      run: () => ({ text: 'x' }),
    });
    server.registerExporter({
      ...exporter,
      scope: 'course',
      // @ts-expect-error a file is text or bytes, not both missing
      run: () => ({ filename: 'a' }),
    });
  });

  it('a server entry may return nothing, a disposable or a cleanup function, also asynchronously', () => {
    const plain: ServerEntry = () => undefined;
    const disposing: ServerEntry = () => disposable;
    const cleaning: ServerEntry = () => () => undefined;
    const asynchronous: ServerEntry = async (server) => {
      expectTypeOf(server).toEqualTypeOf<ServerContext>();
      return disposable;
    };
    // @ts-expect-error the result is a cleanup, not a value
    const value: ServerEntry = () => 1;
    void [plain, disposing, cleaning, asynchronous, value];
  });

  it('a server registration is data only', () => {
    expectTypeOf<ServerRegistration['events']>().toEqualTypeOf<
      readonly LearningEventName[]
    >();
    expectTypeOf<ServerRegistration['commands'][number]>().not.toHaveProperty(
      'run',
    );
    expectTypeOf<ServerRegistration['importers'][number]>().not.toHaveProperty(
      'run',
    );
    expectTypeOf<
      ServerRegistration['gradePolicies'][number]
    >().not.toHaveProperty('evaluate');
    expectTypeOf<
      ServerRegistration['exerciseTypes'][number]
    >().not.toHaveProperty('grade');
  });

  it('a client context adds components and data and returns a disposable', () => {
    const client = {} as ClientContext;
    expectTypeOf(client.addPanel).returns.toEqualTypeOf<Disposable>();
    client.addPanel({ id: 'a.panel', title: { en: 'Panel' }, component: {} });
    client.addPanel({
      id: 'a.own',
      title: 'Own',
      header: false,
      component: {},
    });
    // @ts-expect-error header is a boolean
    client.addPanel({ id: 'a.bad', title: 'Bad', header: 'no', component: {} });
    client.addInjection({
      id: 'a.plan',
      target: anchorSelector('dailyPlan'),
      component: {},
    });
    client.addInjection({
      id: 'a.badge',
      target: '.title',
      position: 'before',
      component: {},
    });
    client.addInjection({
      id: 'a.bad',
      target: '.title',
      // @ts-expect-error not a position
      position: 'inside',
      component: {},
    });
    client.addAnswerView('a.type', {});
    client.addMarkdownRenderer('mermaid', {});
    client.addTheme({
      id: 'a.dark',
      label: 'Dark',
      dark: true,
      colors: { background: '#000000' },
    });
    client.addCommand({ id: 'a.open', title: 'Open', run: () => undefined });
    client.addCommand({
      id: 'a.open',
      title: 'Open',
      // @ts-expect-error a client command takes no arguments
      run: (args: JsonValue) => void args,
    });
    expectTypeOf<
      Parameters<ClientContext['addInjection']>[0]
    >().toEqualTypeOf<InjectionRegistration>();
    const entry: ClientEntry = async (c) => {
      expectTypeOf(c).toEqualTypeOf<ClientContext>();
    };
    void entry;
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

  it('an injection handle gives the target element and the position', () => {
    const handle = {} as InjectionHandle;
    expectTypeOf(handle.target).toHaveProperty('tagName');
    expectTypeOf(handle.position).toEqualTypeOf<InjectionPosition>();
    expectTypeOf<InjectionPosition>().toEqualTypeOf<
      'before' | 'after' | 'prepend' | 'append'
    >();
  });

  describe('typed settings', () => {
    type Values = {
      'a.goal': number;
      'a.mode': 'fast' | 'slow';
    };
    type Typed = ServerContext<Values>;

    it('a context without parameters returns any setting value', () => {
      expectTypeOf<
        ServerContext['settings']['get']
      >().returns.toEqualTypeOf<SettingValue>();
    });

    it('settings.get returns the type of the setting', () => {
      const { settings } = {} as Typed;
      expectTypeOf(settings.get('a.goal')).toEqualTypeOf<number>();
      expectTypeOf(settings.get('a.mode')).toEqualTypeOf<'fast' | 'slow'>();
      // @ts-expect-error not a known setting
      settings.get('a.other');
    });

    it('onDidChange hands over a change that narrows value by id', () => {
      type Handler = Parameters<Typed['settings']['onDidChange']>[0];
      expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<
        | { id: 'a.goal'; value: number }
        | { id: 'a.mode'; value: 'fast' | 'slow' }
      >();
    });
  });

  describe('Mountable', () => {
    type Ctx = MountContext<PanelProps, { id: 'engine' }, PanelHandle>;

    it('MountContext carries snapshots, listeners and the capabilities of the window', () => {
      expectTypeOf<Ctx['props']>().toEqualTypeOf<PanelProps>();
      expectTypeOf<Ctx['onProps']>().toEqualTypeOf<
        (listener: (props: PanelProps) => void) => () => void
      >();
      expectTypeOf<Ctx['engine']>().toEqualTypeOf<{ id: 'engine' }>();
      expectTypeOf<Ctx['handle']>().toEqualTypeOf<PanelHandle>();
      expectTypeOf<Ctx['signal']>().toEqualTypeOf<AbortSignal>();
      expectTypeOf<Ctx['theme']>().toEqualTypeOf<AppTheme>();
      expectTypeOf<Ctx['locale']>().toEqualTypeOf<AppLocale>();
      expectTypeOf<Ctx['emit']>().toEqualTypeOf<
        (event: string, payload?: unknown) => void
      >();
      expectTypeOf<Ctx['reportError']>().toEqualTypeOf<
        (error: unknown) => void
      >();
      expectTypeOf<MountContext['handle']>().toEqualTypeOf<undefined>();
    });

    it('callRpc takes the contract and gives its output', () => {
      expectTypeOf<Ctx['callRpc']>().toBeCallableWith(
        {} as RpcContract<string, number>,
        'x',
      );
      expectTypeOf<ReturnType<Ctx['callRpc']>>().toEqualTypeOf<
        Promise<unknown>
      >();
    });

    it('mount returns a cleanup, sync or async', () => {
      expectTypeOf<
        Mountable<MarkdownBlockProps>['mount']
      >().returns.toEqualTypeOf<Unmount | Promise<Unmount>>();
      expectTypeOf<Unmount>().toEqualTypeOf<() => void | Promise<void>>();
    });

    it('isMountable narrows to a branded object', () => {
      const value: unknown = {
        [MOUNTABLE]: true,
        mount: () => () => undefined,
      };
      if (isMountable(value)) {
        expectTypeOf(value[MOUNTABLE]).toEqualTypeOf<true>();
      }
    });
  });
});
