/**
 * Ядро проверки `dolphy.js`: код ученика и тесты автора исполняются в чистом
 * контексте `node:vm`. Выполняется в дочернем процессе (`worker.ts`), который
 * родитель убивает по дедлайну: `vm` не прерывает синхронный цикл внутри
 * обработчика, вызванного из хоста, и бесконечные цепочки микрозадач.
 *
 * Глобальные имена контекста — только язык, `console` (перехват в `logs`),
 * таймеры и `queueMicrotask`. `test`, `assert`, `logs`, `sleep` передаются
 * параметрами обёртки над `tests`, поэтому ученик их не видит и не затирает
 * своими `function test() {}`.
 */
import assert from 'node:assert/strict';
import { format } from 'node:util';
import vm from 'node:vm';

export interface RunRequest {
  code: string;
  tests: string;
  timeoutMs: number;
  maxOutputChars: number;
}

export type RunStatus =
  | 'passed'
  | 'tests_failed'
  | 'syntax_error'
  | 'runtime_error'
  | 'timeout'
  | 'output_limit'
  /** Ошибка автора: `tests` не компилируются или не регистрируют проверок. */
  | 'tests_invalid';

export interface TestFailure {
  name: string;
  message: string;
}

export interface RunResult {
  status: RunStatus;
  passed: number;
  total: number;
  failures: TestFailure[];
  /** Сообщение об ошибке для `syntax_error`, `runtime_error`, `tests_invalid`. */
  message?: string;
  /** Стек ошибки или полный текст сообщений (для режима автора). */
  detail?: string;
}

interface TestEntry {
  name: string;
  fn: () => unknown;
}

const MAX_MESSAGE_CHARS = 600;

const clip = (text: string): string =>
  text.length > MAX_MESSAGE_CHARS
    ? `${text.slice(0, MAX_MESSAGE_CHARS)}…`
    : text;

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null
    ? Reflect.get(value, key)
    : undefined;

/** Ошибка из любого realm в виде `Name: message` (без `instanceof`). */
const describeError = (error: unknown): { text: string; stack: string } => {
  if (typeof error === 'object' && error !== null) {
    const name = field(error, 'name');
    const message = field(error, 'message');
    const stack = field(error, 'stack');
    const label = typeof name === 'string' ? name : 'Error';
    const body = typeof message === 'string' ? message : '';
    return {
      text: clip(body === '' ? label : `${label}: ${body}`),
      stack: typeof stack === 'string' ? stack : '',
    };
  }
  const text = clip(`Uncaught ${format('%s', error)}`);
  return { text, stack: text };
};

const isTimeout = (error: unknown): boolean =>
  field(error, 'code') === 'ERR_SCRIPT_EXECUTION_TIMEOUT';

const failure = (
  status: RunStatus,
  message: string,
  detail?: string,
  passed = 0,
  total = 0,
  failures: TestFailure[] = [],
): RunResult => ({
  status,
  passed,
  total,
  failures,
  message,
  ...(detail === undefined || detail === '' ? {} : { detail }),
});

/** Ожидание `promise` не дольше `ms`; `undefined` — вышло время. */
const withDeadline = async <T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), Math.max(ms, 1));
  });
  try {
    return await Promise.race([
      promise.then((value) => ({ timedOut: false as const, value })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const execute = async (
  request: RunRequest,
  faults: unknown[],
): Promise<RunResult> => {
  const { code, tests, timeoutMs, maxOutputChars } = request;
  const startedAt = Date.now();
  const remaining = () => Math.max(timeoutMs - (Date.now() - startedAt), 1);

  let outputChars = 0;
  let outputExceeded = false;
  // `logs` создаётся в контексте ниже: `assert.deepEqual(logs, ['a'])`
  // сравнивает прототипы массивов
  let logs: string[] = [];
  const write = (...args: unknown[]) => {
    const line = format(...args);
    outputChars += line.length + 1;
    if (outputChars > maxOutputChars) {
      outputExceeded = true;
      return;
    }
    logs.push(line);
  };
  const consoleStub = {
    log: write,
    info: write,
    warn: write,
    error: write,
    debug: write,
  };

  const context = vm.createContext(
    {
      console: consoleStub,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      queueMicrotask,
    },
    { codeGeneration: { strings: true, wasm: false } },
  );
  logs = vm.runInContext('[]', context) as string[];

  let learnerScript: vm.Script;
  try {
    learnerScript = new vm.Script(code, { filename: 'solution.js' });
  } catch (error) {
    const { text, stack } = describeError(error);
    return failure('syntax_error', text, stack);
  }
  try {
    learnerScript.runInContext(context, { timeout: remaining() });
  } catch (error) {
    if (isTimeout(error)) {
      return failure('timeout', 'The code did not finish in time.');
    }
    const { text, stack } = describeError(error);
    return failure('runtime_error', text, stack);
  }

  const entries: TestEntry[] = [];
  const registerTest = (name: unknown, fn: unknown) => {
    if (typeof name !== 'string' || name === '' || typeof fn !== 'function') {
      throw new TypeError('test(name, fn) expects a name and a function');
    }
    entries.push({ name, fn: fn as () => unknown });
  };
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  let wrapper: vm.Script;
  try {
    wrapper = new vm.Script(
      `(function (test, assert, logs, sleep) {${'\n'}${tests}\n})`,
      { filename: 'tests.js', lineOffset: -1 },
    );
  } catch (error) {
    const { text, stack } = describeError(error);
    return failure('tests_invalid', text, stack);
  }
  try {
    const run = wrapper.runInContext(context, { timeout: remaining() });
    (run as (...args: unknown[]) => void)(registerTest, assert, logs, sleep);
  } catch (error) {
    if (isTimeout(error)) {
      return failure('timeout', 'The code did not finish in time.');
    }
    // `tests` падают сами на верхнем уровне: на эталоне это ошибка автора,
    // на ответе ученика — его недостающее определение
    const { text, stack } = describeError(error);
    return failure('runtime_error', text, stack);
  }
  if (entries.length === 0) {
    return failure('tests_invalid', 'tests registered no test() calls');
  }

  const invoke = new vm.Script('__test()', { filename: 'invoke.js' });
  const failures: TestFailure[] = [];
  let passed = 0;
  const stop = (status: RunStatus, message: string): RunResult =>
    failure(status, message, undefined, passed, entries.length, failures);
  const outputLimit = () =>
    stop('output_limit', `Output is longer than ${maxOutputChars} characters.`);
  const outOfTime = () => stop('timeout', 'The code did not finish in time.');
  let firstStack = '';
  const faulted = (): RunResult | null => {
    if (faults.length === 0) return null;
    const { text, stack } = describeError(faults[0]);
    return failure(
      'runtime_error',
      `Uncaught ${text}`,
      stack,
      passed,
      entries.length,
      failures,
    );
  };

  for (const entry of entries) {
    const fault = faulted();
    if (fault !== null) return fault;
    try {
      Reflect.set(context, '__test', entry.fn);
      const pending = invoke.runInContext(context, { timeout: remaining() });
      const settled = await withDeadline(Promise.resolve(pending), remaining());
      if (settled.timedOut) return outOfTime();
      if (outputExceeded) return outputLimit();
      passed += 1;
    } catch (error) {
      if (isTimeout(error)) return outOfTime();
      if (outputExceeded) return outputLimit();
      const { text, stack } = describeError(error);
      if (failures.length === 0) firstStack = stack;
      failures.push({ name: entry.name, message: text });
    } finally {
      Reflect.deleteProperty(context, '__test');
    }
  }
  // необработанные отказы и ошибки таймеров всплывают после микрозадач
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  const lateFault = faulted();
  if (lateFault !== null) return lateFault;

  const first = failures[0];
  if (first === undefined) {
    return { status: 'passed', passed, total: entries.length, failures };
  }
  return {
    status: 'tests_failed',
    passed,
    total: entries.length,
    failures,
    message: `${first.name}: ${first.message}`,
    ...(firstStack === '' ? {} : { detail: firstStack }),
  };
};

/**
 * Исключение из таймера или отказ без обработчика в коде ученика не должны
 * ронять процесс проверки: это ошибка ученика (`runtime_error`).
 */
export const runChecks = async (request: RunRequest): Promise<RunResult> => {
  const faults: unknown[] = [];
  const onFault = (error: unknown) => {
    faults.push(error);
  };
  process.on('uncaughtException', onFault);
  process.on('unhandledRejection', onFault);
  try {
    return await execute(request, faults);
  } finally {
    process.off('uncaughtException', onFault);
    process.off('unhandledRejection', onFault);
  }
};
