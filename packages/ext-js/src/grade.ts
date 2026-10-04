/** Проверка `dolphy.js`: валидация `spec`/ответа и перевод итога раннера в `GradeResult`. */
import type { GradeResult } from '@dolphy-app/extension-sdk';
import type { ChildRunner, RunOutcome } from './child-runner.ts';
import type { RunRequest, RunResult } from './run-checks.ts';

export interface JsSpec {
  tests?: unknown;
  reference?: unknown;
  starter?: unknown;
  maxOutputChars?: unknown;
}

export interface JsView {
  starter: string;
}

export interface GradeInput {
  spec: JsSpec;
  answer: unknown;
  timeoutMs: number;
  authorMode: boolean;
}

export const MAX_ANSWER_CHARS = 20_000;
export const DEFAULT_TIMEOUT_MS = 2000;
export const DEFAULT_MAX_OUTPUT_CHARS = 10_000;
const MAX_FEEDBACK_CHARS = 3900;

const clip = (text: string): string =>
  text.length > MAX_FEEDBACK_CHARS
    ? `${text.slice(0, MAX_FEEDBACK_CHARS)}…`
    : text;

export const project = (spec: JsSpec): JsView => ({
  starter: typeof spec.starter === 'string' ? spec.starter : '',
});

const errorResult = (
  reason: string,
  message: string,
  authorMode: boolean,
): GradeResult => ({
  outcome: 'error',
  reason,
  ...(authorMode ? { feedback: clip(message) } : {}),
});

const specProblem = (spec: JsSpec): string | null => {
  const { tests, reference, starter, maxOutputChars } = spec;
  if (typeof tests !== 'string' || tests.trim() === '') {
    return 'spec.tests must be a non-empty string';
  }
  if (reference !== undefined && typeof reference !== 'string') {
    return 'spec.reference must be a string';
  }
  if (starter !== undefined && typeof starter !== 'string') {
    return 'spec.starter must be a string';
  }
  if (
    maxOutputChars !== undefined &&
    !(Number.isInteger(maxOutputChars) && (maxOutputChars as number) > 0)
  ) {
    return 'spec.maxOutputChars must be a positive integer';
  }
  return null;
};

const effectiveTimeout = (timeoutMs: number): number =>
  Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;

const stripAssertionPrefix = (message: string): string =>
  message.startsWith('AssertionError: ')
    ? message.slice('AssertionError: '.length)
    : message;

const fromRun = (
  run: RunResult,
  timeoutMs: number,
  maxOutputChars: number,
  authorMode: boolean,
): GradeResult => {
  const counts = { passed: run.passed, total: run.total };
  const failed = (reason: string, feedback: string): GradeResult => ({
    outcome: 'failed',
    reason,
    feedback: clip(feedback),
    ...(run.total > 0 ? { data: counts } : {}),
    ...(authorMode && run.detail !== undefined
      ? { detail: clip(run.detail) }
      : {}),
  });
  const message = run.message ?? '';
  switch (run.status) {
    case 'passed':
      return { outcome: 'passed', data: counts };
    case 'tests_failed': {
      const first = run.failures[0];
      const head = `Passed ${run.passed} of ${run.total} tests.`;
      return failed(
        'tests_failed',
        first === undefined
          ? head
          : `${head} First failure — ${first.name}: ${stripAssertionPrefix(first.message)}`,
      );
    }
    case 'syntax_error':
      return failed('syntax_error', `Syntax error: ${message}`);
    case 'runtime_error':
      return failed('runtime_error', `Runtime error: ${message}`);
    case 'timeout':
      return failed(
        'timeout',
        `The code did not finish within ${timeoutMs} ms.`,
      );
    case 'output_limit':
      return failed(
        'output_limit',
        `The code printed more than ${maxOutputChars} characters.`,
      );
    // `tests_invalid` и любой неизвестный итог — ошибка автора, не ученика
    case 'tests_invalid':
    default:
      return errorResult(
        'tests_invalid',
        [message, authorMode ? run.detail : undefined]
          .filter((part) => part !== undefined && part !== '')
          .join('\n'),
        authorMode,
      );
  }
};

const fromOutcome = (
  outcome: RunOutcome,
  timeoutMs: number,
  maxOutputChars: number,
  authorMode: boolean,
): GradeResult => {
  if (outcome.kind === 'result') {
    return fromRun(outcome.result, timeoutMs, maxOutputChars, authorMode);
  }
  if (outcome.kind === 'timeout') {
    return {
      outcome: 'failed',
      reason: 'timeout',
      feedback: `The code did not finish within ${timeoutMs} ms.`,
    };
  }
  return errorResult(
    outcome.reason,
    `The check process failed: ${outcome.reason}`,
    authorMode,
  );
};

export const grade = async (
  runner: ChildRunner,
  { spec, answer, timeoutMs, authorMode }: GradeInput,
): Promise<GradeResult> => {
  const problem = specProblem(spec);
  if (problem !== null) return errorResult('spec_invalid', problem, authorMode);
  if (typeof answer !== 'string') {
    return errorResult('invalid_answer', 'answer is not a string', authorMode);
  }
  if (answer.length > MAX_ANSWER_CHARS) {
    return {
      outcome: 'failed',
      reason: 'too_long',
      feedback: `The code is longer than ${MAX_ANSWER_CHARS} characters.`,
    };
  }
  const limits = {
    timeoutMs: effectiveTimeout(timeoutMs),
    maxOutputChars:
      typeof spec.maxOutputChars === 'number'
        ? spec.maxOutputChars
        : DEFAULT_MAX_OUTPUT_CHARS,
  };
  const request: RunRequest = {
    code: answer,
    tests: spec.tests as string,
    ...limits,
  };
  const outcome = await runner.run(request);
  return fromOutcome(
    outcome,
    limits.timeoutMs,
    limits.maxOutputChars,
    authorMode,
  );
};
