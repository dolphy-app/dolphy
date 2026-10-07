import { describe, expectTypeOf, it } from 'vitest';
import {
  defineAnswerView,
  defineExerciseType,
  defineExtension,
  defineExtensionPanel,
  defineExtensionWidget,
  defineMarkdownRenderer,
  inActivate,
  notify,
  openPanel,
  type ExtensionContext,
  type ExtensionMarkdown,
  type ExtensionPanels,
  type ExtensionViews,
  type ExtensionWidgets,
} from '@dolphy-app/extension-sdk';
import { useWidget } from '@dolphy-app/extension-sdk/client';
import { defineComponent } from 'vue';

const echo = defineExerciseType({
  project: () => ({}),
  grade: () => ({ outcome: 'passed' }),
});

const complete = {
  exerciseTypes: { 'acme.echo': echo },
  gradePolicies: { 'acme.strict': () => 5 as const },
  events: { 'attempt.closed': () => undefined },
  commands: { 'acme.a': () => undefined, 'acme.b': () => undefined },
  schedules: {
    'acme.morning': () => undefined,
    'acme.hourly': () => undefined,
  },
  importers: { 'acme.in': () => ({ files: {} }) },
  exporters: {
    'acme.out': () => ({ filename: 'a.txt', text: '' }),
    'acme.report': () => ({ filename: 'r.txt', text: '' }),
  },
} as const;

describe('defineExtension with generated ids', () => {
  it('accepts a definition that names every declared id once', () => {
    defineExtension(complete);
    defineExtension({
      ...complete,
      commands: { 'acme.a': inActivate, 'acme.b': () => undefined },
    });
  });

  it('rejects a record that misses a declared id', () => {
    defineExtension({
      ...complete,
      // @ts-expect-error 'acme.b' is declared but not named
      commands: { 'acme.a': () => undefined },
    });
    defineExtension({
      ...complete,
      // @ts-expect-error 'acme.strict' is declared but not named
      gradePolicies: {},
    });
  });

  it('rejects a record that is absent while its ids are declared', () => {
    const {
      exerciseTypes,
      gradePolicies,
      events,
      commands,
      schedules,
      importers,
      exporters,
    } = complete;
    // @ts-expect-error the declared commands have no record
    defineExtension({
      exerciseTypes,
      gradePolicies,
      events,
      schedules,
      importers,
      exporters,
    });
    // @ts-expect-error the declared exercise type has no record
    defineExtension({
      gradePolicies,
      events,
      commands,
      schedules,
      importers,
      exporters,
    });
    // @ts-expect-error the declared importer has no record
    defineExtension({
      exerciseTypes,
      gradePolicies,
      events,
      commands,
      schedules,
      exporters,
    });
    // @ts-expect-error the declared exporters have no record
    defineExtension({
      exerciseTypes,
      gradePolicies,
      events,
      commands,
      schedules,
      importers,
    });
    // @ts-expect-error the declared schedules have no record
    defineExtension({
      exerciseTypes,
      gradePolicies,
      events,
      commands,
      importers,
      exporters,
    });
  });

  it('names schedules exactly: a missing, an extra, and an inActivate id', () => {
    defineExtension({
      ...complete,
      schedules: { 'acme.morning': inActivate, 'acme.hourly': () => undefined },
    });
    defineExtension({
      ...complete,
      // @ts-expect-error 'acme.hourly' is declared but not named
      schedules: { 'acme.morning': () => undefined },
    });
    defineExtension({
      ...complete,
      schedules: {
        'acme.morning': () => undefined,
        'acme.hourly': () => undefined,
        // @ts-expect-error 'acme.more' is not declared
        'acme.more': () => undefined,
      },
    });
  });

  it('names importers and exporters exactly: a missing, an extra, and an inActivate id', () => {
    defineExtension({
      ...complete,
      importers: { 'acme.in': inActivate },
      exporters: {
        'acme.out': inActivate,
        'acme.report': () => ({ filename: 'r', text: '' }),
      },
    });
    defineExtension({
      ...complete,
      // @ts-expect-error 'acme.report' is declared but not named
      exporters: { 'acme.out': () => ({ filename: 'a', text: '' }) },
    });
    defineExtension({
      ...complete,
      importers: {
        'acme.in': () => ({ files: {} }),
        // @ts-expect-error 'acme.more' is not declared
        'acme.more': () => ({ files: {} }),
      },
    });
  });

  it('types the importer input as text or bytes and checks the result shape', () => {
    defineExtension({
      ...complete,
      importers: {
        'acme.in': (input) => {
          expectTypeOf(input.name).toBeString();
          if ('text' in input) expectTypeOf(input.text).toBeString();
          else expectTypeOf(input.bytes).toEqualTypeOf<Uint8Array>();
          return { files: { 'a.md': 'x' } };
        },
      },
    });
    defineExtension({
      ...complete,
      importers: {
        // @ts-expect-error the result needs `files`
        'acme.in': () => ({ file: {} }),
      },
    });
  });

  it('rejects an id the manifest does not declare', () => {
    defineExtension({
      ...complete,
      // @ts-expect-error 'acme.c' is not declared
      commands: { ...complete.commands, 'acme.c': () => undefined },
    });
    defineExtension({
      ...complete,
      // @ts-expect-error 'acme.other' is not declared
      exerciseTypes: { 'acme.echo': echo, 'acme.other': echo },
    });
  });

  it('rejects an event the manifest does not declare', () => {
    defineExtension({
      ...complete,
      events: {
        'attempt.closed': () => undefined,
        // @ts-expect-error 'session.started' is not declared
        'session.started': () => undefined,
      },
    });
  });

  it('types the event handler payload by the event name', () => {
    defineExtension({
      ...complete,
      events: {
        'attempt.closed': (payload) => {
          expectTypeOf(payload.grade).toEqualTypeOf<1 | 2 | 3 | 4 | 5>();
        },
      },
    });
  });

  it('types ctx by the declared ids', () => {
    defineExtension({
      ...complete,
      activate(ctx) {
        expectTypeOf(ctx).toEqualTypeOf<ExtensionContext>();
        expectTypeOf(ctx.settings.get('acme.goal')).toEqualTypeOf<number>();
        expectTypeOf(ctx.settings.get('acme.on')).toEqualTypeOf<boolean>();
        expectTypeOf(ctx.settings.get('acme.name')).toEqualTypeOf<string>();
        expectTypeOf(ctx.settings.get('acme.mode')).toEqualTypeOf<
          'fast' | 'slow'
        >();
        // @ts-expect-error not a declared setting
        ctx.settings.get('acme.nope');
        // @ts-expect-error not a declared setting
        ctx.settings.onDidChange(({ id }) => void (id === 'acme.nope'));
      },
    });
  });

  it('narrows the setting change by id', () => {
    defineExtension({
      ...complete,
      activate(ctx) {
        ctx.settings.onDidChange((change) => {
          expectTypeOf(change.id).toEqualTypeOf<
            'acme.goal' | 'acme.on' | 'acme.name' | 'acme.mode'
          >();
          if (change.id === 'acme.goal') {
            expectTypeOf(change.value).toEqualTypeOf<number>();
          } else if (change.id === 'acme.mode') {
            expectTypeOf(change.value).toEqualTypeOf<'fast' | 'slow'>();
          }
        });
      },
    });
  });

  it('registers only declared commands, events, exercise types and policies', () => {
    defineExtension({
      ...complete,
      activate(ctx) {
        ctx.importers.register('acme.in', () => ({ files: {} }));
        // @ts-expect-error not a declared importer
        ctx.importers.register('acme.out', () => ({ files: {} }));
        ctx.exporters.register('acme.report', () => ({
          filename: 'a',
          text: '',
        }));
        // @ts-expect-error not a declared exporter
        ctx.exporters.register('acme.in', () => ({ filename: 'a', text: '' }));
        ctx.commands.register('acme.a', () => undefined);
        // @ts-expect-error not a declared command
        ctx.commands.register('acme.c', () => undefined);
        ctx.schedule.on('acme.morning', () => undefined);
        // @ts-expect-error not a declared schedule
        ctx.schedule.on('acme.evening', () => undefined);
        ctx.events.on('attempt.closed', ({ grade }) => void grade);
        // @ts-expect-error not a declared event
        ctx.events.on('session.started', () => undefined);
        ctx.registerExerciseType('acme.echo', echo);
        // @ts-expect-error not a declared exercise type
        ctx.registerExerciseType('acme.other', echo);
        ctx.registerGradePolicy('acme.strict', () => 5);
        // @ts-expect-error not a declared policy
        ctx.registerGradePolicy('acme.lenient', () => 5);
      },
    });
  });
});

describe('views, panels, widgets and markdown with generated ids', () => {
  const view = defineAnswerView(() => ({ update: () => undefined }));
  const panel = defineExtensionPanel({ mount: () => undefined });
  const widget = defineExtensionWidget(defineComponent({}));
  const renderer = defineMarkdownRenderer(() => undefined);

  it('accept exactly the declared keys', () => {
    const views = { 'acme.echo': view } satisfies ExtensionViews;
    const panels = { 'acme.panel': panel } satisfies ExtensionPanels;
    const widgets = { 'acme.widget': widget } satisfies ExtensionWidgets;
    const markdown = { echo: renderer } satisfies ExtensionMarkdown;
    expectTypeOf(widgets).toHaveProperty('acme.widget');
    expectTypeOf(views).toHaveProperty('acme.echo');
    expectTypeOf(panels).toHaveProperty('acme.panel');
    expectTypeOf(markdown).toHaveProperty('echo');
  });

  it('reject a missing and an extra key', () => {
    // @ts-expect-error 'acme.echo' is declared but not named
    const noViews = {} satisfies ExtensionViews;
    const extraView = {
      'acme.echo': view,
      // @ts-expect-error 'acme.more' is not declared
      'acme.more': view,
    } satisfies ExtensionViews;
    // @ts-expect-error 'acme.panel' is declared but not named
    const noPanels = {} satisfies ExtensionPanels;
    const extraPanel = {
      'acme.panel': panel,
      // @ts-expect-error 'acme.more' is not declared
      'acme.more': panel,
    } satisfies ExtensionPanels;
    // @ts-expect-error 'acme.widget' is declared but not named
    const noWidgets = {} satisfies ExtensionWidgets;
    const extraWidget = {
      'acme.widget': widget,
      // @ts-expect-error 'acme.more' is not declared
      'acme.more': widget,
    } satisfies ExtensionWidgets;
    // @ts-expect-error 'echo' is declared but not named
    const noMarkdown = {} satisfies ExtensionMarkdown;
    const extraMarkdown = {
      echo: renderer,
      // @ts-expect-error 'other' is not declared
      other: renderer,
    } satisfies ExtensionMarkdown;
    void [
      noViews,
      extraView,
      noPanels,
      extraPanel,
      noWidgets,
      extraWidget,
      noMarkdown,
      extraMarkdown,
    ];
  });

  it('narrow what a widget may call', () => {
    const handle = useWidget();
    void handle.call('acme.a');
    // @ts-expect-error not a declared command
    void handle.call('acme.c');
    expectTypeOf(handle.context.courseId).toEqualTypeOf<string | null>();
  });

  it('narrow what a panel may call and open', () => {
    defineExtensionPanel({
      mount(_container, ctx) {
        void ctx.call('acme.a');
        // @ts-expect-error not a declared command
        void ctx.call('acme.c');
      },
    });
    expectTypeOf(openPanel('acme.panel', { n: 1 })).toHaveProperty('openPanel');
    // @ts-expect-error not a declared panel
    openPanel('acme.other');
    expectTypeOf(notify('hi')).toHaveProperty('notify');
  });
});
