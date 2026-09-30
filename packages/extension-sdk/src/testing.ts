import type {
  ExerciseTypeHandler,
  ExtensionContext,
  ExtensionLogger,
  ExtensionModule,
  GradePolicyHandler,
  GradePolicyInput,
  GradeResult,
  GradeValue,
  JsonSchema,
  LibraryReader,
} from '@lms/extension-api';
import { Ajv2020 } from 'ajv/dist/2020.js';

const MAX_MESSAGES = 6;
const MAX_REASON_CHARS = 100;
const MAX_TEXT_CHARS = 4000;
const DEFAULT_EXERCISE_ID = 'test::lesson::exercise';
const DEFAULT_TIMEOUT_MS = 2000;

const silentLogger: ExtensionLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export const createMemoryLibrary = (
  files: Readonly<Record<string, string>>,
): LibraryReader => {
  const entries = new Map(Object.entries(files));
  return {
    readText: async (path) => {
      const text = entries.get(path);
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    stat: async (path) => {
      const text = entries.get(path);
      if (text === undefined) return null;
      return { kind: 'file', bytes: Buffer.byteLength(text), mtimeMs: 0 };
    },
  };
};

export const createSchemaValidator = (schema: JsonSchema) => {
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    schema,
  );
  return (value: unknown): string[] => {
    if (validate(value)) return [];
    const errors = validate.errors ?? [];
    return errors
      .slice(0, MAX_MESSAGES)
      .map((error) => `${error.instancePath || '/'} ${error.message}`);
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const OUTCOME_KEYS = {
  passed: ['outcome', 'feedback', 'data'],
  failed: ['outcome', 'reason', 'feedback', 'detail', 'data'],
  error: ['outcome', 'reason', 'feedback', 'data'],
} as const;

const textProblem = (result: Record<string, unknown>, key: string) => {
  const value = result[key];
  if (value === undefined) return null;
  if (typeof value !== 'string') return `'${key}' must be a string`;
  if (value.length > MAX_TEXT_CHARS) {
    return `'${key}' is longer than ${MAX_TEXT_CHARS} characters`;
  }
  return null;
};

const reasonProblem = (result: Record<string, unknown>) => {
  const { reason } = result;
  if (typeof reason !== 'string' || reason.length === 0) {
    return `'reason' must be a non-empty string`;
  }
  if (reason.length > MAX_REASON_CHARS) {
    return `'reason' is longer than ${MAX_REASON_CHARS} characters`;
  }
  return null;
};

const findGradeResultProblem = (result: unknown): string | null => {
  if (!isRecord(result)) return 'result must be an object';
  const { outcome } = result;
  if (outcome !== 'passed' && outcome !== 'failed' && outcome !== 'error') {
    return `unknown outcome ${JSON.stringify(outcome)}`;
  }
  const allowed: readonly string[] = OUTCOME_KEYS[outcome];
  const extra = Object.keys(result).find((key) => !allowed.includes(key));
  if (extra !== undefined) return `unexpected key '${extra}'`;
  const reason = outcome === 'passed' ? null : reasonProblem(result);
  return (
    reason ?? textProblem(result, 'feedback') ?? textProblem(result, 'detail')
  );
};

export interface LoadedExerciseType {
  project(spec: unknown, options?: { exerciseId?: string }): Promise<unknown>;
  grade(input: {
    spec: unknown;
    answer: unknown;
    exerciseId?: string;
    timeoutMs?: number;
    authorMode?: boolean;
  }): Promise<GradeResult>;
  referenceAnswer(
    spec: unknown,
    options?: { exerciseId?: string },
  ): Promise<{ found: true; answer: unknown } | { found: false }>;
  /** Деактивирует модуль расширения. */
  dispose(): Promise<void>;
}

export const loadExerciseType = async (
  module: ExtensionModule,
  type: string,
  options: { library?: LibraryReader; logger?: ExtensionLogger } = {},
): Promise<LoadedExerciseType> => {
  const handlers = new Map<string, ExerciseTypeHandler>();
  const context: ExtensionContext = {
    extensionId: 'test',
    logger: options.logger ?? silentLogger,
    library: options.library ?? createMemoryLibrary({}),
    registerExerciseType: (registeredType, handler) => {
      handlers.set(registeredType, handler);
      return { dispose: () => void handlers.delete(registeredType) };
    },
    registerGradePolicy: () => ({ dispose: () => undefined }),
  };
  await module.activate(context);
  const handler = handlers.get(type);
  if (handler === undefined) {
    throw new Error(`exercise type '${type}' was not registered`);
  }

  return {
    project: async (spec, { exerciseId = DEFAULT_EXERCISE_ID } = {}) =>
      handler.project({ exerciseId, spec }),
    grade: async ({
      spec,
      answer,
      exerciseId = DEFAULT_EXERCISE_ID,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      authorMode = false,
    }) => {
      const result = await handler.grade({
        exerciseId,
        spec,
        answer,
        timeoutMs,
        authorMode,
      });
      const problem = findGradeResultProblem(result);
      if (problem !== null) {
        throw new Error(`invalid grade result: ${problem}`);
      }
      return result;
    },
    referenceAnswer: async (
      spec,
      { exerciseId = DEFAULT_EXERCISE_ID } = {},
    ) => {
      const answer = await handler.referenceAnswer?.({ exerciseId, spec });
      return answer === undefined ? { found: false } : { found: true, answer };
    },
    dispose: async () => {
      await module.deactivate?.();
    },
  };
};

export interface LoadedGradePolicy {
  evaluate(input: GradePolicyInput): Promise<GradeValue | null>;
  /** Деактивирует модуль расширения. */
  dispose(): Promise<void>;
}

const isGradeValue = (value: unknown): value is GradeValue =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5;

export const loadGradePolicy = async (
  module: ExtensionModule,
  id: string,
  options: { library?: LibraryReader; logger?: ExtensionLogger } = {},
): Promise<LoadedGradePolicy> => {
  const handlers = new Map<string, GradePolicyHandler>();
  const context: ExtensionContext = {
    extensionId: 'test',
    logger: options.logger ?? silentLogger,
    library: options.library ?? createMemoryLibrary({}),
    registerExerciseType: () => ({ dispose: () => undefined }),
    registerGradePolicy: (registeredId, handler) => {
      handlers.set(registeredId, handler);
      return { dispose: () => void handlers.delete(registeredId) };
    },
  };
  await module.activate(context);
  const handler = handlers.get(id);
  if (handler === undefined) {
    throw new Error(`grade policy '${id}' was not registered`);
  }
  return {
    evaluate: async (input) => {
      const result = await handler(input);
      if (result !== null && !isGradeValue(result)) {
        throw new Error(
          `invalid grade policy result: ${JSON.stringify(result)} is not an integer 1..5 or null`,
        );
      }
      return result;
    },
    dispose: async () => {
      await module.deactivate?.();
    },
  };
};
