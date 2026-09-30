import { describe, expect, it, vi } from 'vitest';
import {
  defineExerciseType,
  defineExtension,
  type Disposable,
  type ExerciseTypeHandler,
  type ExtensionContext,
} from '../src/index.ts';

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
});
