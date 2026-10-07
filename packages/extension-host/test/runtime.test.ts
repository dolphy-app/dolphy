import { fileURLToPath } from 'node:url';
import { ExerciseTypeError } from '@dolphy-app/engine/ports';
import type { ServerEntry } from '@dolphy-app/extension-api';
import { describe, expect, it, vi } from 'vitest';
import { discoverExtensions } from '../src/discover.ts';
import type { ExtensionCandidate } from '../src/discover.ts';
import {
  createLocalExerciseTypes,
  createLocalExtensionHost,
} from '../src/local.ts';
import { createLogger, nullLibrary } from './helpers.ts';

const fixtures = fileURLToPath(
  new URL('./fixtures/extensions', import.meta.url),
);

const loadFixtures = async (): Promise<ExtensionCandidate[]> =>
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

const echoSchemas = {
  specSchema: { type: 'object' },
  answerSchema: { type: 'string' },
};

/** Хост из фикстур; `server` каждого расширения из `servers` подменяет его `main.mjs`. */
const openHost = async (servers: Record<string, ServerEntry> = {}) => {
  const logger = createLogger();
  const host = await createLocalExtensionHost({
    extensions: await loadFixtures(),
    library: nullLibrary,
    logger,
    modules: Object.fromEntries(
      Object.entries(servers).map(([id, server]) => [id, { server }]),
    ),
  });
  return { host, logger };
};

const echo = { type: 'acme.echo', exerciseId: 'e', spec: {} };

describe('виды заданий (через local)', () => {
  it('server вызывается один раз при создании хоста, до первого запроса, и не повторяется на вызовах', async () => {
    const server = vi.fn<ServerEntry>((s) => {
      s.registerExerciseType({
        id: 'acme.echo',
        ...echoSchemas,
        project: () => 1,
        grade: () => ({ outcome: 'passed' }),
      });
    });
    const { host } = await openHost({ 'acme.echo': server });
    expect(server).toHaveBeenCalledTimes(1);
    await Promise.all([
      host.exerciseTypes.project(echo),
      host.exerciseTypes.project(echo),
    ]);
    await host.exerciseTypes.project(echo);
    expect(server).toHaveBeenCalledTimes(1);
    await host.close();
  });

  it('server бросает: у расширения нет вкладов, вид — unknown-type, причина в журнале', async () => {
    const { host, logger } = await openHost({
      'acme.echo': () => {
        throw new Error('boom');
      },
    });
    const error = await rejection(host.exerciseTypes.project(echo));
    expect(error).toBeInstanceOf(ExerciseTypeError);
    expect(error).toMatchObject({ cause: 'unknown-type' });
    expect(JSON.stringify(logger.warn.mock.calls)).toContain('boom');
    await host.close();
  });

  it('вид с id вне пространства имён расширения: регистрация бросает, а не доходит до хоста', async () => {
    const thrown: unknown[] = [];
    const { host } = await openHost({
      'acme.echo': (s) => {
        try {
          s.registerExerciseType({
            id: 'other.type',
            ...echoSchemas,
            project: () => 1,
            grade: () => ({ outcome: 'passed' }),
          });
        } catch (error) {
          thrown.push(error);
        }
      },
    });
    expect(String(thrown[0])).toContain("exercise type 'other.type'");
    expect(await rejection(host.exerciseTypes.project(echo))).toMatchObject({
      cause: 'unknown-type',
    });
    await host.close();
  });

  it('повторная регистрация того же вида бросает', async () => {
    const thrown: unknown[] = [];
    const { host } = await openHost({
      'acme.echo': (s) => {
        const reg = {
          id: 'acme.echo',
          ...echoSchemas,
          project: () => 1,
          grade: () => ({ outcome: 'passed' as const }),
        };
        s.registerExerciseType(reg);
        try {
          s.registerExerciseType(reg);
        } catch (error) {
          thrown.push(error);
        }
      },
    });
    expect(String(thrown[0])).toContain("duplicate exercise type 'acme.echo'");
    expect(await host.exerciseTypes.project(echo)).toBe(1);
    await host.close();
  });

  it('неизвестный вид → unknown-type', async () => {
    const { host } = await openHost();
    const error = await rejection(
      host.exerciseTypes.project({ type: 'nope', exerciseId: 'e', spec: {} }),
    );
    expect(error).toMatchObject({ cause: 'unknown-type' });
    await host.close();
  });

  it('невалидный результат grade → invalid-result (вердикт error/internal)', async () => {
    const { host } = await openHost({
      'acme.echo': (s) => {
        s.registerExerciseType({
          id: 'acme.echo',
          ...echoSchemas,
          project: () => 1,
          grade: () => ({ outcome: 'maybe' }) as never,
        });
      },
    });
    const verdict = await host.exerciseTypes.grade({
      ...echo,
      answer: 'x',
      timeoutMs: 1000,
      authorMode: true,
    });
    expect(verdict).toMatchObject({ outcome: 'error', reason: 'internal' });
    expect((verdict as { feedback?: string }).feedback).toContain(
      'invalid result',
    );
    await host.close();
  });

  it('исключение обработчика → handler-failed для project, error/internal для grade', async () => {
    const { host } = await openHost({
      'acme.echo': (s) => {
        s.registerExerciseType({
          id: 'acme.echo',
          ...echoSchemas,
          project: () => {
            throw new Error('bad project');
          },
          grade: () => {
            throw new Error('bad grade');
          },
        });
      },
    });
    expect(await rejection(host.exerciseTypes.project(echo))).toMatchObject({
      cause: 'handler-failed',
      message: 'bad project',
    });
    const request = { ...echo, answer: 'x', timeoutMs: 1000 };
    const learner = await host.exerciseTypes.grade({
      ...request,
      authorMode: false,
    });
    expect(learner).toMatchObject({ outcome: 'error', reason: 'internal' });
    expect(learner).not.toHaveProperty('feedback');
    const author = await host.exerciseTypes.grade({
      ...request,
      authorMode: true,
    });
    expect(author).toMatchObject({ feedback: 'bad grade' });
    await host.close();
  });

  it('настоящий import() фикстуры: project/grade/referenceAnswer', async () => {
    const { host } = await openHost();
    const base = { ...echo, spec: { expected: '42' } };
    expect(await host.exerciseTypes.project(base)).toEqual({ hint: 2 });
    expect(await host.exerciseTypes.referenceAnswer(base)).toEqual({
      found: true,
      answer: '42',
    });
    const grade = (answer: string) =>
      host.exerciseTypes.grade({
        ...base,
        answer,
        timeoutMs: 1000,
        authorMode: false,
      });
    expect(await grade('42')).toMatchObject({ outcome: 'passed' });
    expect(await grade('7')).toMatchObject({
      outcome: 'failed',
      reason: 'mismatch',
    });
    await host.close();
  });

  it('referenceAnswer: found=false, если у вида нет эталона', async () => {
    const { host } = await openHost();
    expect(
      await host.exerciseTypes.referenceAnswer({
        type: 'acme.crash',
        exerciseId: 'e',
        spec: {},
      }),
    ).toEqual({ found: false });
    await host.close();
  });

  it('close() вызывает очистку, которую вернул server, ровно один раз', async () => {
    const cleanup = vi.fn();
    const types = await createLocalExerciseTypes({
      extensions: await loadFixtures(),
      library: nullLibrary,
      logger: createLogger(),
      modules: {
        'acme.echo': {
          server: (s) => {
            s.registerExerciseType({
              id: 'acme.echo',
              ...echoSchemas,
              project: () => 1,
              grade: () => ({ outcome: 'passed' }),
            });
            return cleanup;
          },
        },
      },
    });
    expect(cleanup).not.toHaveBeenCalled();
    await types.close();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('правила оценки (через local)', () => {
  const input = {
    verdicts: [
      {
        outcome: 'passed' as const,
        attemptId: 'a',
        attemptsUsed: 1,
        durationMs: 1,
      },
    ],
    gaveUp: false,
  };

  it('list отдаёт зарегистрированные правила; вычисление идёт в настоящий main.mjs', async () => {
    const { host } = await openHost();
    expect(host.gradePolicies.list().map(({ id }) => id)).toEqual(
      expect.arrayContaining(['acme.policy.generous', 'acme.mixed.strict']),
    );
    expect(
      await host.gradePolicies.evaluate('acme.policy.generous', input),
    ).toBe(5);
    expect(
      await host.gradePolicies.evaluate('acme.policy.generous', {
        verdicts: [],
        gaveUp: true,
      }),
    ).toBe(1);
    expect(
      await host.gradePolicies.evaluate('acme.policy.generous', {
        verdicts: [],
        gaveUp: false,
      }),
    ).toBeNull();
    await host.close();
  });

  it('неверный результат, исключение и неизвестное правило → типизированные отказы', async () => {
    const { host } = await openHost();
    const cause = async (id: string) =>
      ((await rejection(host.gradePolicies.evaluate(id, input))) as Error)
        .cause;
    expect(await cause('acme.policy.broken')).toBe('invalid-result');
    expect(await cause('acme.policy.throws')).toBe('handler-failed');
    expect(await cause('acme.nothing')).toBe('unknown-policy');
    await host.close();
  });

  it('server бросает: правил у расширения нет', async () => {
    const { host } = await openHost({
      'acme.policy': (s) => {
        s.registerGradePolicy({
          id: 'acme.policy.generous',
          label: 'Generous',
          evaluate: () => 5,
        });
        throw new Error('late failure');
      },
    });
    expect(host.gradePolicies.list().map(({ id }) => id)).not.toContain(
      'acme.policy.generous',
    );
    expect(
      (
        (await rejection(
          host.gradePolicies.evaluate('acme.policy.generous', input),
        )) as Error
      ).cause,
    ).toBe('unknown-policy');
    await host.close();
  });

  it('виды заданий и правила одного расширения регистрирует один вызов server', async () => {
    const server = vi.fn<ServerEntry>((s) => {
      s.registerExerciseType({
        id: 'acme.mixed',
        ...echoSchemas,
        project: () => 1,
        grade: () => ({ outcome: 'passed' }),
      });
      s.registerGradePolicy({
        id: 'acme.mixed.strict',
        label: 'Strict',
        evaluate: () => 2,
      });
    });
    const { host } = await openHost({ 'acme.mixed': server });
    await host.exerciseTypes.project({
      type: 'acme.mixed',
      exerciseId: 'e',
      spec: {},
    });
    expect(await host.gradePolicies.evaluate('acme.mixed.strict', input)).toBe(
      2,
    );
    expect(server).toHaveBeenCalledTimes(1);
    await host.close();
  });
});
