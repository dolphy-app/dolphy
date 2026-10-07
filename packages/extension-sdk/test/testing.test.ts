import { describe, expect, it } from 'vitest';
import {
  defineExerciseType,
  defineServer,
  type ExtensionLogger,
  type ServerContext,
} from '../src/index.ts';
import {
  createMemoryLibrary,
  createSchemaValidator,
  createTestServer,
} from '../src/testing.ts';

interface EchoSpec {
  expected: string;
}

const SCHEMA = { type: 'object' };

const echo = defineExerciseType<EchoSpec, string, { exerciseId: string }>({
  id: 'acme.echo',
  specSchema: SCHEMA,
  answerSchema: SCHEMA,
  project: ({ exerciseId }) => ({ exerciseId }),
  grade: ({ spec, answer, timeoutMs, authorMode, exerciseId }) =>
    answer === spec.expected
      ? { outcome: 'passed', data: { timeoutMs, authorMode, exerciseId } }
      : { outcome: 'failed', reason: 'mismatch' },
  referenceAnswer: ({ spec }) => spec.expected,
});

const serverWith = (register: (server: ServerContext) => void) =>
  createTestServer(defineServer(register));

const gradingAs = (result: unknown) =>
  serverWith((s) => {
    s.registerExerciseType({
      id: 'acme.bad',
      specSchema: SCHEMA,
      answerSchema: SCHEMA,
      project: () => null,
      grade: () => result as never,
    });
  });

describe('createTestServer: exercise types', () => {
  it('projects, grades and returns the reference answer', async () => {
    const server = await serverWith((s) => {
      s.registerExerciseType(echo);
    });
    const type = server.exerciseType('acme.echo');

    await expect(type.project({ expected: 'x' })).resolves.toEqual({
      exerciseId: 'test::lesson::exercise',
    });
    await expect(
      type.grade({ spec: { expected: 'x' }, answer: 'x' }),
    ).resolves.toEqual({
      outcome: 'passed',
      data: {
        timeoutMs: 2000,
        authorMode: false,
        exerciseId: 'test::lesson::exercise',
      },
    });
    await expect(
      type.grade({ spec: { expected: 'x' }, answer: 'y' }),
    ).resolves.toEqual({ outcome: 'failed', reason: 'mismatch' });
    await expect(type.referenceAnswer({ expected: 'x' })).resolves.toEqual({
      found: true,
      answer: 'x',
    });
  });

  it('honours the overrides of exercise id, timeout and author mode', async () => {
    const server = await serverWith((s) => {
      s.registerExerciseType(echo);
    });
    const type = server.exerciseType('acme.echo');

    await expect(
      type.project({ expected: 'x' }, { exerciseId: 'c::l::e' }),
    ).resolves.toEqual({ exerciseId: 'c::l::e' });
    await expect(
      type.grade({
        spec: { expected: 'x' },
        answer: 'x',
        exerciseId: 'c::l::e',
        timeoutMs: 50,
        authorMode: true,
      }),
    ).resolves.toEqual({
      outcome: 'passed',
      data: { timeoutMs: 50, authorMode: true, exerciseId: 'c::l::e' },
    });
  });

  it('reports found: false when the handler has no reference answer', async () => {
    const server = await serverWith((s) => {
      s.registerExerciseType({
        id: 'acme.plain',
        specSchema: SCHEMA,
        answerSchema: SCHEMA,
        project: () => null,
        grade: () => ({ outcome: 'passed' }),
      });
    });
    await expect(
      server.exerciseType('acme.plain').referenceAnswer({ expected: 'x' }),
    ).resolves.toEqual({ found: false });
  });

  it('fails for a type the entry did not register', async () => {
    const server = await serverWith((s) => {
      s.registerExerciseType(echo);
    });
    expect(() => server.exerciseType('acme.none')).toThrow(
      "exercise type 'acme.none' was not registered",
    );
  });

  it('passes the library and logger to the entry', async () => {
    const lines: unknown[] = [];
    const logger: ExtensionLogger = {
      debug: () => undefined,
      info: (fields) => void lines.push(fields),
      warn: () => undefined,
      error: () => undefined,
    };
    const server = await createTestServer(
      defineServer((s) => {
        s.registerExerciseType({
          ...echo,
          id: 'acme.lib',
          project: async () => {
            s.logger.info({ at: 'project' });
            return s.library.readText('a.txt');
          },
        });
      }),
      { library: createMemoryLibrary({ 'a.txt': 'from library' }), logger },
    );
    await expect(
      server.exerciseType('acme.lib').project({ expected: '' }),
    ).resolves.toBe('from library');
    expect(lines).toEqual([{ at: 'project' }]);
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
    const server = await gradingAs(result);
    await expect(
      server.exerciseType('acme.bad').grade({ spec: {}, answer: 1 }),
    ).rejects.toThrow(message);
  });

  it('accepts valid results of every outcome', async () => {
    const results = [
      { outcome: 'passed', feedback: 'ok', data: [1] },
      { outcome: 'failed', reason: 'r', detail: 'd', data: null },
      { outcome: 'error', reason: 'r', feedback: 'f' },
    ];
    for (const result of results) {
      const server = await gradingAs(result);
      await expect(
        server.exerciseType('acme.bad').grade({ spec: {}, answer: 1 }),
      ).resolves.toEqual(result);
    }
  });
});

describe('createTestServer: grade policies', () => {
  const policy = (value: unknown) =>
    serverWith((s) => {
      s.registerGradePolicy({
        id: 'acme.policy',
        label: 'Policy',
        evaluate: () => value as never,
      });
    });

  it.each([1, 3, 5, null])('passes %s through', async (value) => {
    const server = await policy(value);
    await expect(
      server
        .gradePolicy('acme.policy')
        .evaluate({ verdicts: [], gaveUp: false }),
    ).resolves.toBe(value);
  });

  it.each([0, 6, 2.5, '3', undefined])('rejects %s', async (value) => {
    const server = await policy(value);
    await expect(
      server
        .gradePolicy('acme.policy')
        .evaluate({ verdicts: [], gaveUp: false }),
    ).rejects.toThrow('invalid grade policy result');
  });

  it('fails for a policy the entry did not register', async () => {
    const server = await policy(5);
    expect(() => server.gradePolicy('acme.other')).toThrow(
      "grade policy 'acme.other' was not registered",
    );
  });
});

describe('createTestServer: registration', () => {
  it('snapshots what the entry registered, with the defaults applied', async () => {
    const server = await serverWith((s) => {
      s.registerExerciseType({ ...echo, title: { en: 'Echo', ru: 'Эхо' } });
      s.registerGradePolicy({
        id: 'acme.policy',
        label: 'Policy',
        evaluate: () => 3,
      });
      s.registerCommand({ id: 'acme.go', title: 'Go', run: () => undefined });
      s.schedule(
        { id: 'acme.daily', every: 'daily', at: '08:30' },
        () => undefined,
      );
      s.schedule({ id: 'acme.hourly', every: 'hourly' }, () => undefined);
      s.registerImporter({
        id: 'acme.csv',
        title: 'CSV',
        accept: ['.csv'],
        input: 'text',
        run: () => ({ files: {} }),
      });
      s.registerExporter({
        id: 'acme.out',
        title: 'Out',
        scope: 'progress',
        run: () => ({ filename: 'a.txt', text: '' }),
      });
      s.on('session.started', () => undefined);
    });

    expect(server.registration).toEqual({
      exerciseTypes: [
        {
          id: 'acme.echo',
          title: { en: 'Echo', ru: 'Эхо' },
          specSchema: SCHEMA,
          answerSchema: SCHEMA,
        },
      ],
      gradePolicies: [{ id: 'acme.policy', label: 'Policy' }],
      settings: [],
      events: ['session.started'],
      commands: [
        {
          id: 'acme.go',
          title: 'Go',
          description: null,
          category: null,
          palette: true,
          icon: 'puzzle',
          keybindings: [],
          when: null,
        },
      ],
      schedules: [
        { id: 'acme.daily', every: 'daily', at: '08:30' },
        { id: 'acme.hourly', every: 'hourly', at: null },
      ],
      importers: [
        { id: 'acme.csv', title: 'CSV', accept: ['.csv'], input: 'text' },
      ],
      exporters: [{ id: 'acme.out', title: 'Out', scope: 'progress' }],
    });
  });

  it('refuses an id registered twice, in any kind', async () => {
    await expect(
      serverWith((s) => {
        s.registerExerciseType(echo);
        s.registerExerciseType(echo);
      }),
    ).rejects.toThrow("exercise type 'acme.echo' is already registered");
    await expect(
      serverWith((s) => {
        s.registerCommand({ id: 'a.x', title: 'X', run: () => undefined });
        s.registerCommand({ id: 'a.x', title: 'X', run: () => undefined });
      }),
    ).rejects.toThrow("command 'a.x' is already registered");
    await expect(
      serverWith((s) => {
        s.on('attempt.closed', () => undefined);
        s.on('attempt.closed', () => undefined);
      }),
    ).rejects.toThrow("event 'attempt.closed' is already subscribed");
  });

  it('checks the id prefix once extensionId is given', async () => {
    await expect(
      createTestServer(
        defineServer((s) => {
          s.registerCommand({
            id: 'other.x',
            title: 'X',
            run: () => undefined,
          });
        }),
        { extensionId: 'acme' },
      ),
    ).rejects.toThrow(
      "command id 'other.x' must be 'acme' or start with 'acme.'",
    );
    await expect(
      createTestServer(
        defineServer((s) => {
          s.registerCommand({ id: 'acme', title: 'X', run: () => undefined });
          s.registerCommand({ id: 'acme.y', title: 'Y', run: () => undefined });
        }),
        { extensionId: 'acme' },
      ),
    ).resolves.toBeDefined();
  });

  it('a registration the entry disposed is not in the snapshot', async () => {
    const server = await serverWith((s) => {
      s.registerCommand({
        id: 'a.x',
        title: 'X',
        run: () => undefined,
      }).dispose();
    });
    expect(server.registration.commands).toEqual([]);
  });

  it('fails when the entry throws', async () => {
    await expect(
      serverWith(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('dispose runs the cleanup the entry returned, a function or a Disposable', async () => {
    const calls: string[] = [];
    const first = await createTestServer(() => () => void calls.push('fn'));
    const second = await createTestServer(() => ({
      dispose: () => void calls.push('disposable'),
    }));
    await first.dispose();
    await second.dispose();
    expect(calls).toEqual(['fn', 'disposable']);
  });

  it('after dispose the registrations are gone', async () => {
    const server = await serverWith((s) => {
      s.registerCommand({ id: 'a.x', title: 'X', run: () => undefined });
    });
    await server.dispose();
    await expect(server.commands.run('a.x')).rejects.toThrow(/not registered/);
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
