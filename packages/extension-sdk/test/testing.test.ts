import { describe, expect, it } from 'vitest';
import {
  defineExtension,
  type ExtensionLogger,
  type ExtensionModule,
} from '../src/index.ts';
import {
  createMemoryLibrary,
  createSchemaValidator,
  loadExerciseType,
} from '../src/testing.ts';

interface EchoSpec {
  expected: string;
}

const echoModule = defineExtension({
  exerciseTypes: {
    'acme.echo': {
      project: ({ exerciseId }) => ({ exerciseId }),
      grade: ({ spec, answer, timeoutMs, authorMode, exerciseId }) =>
        answer === (spec as EchoSpec).expected
          ? { outcome: 'passed', data: { timeoutMs, authorMode, exerciseId } }
          : { outcome: 'failed', reason: 'mismatch' },
      referenceAnswer: ({ spec }) => (spec as EchoSpec).expected,
    },
    'acme.plain': {
      project: () => null,
      grade: () => ({ outcome: 'passed' }),
    },
  },
});

const moduleWithGrade = (result: unknown): ExtensionModule =>
  defineExtension({
    exerciseTypes: {
      'acme.bad': {
        project: () => null,
        grade: () => result as never,
      },
    },
  });

describe('loadExerciseType', () => {
  it('projects, grades and returns the reference answer', async () => {
    const echo = await loadExerciseType(echoModule, 'acme.echo');
    const spec = { expected: '42' };
    await expect(echo.project(spec, { exerciseId: 'x' })).resolves.toEqual({
      exerciseId: 'x',
    });
    await expect(echo.grade({ spec, answer: '1' })).resolves.toEqual({
      outcome: 'failed',
      reason: 'mismatch',
    });
    await expect(echo.referenceAnswer(spec)).resolves.toEqual({
      found: true,
      answer: '42',
    });
  });

  it('applies defaults and honours overrides', async () => {
    const echo = await loadExerciseType(echoModule, 'acme.echo');
    const spec = { expected: 'a' };
    await expect(echo.grade({ spec, answer: 'a' })).resolves.toEqual({
      outcome: 'passed',
      data: {
        timeoutMs: 2000,
        authorMode: false,
        exerciseId: 'test::lesson::exercise',
      },
    });
    await expect(
      echo.grade({
        spec,
        answer: 'a',
        timeoutMs: 5,
        authorMode: true,
        exerciseId: 'e',
      }),
    ).resolves.toMatchObject({
      data: { timeoutMs: 5, authorMode: true, exerciseId: 'e' },
    });
  });

  it('reports found: false when the handler has no reference answer', async () => {
    const plain = await loadExerciseType(echoModule, 'acme.plain');
    await expect(plain.referenceAnswer({})).resolves.toEqual({ found: false });
  });

  it('fails when the type was not registered', async () => {
    await expect(loadExerciseType(echoModule, 'acme.none')).rejects.toThrow(
      "exercise type 'acme.none' was not registered",
    );
  });

  it('passes the library and logger to the extension', async () => {
    const messages: string[] = [];
    const logger: ExtensionLogger = {
      debug: () => undefined,
      info: (_fields, message) => void messages.push(message ?? ''),
      warn: () => undefined,
      error: () => undefined,
    };
    const module = defineExtension({
      exerciseTypes: {
        'acme.lib': {
          project: () => null,
          grade: () => ({ outcome: 'passed' }),
          referenceAnswer: async () => 'ref',
        },
      },
      activate: async (context) => {
        context.logger.info({}, 'activated');
        expect(context.extensionId).toBe('test');
        await expect(context.library.readText('a.txt')).resolves.toBe('A');
      },
    });
    await loadExerciseType(module, 'acme.lib', {
      library: createMemoryLibrary({ 'a.txt': 'A' }),
      logger,
    });
    expect(messages).toEqual(['activated']);
  });

  it.each([
    ['not an object', 'passed', 'result must be an object'],
    ['unknown outcome', { outcome: 'maybe' }, 'unknown outcome "maybe"'],
    ['failed without reason', { outcome: 'failed' }, "'reason'"],
    ['empty reason', { outcome: 'error', reason: '' }, "'reason'"],
    [
      'long reason',
      { outcome: 'failed', reason: 'r'.repeat(101) },
      'longer than 100',
    ],
    [
      'long feedback',
      { outcome: 'passed', feedback: 'f'.repeat(4001) },
      "'feedback' is longer than 4000",
    ],
    [
      'long detail',
      { outcome: 'failed', reason: 'x', detail: 'd'.repeat(4001) },
      "'detail' is longer than 4000",
    ],
    [
      'unknown key',
      { outcome: 'passed', reason: 'x' },
      "unexpected key 'reason'",
    ],
  ])('rejects an invalid grade result: %s', async (_name, result, message) => {
    const loaded = await loadExerciseType(moduleWithGrade(result), 'acme.bad');
    await expect(loaded.grade({ spec: {}, answer: 1 })).rejects.toThrow(
      message,
    );
  });

  it('accepts valid results of every outcome', async () => {
    const results = [
      { outcome: 'passed', feedback: 'ok', data: [1] },
      { outcome: 'failed', reason: 'r', detail: 'd', data: null },
      { outcome: 'error', reason: 'r', feedback: 'f' },
    ];
    for (const result of results) {
      const loaded = await loadExerciseType(
        moduleWithGrade(result),
        'acme.bad',
      );
      await expect(loaded.grade({ spec: {}, answer: 1 })).resolves.toEqual(
        result,
      );
    }
  });

  it('dispose deactivates the module', async () => {
    const calls: string[] = [];
    const module = defineExtension({
      exerciseTypes: {
        'acme.d': { project: () => null, grade: () => ({ outcome: 'passed' }) },
      },
      deactivate: () => void calls.push('deactivate'),
    });
    const loaded = await loadExerciseType(module, 'acme.d');
    await loaded.dispose();
    expect(calls).toEqual(['deactivate']);
  });
});

describe('createMemoryLibrary', () => {
  const library = createMemoryLibrary({ 'a/b.txt': 'héllo' });

  it('reads and stats existing files', async () => {
    await expect(library.readText('a/b.txt')).resolves.toBe('héllo');
    await expect(library.stat('a/b.txt')).resolves.toEqual({
      kind: 'file',
      bytes: 6,
      mtimeMs: 0,
    });
  });

  it('rejects reading and returns null for missing files', async () => {
    await expect(library.readText('nope')).rejects.toThrow('ENOENT: nope');
    await expect(library.stat('nope')).resolves.toBeNull();
  });
});

describe('createSchemaValidator', () => {
  const validate = createSchemaValidator({
    type: 'object',
    required: ['expected'],
    additionalProperties: false,
    properties: { expected: { type: 'string', minLength: 1 } },
  });

  it('returns no messages for a valid value', () => {
    expect(validate({ expected: '42' })).toEqual([]);
  });

  it('formats messages as `<path> <message>`', () => {
    expect(validate({ expected: '' })).toEqual([
      '/expected must NOT have fewer than 1 characters',
    ]);
    expect(validate('x')).toEqual(['/ must be object']);
  });

  it('returns at most 6 messages', () => {
    const many = createSchemaValidator({
      type: 'array',
      items: { type: 'string' },
    });
    const messages = many(Array.from({ length: 20 }, (_, i) => i));
    expect(messages).toHaveLength(6);
    expect(messages[0]).toBe('/0 must be string');
  });
});
