import { fileURLToPath } from 'node:url';
import { ExerciseTypeError } from '@lms/engine/ports';
import type { ExtensionModule } from '@lms/extension-api';
import { describe, expect, it, vi } from 'vitest';
import { discoverExtensions } from '../src/discover.ts';
import type { ResolvedExtension } from '../src/discover.ts';
import { createLocalExerciseTypes } from '../src/local.ts';
import { createLogger, nullLibrary } from './helpers.ts';

const fixtures = fileURLToPath(
  new URL('./fixtures/extensions', import.meta.url),
);

const loadFixtures = async (): Promise<ResolvedExtension[]> =>
  (
    await discoverExtensions({
      roots: [{ dir: fixtures, origin: 'bundled' }],
      logger: createLogger(),
    })
  ).extensions;

const rejection = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (error: unknown) => error,
  );

describe('createExtensionRuntime (через local)', () => {
  it('без запросов расширение не активируется, при нескольких — ровно один раз', async () => {
    const extensions = await loadFixtures();
    const activate = vi.fn(
      (ctx: Parameters<ExtensionModule['activate']>[0]) => {
        ctx.registerExerciseType('acme.echo', {
          project: () => 1,
          grade: () => ({ outcome: 'passed' }),
        });
      },
    );
    const types = createLocalExerciseTypes({
      extensions,
      library: nullLibrary,
      logger: createLogger(),
      modules: { 'acme.echo': { activate } },
    });
    expect(activate).not.toHaveBeenCalled();
    const request = { type: 'acme.echo', exerciseId: 'e', spec: {} };
    await Promise.all([types.project(request), types.project(request)]);
    await types.project(request);
    expect(activate).toHaveBeenCalledTimes(1);
    await types.close();
  });

  it('отказ активации запоминается и не повторяется', async () => {
    const extensions = await loadFixtures();
    const activate = vi.fn(() => {
      throw new Error('boom');
    });
    const types = createLocalExerciseTypes({
      extensions,
      library: nullLibrary,
      logger: createLogger(),
      modules: { 'acme.echo': { activate } },
    });
    const request = { type: 'acme.echo', exerciseId: 'e', spec: {} };
    for (let i = 0; i < 2; i++) {
      const error = await rejection(types.project(request));
      expect(error).toBeInstanceOf(ExerciseTypeError);
      expect(error).toMatchObject({
        cause: 'activation-failed',
        message: 'boom',
      });
    }
    expect(activate).toHaveBeenCalledTimes(1);
    await types.close();
  });

  it('registerExerciseType с необъявленным видом бросает', async () => {
    const extensions = await loadFixtures();
    const thrown: unknown[] = [];
    const types = createLocalExerciseTypes({
      extensions,
      library: nullLibrary,
      logger: createLogger(),
      modules: {
        'acme.echo': {
          activate(ctx) {
            try {
              ctx.registerExerciseType('acme.echo.other', {
                project: () => 1,
                grade: () => ({ outcome: 'passed' }),
              });
            } catch (error) {
              thrown.push(error);
            }
          },
        },
      },
    });
    const error = await rejection(
      types.project({ type: 'acme.echo', exerciseId: 'e', spec: {} }),
    );
    expect(String(thrown[0])).toContain('not declared');
    // активация прошла, но заявленный вид не зарегистрирован
    expect(error).toMatchObject({ cause: 'activation-failed' });
    await types.close();
  });

  it('вид, не зарегистрированный после активации → activation-failed', async () => {
    const extensions = await loadFixtures();
    const types = createLocalExerciseTypes({
      extensions,
      library: nullLibrary,
      logger: createLogger(),
      modules: { 'acme.echo': { activate() {} } },
    });
    const error = await rejection(
      types.project({ type: 'acme.echo', exerciseId: 'e', spec: {} }),
    );
    expect(error).toMatchObject({ cause: 'activation-failed' });
    await types.close();
  });

  it('неизвестный вид → unknown-type', async () => {
    const types = createLocalExerciseTypes({
      extensions: await loadFixtures(),
      library: nullLibrary,
      logger: createLogger(),
    });
    const error = await rejection(
      types.project({ type: 'nope', exerciseId: 'e', spec: {} }),
    );
    expect(error).toMatchObject({ cause: 'unknown-type' });
    await types.close();
  });

  it('невалидный результат grade → invalid-result (вердикт error/internal)', async () => {
    const extensions = await loadFixtures();
    const types = createLocalExerciseTypes({
      extensions,
      library: nullLibrary,
      logger: createLogger(),
      modules: {
        'acme.echo': {
          activate(ctx) {
            ctx.registerExerciseType('acme.echo', {
              project: () => 1,
              grade: () => ({ outcome: 'maybe' }) as never,
            });
          },
        },
      },
    });
    const verdict = await types.grade({
      type: 'acme.echo',
      exerciseId: 'e',
      spec: {},
      answer: 'x',
      timeoutMs: 1000,
      authorMode: true,
    });
    expect(verdict).toMatchObject({ outcome: 'error', reason: 'internal' });
    expect((verdict as { feedback?: string }).feedback).toContain(
      'invalid result',
    );
    await types.close();
  });

  it('исключение обработчика → handler-failed для project, error/internal для grade', async () => {
    const extensions = await loadFixtures();
    const types = createLocalExerciseTypes({
      extensions,
      library: nullLibrary,
      logger: createLogger(),
      modules: {
        'acme.echo': {
          activate(ctx) {
            ctx.registerExerciseType('acme.echo', {
              project: () => {
                throw new Error('bad project');
              },
              grade: () => {
                throw new Error('bad grade');
              },
            });
          },
        },
      },
    });
    const error = await rejection(
      types.project({ type: 'acme.echo', exerciseId: 'e', spec: {} }),
    );
    expect(error).toMatchObject({
      cause: 'handler-failed',
      message: 'bad project',
    });
    const request = {
      type: 'acme.echo',
      exerciseId: 'e',
      spec: {},
      answer: 'x',
      timeoutMs: 1000,
    };
    const learner = await types.grade({ ...request, authorMode: false });
    expect(learner).toMatchObject({ outcome: 'error', reason: 'internal' });
    expect(learner).not.toHaveProperty('feedback');
    const author = await types.grade({ ...request, authorMode: true });
    expect(author).toMatchObject({ feedback: 'bad grade' });
    await types.close();
  });

  it('настоящий import() фикстуры: project/grade/referenceAnswer', async () => {
    const types = createLocalExerciseTypes({
      extensions: await loadFixtures(),
      library: nullLibrary,
      logger: createLogger(),
    });
    const base = {
      type: 'acme.echo',
      exerciseId: 'e',
      spec: { expected: '42' },
    };
    expect(await types.project(base)).toEqual({ hint: 2 });
    expect(await types.referenceAnswer(base)).toEqual({
      found: true,
      answer: '42',
    });
    const grade = (answer: string) =>
      types.grade({ ...base, answer, timeoutMs: 1000, authorMode: false });
    expect(await grade('42')).toMatchObject({ outcome: 'passed' });
    expect(await grade('7')).toMatchObject({
      outcome: 'failed',
      reason: 'mismatch',
    });
    await types.close();
  });

  it('referenceAnswer: found=false, если у вида нет эталона', async () => {
    const types = createLocalExerciseTypes({
      extensions: await loadFixtures(),
      library: nullLibrary,
      logger: createLogger(),
    });
    expect(
      await types.referenceAnswer({
        type: 'acme.crash',
        exerciseId: 'e',
        spec: {},
      }),
    ).toEqual({ found: false });
    await types.close();
  });

  it('close() вызывает deactivate у активированных модулей', async () => {
    const deactivate = vi.fn();
    const types = createLocalExerciseTypes({
      extensions: await loadFixtures(),
      library: nullLibrary,
      logger: createLogger(),
      modules: {
        'acme.echo': {
          activate(ctx) {
            ctx.registerExerciseType('acme.echo', {
              project: () => 1,
              grade: () => ({ outcome: 'passed' }),
            });
          },
          deactivate,
        },
      },
    });
    await types.close();
    expect(deactivate).not.toHaveBeenCalled();
    const second = createLocalExerciseTypes({
      extensions: await loadFixtures(),
      library: nullLibrary,
      logger: createLogger(),
      modules: {
        'acme.echo': {
          activate(ctx) {
            ctx.registerExerciseType('acme.echo', {
              project: () => 1,
              grade: () => ({ outcome: 'passed' }),
            });
          },
          deactivate,
        },
      },
    });
    await second.project({ type: 'acme.echo', exerciseId: 'e', spec: {} });
    await second.close();
    expect(deactivate).toHaveBeenCalledTimes(1);
  });
});
