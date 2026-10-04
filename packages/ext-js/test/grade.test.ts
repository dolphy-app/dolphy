import { loadExerciseType } from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { host } from '../src/index.ts';
import { childPids } from './helpers.ts';

const disposables: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

const load = async () => {
  const type = await loadExerciseType(host, 'dolphy.js');
  disposables.push(type);
  return type;
};

const tests = `
test('adds', () => assert.equal(add(1, 2), 3));
test('adds negatives', () => assert.equal(add(-1, -2), -3));
test('adds async', async () => {
  await sleep(1);
  assert.equal(add(2, 2), 4);
});
`;
const spec = { tests };
const good = 'function add(a, b) { return a + b; }';
const SHORT = 600;

describe('dolphy.js: project и referenceAnswer', () => {
  it('project отдаёт только starter и не раскрывает tests и reference', async () => {
    const type = await load();
    const view = await type.project({
      tests: 'SECRET_TESTS',
      reference: 'SECRET_REFERENCE',
      starter: 'function add() {}',
      maxOutputChars: 10,
    });
    expect(view).toEqual({ starter: 'function add() {}' });
    expect(JSON.stringify(view)).not.toContain('SECRET');
  });

  it('project без starter даёт пустую заготовку', async () => {
    const type = await load();
    expect(await type.project({ tests })).toEqual({ starter: '' });
  });

  it('referenceAnswer отдаёт непустой reference', async () => {
    const type = await load();
    expect(await type.referenceAnswer({ tests, reference: good })).toEqual({
      found: true,
      answer: good,
    });
  });

  it.each([[{ tests }], [{ tests, reference: '' }]])(
    'referenceAnswer: эталона нет для %j',
    async (value) => {
      const type = await load();
      expect(await type.referenceAnswer(value)).toEqual({ found: false });
    },
  );
});

describe('dolphy.js: итоги проверки', () => {
  it('passed: все тесты прошли', async () => {
    const type = await load();
    expect(await type.grade({ spec, answer: good })).toEqual({
      outcome: 'passed',
      data: { passed: 3, total: 3 },
    });
  });

  it('tests_failed: прошло N из M и первый упавший тест', async () => {
    const type = await load();
    const result = await type.grade({
      spec,
      answer: 'function add(a, b) { return a > 0 ? a + b : 0; }',
    });
    expect(result).toMatchObject({
      outcome: 'failed',
      reason: 'tests_failed',
      data: { passed: 2, total: 3 },
    });
    if (result.outcome !== 'failed') throw new Error('failure expected');
    expect(result.feedback).toMatch(
      /^Passed 2 of 3 tests\. First failure — adds negatives: /,
    );
    expect(result.feedback).not.toContain('AssertionError: ');
    expect(result).not.toHaveProperty('detail');
  });

  it('tests_failed: свой текст assert сохраняется', async () => {
    const type = await load();
    const result = await type.grade({
      spec: { tests: "test('t', () => assert.ok(false, 'must be truthy'))" },
      answer: '',
    });
    expect(result).toMatchObject({
      outcome: 'failed',
      reason: 'tests_failed',
      feedback: 'Passed 0 of 1 tests. First failure — t: must be truthy',
    });
  });

  it('tests_failed: logs ученика доступны тестам', async () => {
    const type = await load();
    const result = await type.grade({
      spec: {
        tests: "test('logs', () => assert.deepEqual(logs, ['hi', '2']))",
      },
      answer: "console.log('hi'); console.log(1 + 1);",
    });
    expect(result.outcome).toBe('passed');
  });

  it('syntax_error', async () => {
    const type = await load();
    const result = await type.grade({ spec, answer: 'function add( {' });
    expect(result).toMatchObject({ outcome: 'failed', reason: 'syntax_error' });
    expect(result).toHaveProperty(
      'feedback',
      expect.stringContaining('SyntaxError'),
    );
  });

  it('runtime_error в коде ученика', async () => {
    const type = await load();
    const result = await type.grade({
      spec,
      answer: "throw new TypeError('boom');",
    });
    expect(result).toMatchObject({
      outcome: 'failed',
      reason: 'runtime_error',
      feedback: 'Runtime error: TypeError: boom',
    });
  });

  it('ошибка из таймера и отказ без обработчика — вина ученика, не сбой процесса', async () => {
    const type = await load();
    const waiting = { tests: 'test("wait", () => sleep(40));' };
    const timer = await type.grade({
      spec: waiting,
      answer: "setTimeout(() => { throw new Error('late'); }, 5);",
    });
    expect(timer).toMatchObject({ outcome: 'failed', reason: 'runtime_error' });
    const rejection = await type.grade({
      spec: waiting,
      answer: "Promise.reject(new Error('nope'));",
    });
    expect(rejection).toMatchObject({
      outcome: 'failed',
      reason: 'runtime_error',
    });
  });

  it('runtime_error: функции нет — тесты падают на верхнем уровне', async () => {
    const type = await load();
    const result = await type.grade({
      spec: { tests: 'add(1, 2);\ntest("x", () => {});' },
      answer: '',
    });
    expect(result).toMatchObject({
      outcome: 'failed',
      reason: 'runtime_error',
    });
  });

  it('output_limit: вывода больше maxOutputChars', async () => {
    const type = await load();
    const result = await type.grade({
      spec: { tests, maxOutputChars: 50 },
      answer: "console.log('x'.repeat(100));",
    });
    expect(result).toMatchObject({ outcome: 'failed', reason: 'output_limit' });
  });

  it('timeout: while (true) {} в коде ученика', async () => {
    const type = await load();
    const result = await type.grade({
      spec,
      answer: 'while (true) {}',
      timeoutMs: SHORT,
    });
    expect(result).toMatchObject({ outcome: 'failed', reason: 'timeout' });
    expect(childPids()).toEqual([]);
  });

  it('timeout: while (true) {} внутри теста', async () => {
    const type = await load();
    const result = await type.grade({
      spec: { tests: "test('spin', () => { while (true) {} })" },
      answer: '',
      timeoutMs: SHORT,
    });
    expect(result).toMatchObject({ outcome: 'failed', reason: 'timeout' });
  });

  it('timeout: никогда не завершающийся промис в тесте', async () => {
    const type = await load();
    const result = await type.grade({
      spec: { tests: "test('hang', () => new Promise(() => {}))" },
      answer: '',
      timeoutMs: SHORT,
    });
    expect(result).toMatchObject({
      outcome: 'failed',
      reason: 'timeout',
      feedback: `The code did not finish within ${SHORT} ms.`,
    });
    expect(childPids()).toEqual([]);
  });

  it('timeout: цикл в колбэке таймера убивается родителем', async () => {
    const type = await load();
    const result = await type.grade({
      spec,
      answer: 'setTimeout(() => { while (true) {} }, 0);',
      timeoutMs: SHORT,
    });
    expect(result).toMatchObject({ outcome: 'failed', reason: 'timeout' });
    expect(childPids()).toEqual([]);
  });

  it.each([0, -5, Number.NaN])(
    'некорректный timeoutMs %s заменяется значением по умолчанию',
    async (timeoutMs) => {
      const type = await load();
      expect(await type.grade({ spec, answer: good, timeoutMs })).toMatchObject(
        {
          outcome: 'passed',
        },
      );
    },
  );

  it('ответ длиннее 20000 символов: failed/too_long без запуска', async () => {
    const type = await load();
    const result = await type.grade({ spec, answer: 'x'.repeat(20_001) });
    expect(result).toMatchObject({ outcome: 'failed', reason: 'too_long' });
    expect(
      await type.grade({ spec, answer: `//${'x'.repeat(19_900)}\n${good}` }),
    ).toMatchObject({ outcome: 'passed' });
  });

  it('ответ не строка — ошибка, а не провал ученика', async () => {
    const type = await load();
    expect(await type.grade({ spec, answer: 42 })).toEqual({
      outcome: 'error',
      reason: 'invalid_answer',
    });
  });
});

describe('dolphy.js: ошибки автора', () => {
  it('tests не регистрируют проверок — error/tests_invalid', async () => {
    const type = await load();
    expect(
      await type.grade({ spec: { tests: '// nothing' }, answer: good }),
    ).toEqual({ outcome: 'error', reason: 'tests_invalid' });
  });

  it('tests не компилируются — error/tests_invalid', async () => {
    const type = await load();
    expect(
      await type.grade({ spec: { tests: 'test(' }, answer: good }),
    ).toMatchObject({ outcome: 'error', reason: 'tests_invalid' });
  });

  it.each([
    ['пустой tests', { tests: '   ' }],
    ['tests не строка', { tests: 1 }],
    ['reference не строка', { tests, reference: 1 }],
    ['starter не строка', { tests, starter: 1 }],
    ['maxOutputChars дробный', { tests, maxOutputChars: 1.5 }],
  ])('некорректный spec: %s — error/spec_invalid', async (_name, value) => {
    const type = await load();
    expect(await type.grade({ spec: value, answer: good })).toEqual({
      outcome: 'error',
      reason: 'spec_invalid',
    });
  });

  it('режим автора добавляет текст к ошибкам', async () => {
    const type = await load();
    const invalid = await type.grade({
      spec: { tests: '// nothing' },
      answer: good,
      authorMode: true,
    });
    expect(invalid).toEqual({
      outcome: 'error',
      reason: 'tests_invalid',
      feedback: 'tests registered no test() calls',
    });
    const spec_ = await type.grade({
      spec: { tests: '' },
      answer: good,
      authorMode: true,
    });
    expect(spec_).toMatchObject({
      outcome: 'error',
      reason: 'spec_invalid',
      feedback: 'spec.tests must be a non-empty string',
    });
  });

  it('режим автора добавляет стек к failed; ученику стек не отдаётся', async () => {
    const type = await load();
    const input = { spec, answer: "throw new Error('boom');" };
    const learner = await type.grade(input);
    const author = await type.grade({ ...input, authorMode: true });
    expect(learner).not.toHaveProperty('detail');
    expect(author).toMatchObject({
      outcome: 'failed',
      reason: 'runtime_error',
      detail: expect.stringContaining('solution.js'),
    });
  });
});

describe('dolphy.js: изоляция дочернего процесса', () => {
  const escape = (body: string) => `
    try {
      const proc = console.log.constructor('return process')();
      ${body}
    } catch (error) {
      console.log(error.code);
    }`;
  const denied = {
    tests:
      "test('denied', () => assert.deepEqual(logs, ['ERR_ACCESS_DENIED']))",
  };

  it('чтение файлов вне каталога воркера запрещено', async () => {
    const type = await load();
    const answer = escape(
      "proc.getBuiltinModule('fs').readFileSync('/etc/hosts'); console.log('read');",
    );
    expect(await type.grade({ spec: denied, answer })).toMatchObject({
      outcome: 'passed',
    });
  });

  it('порождение процессов запрещено', async () => {
    const type = await load();
    const answer = escape(
      "proc.getBuiltinModule('child_process').execSync('echo hi'); console.log('spawned');",
    );
    expect(await type.grade({ spec: denied, answer })).toMatchObject({
      outcome: 'passed',
    });
  });

  it('запись файлов запрещена', async () => {
    const type = await load();
    const answer = escape(
      "proc.getBuiltinModule('fs').writeFileSync('/tmp/ext-js-denied', 'x'); console.log('wrote');",
    );
    expect(await type.grade({ spec: denied, answer })).toMatchObject({
      outcome: 'passed',
    });
  });
});

describe('dolphy.js: очередь процессов', () => {
  it('больше четырёх параллельных проверок завершаются все', async () => {
    const type = await load();
    const slow = {
      tests:
        "test('slow', async () => { await sleep(250); assert.equal(add(1, 1), 2); })",
    };
    const startedAt = Date.now();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        type.grade({ spec: slow, answer: good }),
      ),
    );
    expect(results.map((result) => result.outcome)).toEqual(
      Array(10).fill('passed'),
    );
    // не больше четырёх одновременно: 10 проверок по 250 мс — минимум 3 волны
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(700);
    expect(childPids()).toEqual([]);
  });

  it('deactivate убивает живые процессы, ответ — error', async () => {
    const type = await load();
    const pending = type.grade({
      spec,
      answer: 'while (true) {}',
      timeoutMs: 30_000,
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 300);
    });
    expect(childPids().length).toBeGreaterThan(0);
    await type.dispose();
    expect(await pending).toEqual({ outcome: 'error', reason: 'stopped' });
    expect(childPids()).toEqual([]);
  });
});
