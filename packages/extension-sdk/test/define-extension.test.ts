import { describe, expect, it, vi } from 'vitest';
import {
  defineExerciseType,
  defineExtension,
  type Disposable,
  inActivate,
  type ExerciseTypeHandler,
  type ExtensionContext,
} from '../src/index.ts';
import {
  createMemorySecrets,
  createMemorySettings,
  createMemoryNotifications,
  createMemoryStats,
  createMemoryStorage,
} from '../src/testing.ts';

const handler = (): ExerciseTypeHandler =>
  defineExerciseType({
    project: () => ({}),
    grade: () => ({ outcome: 'passed' }),
  });

const createContext = (log: string[], failOn: readonly string[] = []) => {
  const context: ExtensionContext = {
    extensionId: 'test',
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    library: {
      readText: async () => '',
      stat: async () => null,
    },
    registerExerciseType: (type): Disposable => {
      log.push(`register ${type}`);
      return {
        dispose: () => {
          log.push(`dispose ${type}`);
          if (failOn.includes(type)) throw new Error(`cannot dispose ${type}`);
        },
      };
    },
    registerGradePolicy: (id): Disposable => {
      log.push(`register policy ${id}`);
      return { dispose: () => void log.push(`dispose policy ${id}`) };
    },
    storage: createMemoryStorage(),
    stats: createMemoryStats(),
    notifications: createMemoryNotifications(),
    secrets: createMemorySecrets(),
    settings: createMemorySettings([]),
    events: {
      on: (name): Disposable => {
        log.push(`subscribe ${name}`);
        return { dispose: () => void log.push(`unsubscribe ${name}`) };
      },
    },
    commands: {
      register: (id): Disposable => {
        log.push(`command ${id}`);
        return { dispose: () => void log.push(`uncommand ${id}`) };
      },
    },
    schedule: {
      on: (id): Disposable => {
        log.push(`schedule ${id}`);
        return { dispose: () => void log.push(`unschedule ${id}`) };
      },
    },
    importers: {
      register: (id): Disposable => {
        log.push(`importer ${id}`);
        return { dispose: () => void log.push(`unimporter ${id}`) };
      },
    },
    exporters: {
      register: (id): Disposable => {
        log.push(`exporter ${id}`);
        return { dispose: () => void log.push(`unexporter ${id}`) };
      },
    },
  };
  return context;
};

describe('defineExtension', () => {
  it('registers all exercise types in declaration order', async () => {
    const log: string[] = [];
    const module = defineExtension({
      exerciseTypes: { 'a.one': handler(), 'a.two': handler() },
    });
    await module.activate(createContext(log));
    expect(log).toEqual(['register a.one', 'register a.two']);
  });

  it('runs the user activate after the registration', async () => {
    const log: string[] = [];
    const module = defineExtension({
      exerciseTypes: { 'a.one': handler() },
      activate: async () => {
        await Promise.resolve();
        log.push('user activate');
      },
    });
    await module.activate(createContext(log));
    expect(log).toEqual(['register a.one', 'user activate']);
  });

  it('deactivates the user code first, then disposes in reverse order', async () => {
    const log: string[] = [];
    const module = defineExtension({
      exerciseTypes: { 'a.one': handler(), 'a.two': handler() },
      deactivate: () => void log.push('user deactivate'),
    });
    await module.activate(createContext(log));
    log.length = 0;
    await module.deactivate?.();
    expect(log).toEqual(['user deactivate', 'dispose a.two', 'dispose a.one']);

    log.length = 0;
    await module.deactivate?.();
    expect(log).toEqual(['user deactivate']);
  });

  it('disposes every registration even when one disposal fails', async () => {
    const log: string[] = [];
    const module = defineExtension({
      exerciseTypes: { 'a.one': handler(), 'a.two': handler() },
    });
    await module.activate(createContext(log, ['a.two']));
    const error = await Promise.resolve(module.deactivate?.()).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(1);
    expect(log.slice(-2)).toEqual(['dispose a.two', 'dispose a.one']);
  });

  it('still disposes registrations when the user deactivate throws', async () => {
    const log: string[] = [];
    const module = defineExtension({
      exerciseTypes: { 'a.one': handler() },
      deactivate: () => {
        throw new Error('boom');
      },
    });
    await module.activate(createContext(log));
    await expect(module.deactivate?.()).rejects.toThrow('boom');
    expect(log).toContain('dispose a.one');
  });

  it('rolls back registered types when activation fails', async () => {
    const log: string[] = [];
    const module = defineExtension({
      exerciseTypes: { 'a.one': handler(), 'a.two': handler() },
      activate: () => {
        throw new Error('activation failed');
      },
    });
    await expect(module.activate(createContext(log))).rejects.toThrow(
      'activation failed',
    );
    expect(log).toEqual([
      'register a.one',
      'register a.two',
      'dispose a.two',
      'dispose a.one',
    ]);
  });

  it('rolls back when a later registration throws', async () => {
    const log: string[] = [];
    const context = createContext(log);
    const register = vi
      .spyOn(context, 'registerExerciseType')
      .mockImplementationOnce(() => ({ dispose: () => void log.push('d1') }))
      .mockImplementationOnce(() => {
        throw new Error('not declared');
      });
    const module = defineExtension({
      exerciseTypes: { 'a.one': handler(), 'a.two': handler() },
    });
    await expect(module.activate(context)).rejects.toThrow('not declared');
    expect(register).toHaveBeenCalledTimes(2);
    expect(log).toEqual(['d1']);
  });

  it('reports both failures when the rollback is incomplete', async () => {
    const log: string[] = [];
    const module = defineExtension({
      exerciseTypes: { 'a.one': handler() },
      activate: () => {
        throw new Error('activation failed');
      },
    });
    const error = await Promise.resolve(
      module.activate(createContext(log, ['a.one'])),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map(String)).toEqual([
      'Error: activation failed',
      'Error: cannot dispose a.one',
    ]);
  });

  it('registers grade policies after exercise types and disposes them first', async () => {
    const log: string[] = [];
    const module = defineExtension({
      exerciseTypes: { 'a.one': handler() },
      gradePolicies: { 'a.generous': () => 5 },
    });
    await module.activate(createContext(log));
    expect(log).toEqual(['register a.one', 'register policy a.generous']);
    log.length = 0;
    await module.deactivate?.();
    expect(log).toEqual(['dispose policy a.generous', 'dispose a.one']);
  });

  it('rolls back grade policies when activation fails', async () => {
    const log: string[] = [];
    const module = defineExtension({
      gradePolicies: { 'a.generous': () => 5 },
      activate: () => {
        throw new Error('activation failed');
      },
    });
    await expect(module.activate(createContext(log))).rejects.toThrow(
      'activation failed',
    );
    expect(log).toEqual([
      'register policy a.generous',
      'dispose policy a.generous',
    ]);
  });
  it('subscribes events after policies and rolls them back with the rest on failure', async () => {
    const log: string[] = [];
    const module = defineExtension({
      gradePolicies: { 'a.generous': () => 5 },
      events: {
        'attempt.closed': () => undefined,
        'session.started': () => undefined,
      },
      activate: () => {
        throw new Error('activation failed');
      },
    });
    await expect(module.activate(createContext(log))).rejects.toThrow(
      'activation failed',
    );
    expect(log).toEqual([
      'register policy a.generous',
      'subscribe attempt.closed',
      'subscribe session.started',
      'unsubscribe session.started',
      'unsubscribe attempt.closed',
      'dispose policy a.generous',
    ]);
  });

  it('unsubscribes events on deactivate', async () => {
    const log: string[] = [];
    const module = defineExtension({
      events: { 'session.finished': () => undefined },
    });
    await module.activate(createContext(log));
    log.length = 0;
    await module.deactivate?.();
    expect(log).toEqual(['unsubscribe session.finished']);
  });

  it('registers commands after events and rolls everything back in reverse when a later one throws', async () => {
    const log: string[] = [];
    const context = createContext(log);
    context.commands.register = (id): Disposable => {
      if (id === 'a.bad') throw new Error('duplicate');
      log.push(`command ${id}`);
      return { dispose: () => void log.push(`uncommand ${id}`) };
    };
    const module = defineExtension({
      gradePolicies: { 'a.generous': () => 5 },
      events: { 'attempt.closed': () => undefined },
      commands: { 'a.one': () => undefined, 'a.bad': () => undefined },
    });
    await expect(module.activate(context)).rejects.toThrow('duplicate');
    expect(log).toEqual([
      'register policy a.generous',
      'subscribe attempt.closed',
      'command a.one',
      'uncommand a.one',
      'unsubscribe attempt.closed',
      'dispose policy a.generous',
    ]);
  });

  it('disposes commands first on deactivate and works without a commands key', async () => {
    const log: string[] = [];
    const module = defineExtension({
      events: { 'session.finished': () => undefined },
      commands: { 'a.one': () => undefined, 'a.two': () => undefined },
    });
    await module.activate(createContext(log));
    log.length = 0;
    await module.deactivate?.();
    expect(log).toEqual([
      'uncommand a.two',
      'uncommand a.one',
      'unsubscribe session.finished',
    ]);

    const plain: string[] = [];
    const without = defineExtension({ exerciseTypes: { 'a.t': handler() } });
    await without.activate(createContext(plain));
    expect(plain).toEqual(['register a.t']);
  });

  it('skips the ids marked inActivate so activate can register them with the context', async () => {
    const log: string[] = [];
    const module = defineExtension({
      exerciseTypes: { 'a.one': inActivate, 'a.two': handler() },
      gradePolicies: { 'a.policy': inActivate },
      events: {
        'attempt.closed': inActivate,
        'session.finished': () => undefined,
      },
      commands: { 'a.cmd': inActivate, 'a.other': () => undefined },
      activate(ctx) {
        ctx.registerExerciseType('a.one', handler());
        ctx.registerGradePolicy('a.policy', () => 4);
        ctx.events.on('attempt.closed', () => undefined);
        ctx.commands.register('a.cmd', () => undefined);
      },
    });
    await module.activate(createContext(log));
    expect(log).toEqual([
      'register a.two',
      'subscribe session.finished',
      'command a.other',
      'register a.one',
      'register policy a.policy',
      'subscribe attempt.closed',
      'command a.cmd',
    ]);
  });

  it('subscribes schedules after commands, skips inActivate ids, and disposes them in reverse on deactivate', async () => {
    const log: string[] = [];
    const module = defineExtension({
      commands: { 'a.cmd': () => undefined },
      schedules: { 'a.morning': () => undefined, 'a.late': inActivate },
      activate(ctx) {
        ctx.schedule.on('a.late', () => undefined);
      },
    });
    await module.activate(createContext(log));
    expect(log).toEqual([
      'command a.cmd',
      'schedule a.morning',
      'schedule a.late',
    ]);
    log.length = 0;
    await module.deactivate?.();
    expect(log).toEqual(['unschedule a.morning', 'uncommand a.cmd']);
  });

  it('registers importers and exporters after commands, disposes them first on deactivate, and rolls back when one throws', async () => {
    const log: string[] = [];
    const module = defineExtension({
      commands: { 'a.cmd': () => undefined },
      importers: { 'a.in': () => ({ files: {} }), 'a.late': inActivate },
      exporters: { 'a.out': () => ({ filename: 'a', text: '' }) },
      activate(ctx) {
        ctx.importers.register('a.late', () => ({ files: {} }));
      },
    });
    await module.activate(createContext(log));
    expect(log).toEqual([
      'command a.cmd',
      'importer a.in',
      'exporter a.out',
      'importer a.late',
    ]);
    log.length = 0;
    await module.deactivate?.();
    expect(log).toEqual([
      'unexporter a.out',
      'unimporter a.in',
      'uncommand a.cmd',
    ]);

    const rollback: string[] = [];
    const context = createContext(rollback);
    context.exporters.register = (id): Disposable => {
      if (id === 'a.bad') throw new Error('duplicate exporter');
      rollback.push(`exporter ${id}`);
      return { dispose: () => void rollback.push(`unexporter ${id}`) };
    };
    const failing = defineExtension({
      importers: { 'a.in': () => ({ files: {} }) },
      exporters: {
        'a.out': () => ({ filename: 'a', text: '' }),
        'a.bad': () => ({ filename: 'a', text: '' }),
      },
    });
    await expect(failing.activate(context)).rejects.toThrow(
      'duplicate exporter',
    );
    expect(rollback).toEqual([
      'importer a.in',
      'exporter a.out',
      'unexporter a.out',
      'unimporter a.in',
    ]);
  });
});
