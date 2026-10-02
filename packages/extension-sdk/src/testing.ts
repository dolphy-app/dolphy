import {
  EXTENSION_COMMAND_LIMITS,
  EXTENSION_STORAGE_LIMITS,
  InvalidCommandResultError,
  PermissionError,
  StorageQuotaError,
  normalizeCommandResult,
} from '@dolphy-app/extension-api';
import type {
  CommandHandler,
  CommandOutcome,
  Disposable,
  ExerciseTypeHandler,
  ExtensionContext,
  ExtensionEvents,
  ExtensionCommands,
  ExtensionLogger,
  ExtensionModule,
  ExtensionSettings,
  ExtensionStorage,
  GradePolicyHandler,
  GradePolicyInput,
  GradeResult,
  GradeValue,
  JsonSchema,
  JsonValue,
  LearningEventHandler,
  LearningEventName,
  LearningEventPayloads,
  LibraryReader,
  SettingChange,
  SettingContribution,
  SettingValue,
} from '@dolphy-app/extension-api';
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

/** UTF-8 порядок байтов совпадает с порядком кодовых точек — так движок сортирует ключи. */
const compareKeys = (a: string, b: string): number =>
  Buffer.compare(Buffer.from(a), Buffer.from(b));

/**
 * Хранилище в памяти с теми же потолками и теми же ошибками, что у движка
 * (`EXTENSION_STORAGE_LIMITS`, `StorageQuotaError`): значения хранятся как
 * JSON-текст и отдаются копиями, при отказе ничего не меняется.
 */
export const createMemoryStorage = (): ExtensionStorage => {
  const limits = EXTENSION_STORAGE_LIMITS;
  const entries = new Map<string, string>();
  const totalBytes = (): number => {
    let total = 0;
    for (const text of entries.values()) total += Buffer.byteLength(text);
    return total;
  };
  return {
    get: async <T extends JsonValue = JsonValue>(key: string) => {
      const text = entries.get(key);
      return text === undefined ? undefined : (JSON.parse(text) as T);
    },
    set: async (key, value) => {
      if (typeof key !== 'string' || key.length === 0) {
        throw new Error('storage key must be a non-empty string');
      }
      const text = JSON.stringify(value) as string | undefined;
      if (text === undefined) throw new Error('storage value must be JSON');
      const bytes = Buffer.byteLength(text);
      if (key.length > limits.keyLength) {
        throw new StorageQuotaError('key-length', limits.keyLength);
      }
      if (bytes > limits.valueBytes) {
        throw new StorageQuotaError('value-size', limits.valueBytes);
      }
      const existing = entries.get(key);
      if (existing === undefined && entries.size >= limits.keys) {
        throw new StorageQuotaError('key-count', limits.keys);
      }
      const total =
        totalBytes() -
        (existing === undefined ? 0 : Buffer.byteLength(existing)) +
        bytes;
      if (total > limits.totalBytes) {
        throw new StorageQuotaError('total-size', limits.totalBytes);
      }
      entries.set(key, text);
    },
    delete: async (key) => entries.delete(key),
    keys: async () => [...entries.keys()].sort(compareKeys),
  };
};

/** Почему значение не подходит определению настройки; `null` — подходит. */
const findSettingProblem = (
  definition: SettingContribution,
  value: unknown,
): string | null => {
  switch (definition.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be a boolean';
    case 'string':
      if (typeof value !== 'string') return 'must be a string';
      return definition.maxLength !== undefined &&
        value.length > definition.maxLength
        ? `is longer than ${definition.maxLength} characters`
        : null;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 'must be a finite number';
      }
      if (definition.integer === true && !Number.isInteger(value)) {
        return 'must be an integer';
      }
      if (definition.min !== undefined && value < definition.min) {
        return `is less than ${definition.min}`;
      }
      return definition.max !== undefined && value > definition.max
        ? `is greater than ${definition.max}`
        : null;
    default:
      return typeof value === 'string' &&
        definition.options.some((option) => option.value === value)
        ? null
        : 'must be one of the options';
  }
};

export interface MemorySettings extends ExtensionSettings {
  /**
   * Меняет значение, как это делает пользователь в окне: значение проверяется
   * по определению, подписчики `onDidChange` вызываются, если оно изменилось.
   * В отличие от хоста, сбой обработчика не проглатывается, а отклоняет промис.
   */
  set(id: string, value: SettingValue): Promise<void>;
}

/** Настройки в памяти по определениям из манифеста; `initial` — значения пользователя вместо `default`. */
export const createMemorySettings = (
  definitions: readonly SettingContribution[],
  initial: Readonly<Record<string, SettingValue>> = {},
): MemorySettings => {
  const byId = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const values = new Map<string, SettingValue>(
    definitions.map((definition) => [definition.id, definition.default]),
  );
  const handlers = new Set<(change: SettingChange) => void>();
  const known = (id: string): SettingContribution => {
    const definition = byId.get(id);
    if (definition === undefined) {
      throw new Error(`setting '${id}' is not declared in the manifest`);
    }
    return definition;
  };
  const checked = (id: string, value: unknown): SettingValue => {
    const problem = findSettingProblem(known(id), value);
    if (problem !== null) throw new Error(`setting '${id}' ${problem}`);
    return value as SettingValue;
  };
  for (const [id, value] of Object.entries(initial)) {
    values.set(id, checked(id, value));
  }
  return {
    get: <T extends SettingValue = SettingValue>(id: string): T => {
      known(id);
      return values.get(id) as T;
    },
    onDidChange(handler) {
      handlers.add(handler);
      return { dispose: () => void handlers.delete(handler) };
    },
    async set(id, value) {
      const next = checked(id, value);
      if (Object.is(values.get(id), next)) return;
      values.set(id, next);
      for (const handler of [...handlers]) await handler({ id, value: next });
    },
  };
};

export interface MemoryEvents extends ExtensionEvents {
  /**
   * Отправляет событие подписанному обработчику и ждёт его. Нет подписки —
   * событие пропускается, как в хосте. В отличие от хоста, сбой обработчика
   * не проглатывается, а отклоняет промис, и 2 с на обработчик не отсчитываются.
   */
  emit<N extends LearningEventName>(
    name: N,
    payload: LearningEventPayloads[N],
  ): Promise<void>;
}

export interface MemoryEventsOptions {
  /** События из `contributes.events`: подписка на другое бросает, как в хосте. Не задано — можно любые. */
  declared?: readonly LearningEventName[];
  /** false — подписка бросает `PermissionError`, как у расширения без `learning.events`. По умолчанию true. */
  permitted?: boolean;
}

/** Подписки на события обучения в памяти: по одному обработчику на событие, как в хосте. */
export const createMemoryEvents = (
  options: MemoryEventsOptions = {},
): MemoryEvents => {
  const handlers = new Map<
    LearningEventName,
    (payload: never) => void | Promise<void>
  >();
  return {
    on<N extends LearningEventName>(
      name: N,
      handler: LearningEventHandler<N>,
    ): Disposable {
      if (options.permitted === false) {
        throw new PermissionError('learning.events');
      }
      if (options.declared !== undefined && !options.declared.includes(name)) {
        throw new Error(`event '${name}' is not declared in the manifest`);
      }
      if (handlers.has(name)) {
        throw new Error(`event '${name}' is already subscribed`);
      }
      handlers.set(name, handler);
      return {
        dispose: () => {
          if (handlers.get(name) === handler) handlers.delete(name);
        },
      };
    },
    async emit(name, payload) {
      await handlers.get(name)?.(payload as never);
    },
  };
};

export interface MemoryCommands extends ExtensionCommands {
  /**
   * Выполняет зарегистрированную команду так, как её выполняет хост: те же
   * границы аргументов и результата, то же приведение результата. Незарегистрированная
   * команда и недопустимый результат отклоняют промис. 10 с на обработчик не отсчитываются.
   */
  run(id: string, args?: JsonValue): Promise<CommandOutcome>;
  /** Зарегистрированные команды в порядке регистрации. */
  ids(): string[];
}

export interface MemoryCommandsOptions {
  /** Команды из `contributes.commands`: регистрация другой бросает, как в хосте. Не задано — можно любые. */
  declaredCommands?: readonly string[];
  /** Панели из `contributes.panels`: `openPanel` на другую недопустим, как в хосте. Не задано — любая. */
  declaredPanels?: readonly string[];
}

/** Команды в памяти: те же правила регистрации и тот же разбор результата, что у хоста. */
export const createMemoryCommands = (
  options: MemoryCommandsOptions = {},
): MemoryCommands => {
  const handlers = new Map<string, CommandHandler>();
  return {
    register(id, handler) {
      if (
        options.declaredCommands !== undefined &&
        !options.declaredCommands.includes(id)
      ) {
        throw new Error(`command '${id}' is not declared in the manifest`);
      }
      if (handlers.has(id)) {
        throw new Error(`command '${id}' is already registered`);
      }
      handlers.set(id, handler);
      return {
        dispose: () => {
          if (handlers.get(id) === handler) handlers.delete(id);
        },
      };
    },
    async run(id, args) {
      const handler = handlers.get(id);
      if (handler === undefined) {
        throw new Error(`command '${id}' was not registered`);
      }
      if (
        (JSON.stringify(args)?.length ?? 0) > EXTENSION_COMMAND_LIMITS.argsChars
      ) {
        throw new Error(
          `args are longer than ${EXTENSION_COMMAND_LIMITS.argsChars} characters`,
        );
      }
      const result = await handler(args);
      try {
        return normalizeCommandResult(result, options.declaredPanels);
      } catch (error) {
        if (error instanceof InvalidCommandResultError) {
          throw new Error(`invalid command result: ${error.message}`);
        }
        throw error;
      }
    },
    ids: () => [...handlers.keys()],
  };
};

/** Что подменяет тест в контексте расширения; по умолчанию всё в памяти и без вывода. */
export interface LoadOptions {
  library?: LibraryReader;
  logger?: ExtensionLogger;
  storage?: ExtensionStorage;
  settings?: ExtensionSettings;
  events?: ExtensionEvents;
  commands?: ExtensionCommands;
}

const contextOf = (
  options: LoadOptions,
  registrars: Pick<
    ExtensionContext,
    'registerExerciseType' | 'registerGradePolicy'
  >,
): ExtensionContext => ({
  extensionId: 'test',
  logger: options.logger ?? silentLogger,
  library: options.library ?? createMemoryLibrary({}),
  storage: options.storage ?? createMemoryStorage(),
  settings: options.settings ?? createMemorySettings([]),
  events: options.events ?? createMemoryEvents(),
  commands: options.commands ?? createMemoryCommands(),
  ...registrars,
});

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
  options: LoadOptions = {},
): Promise<LoadedExerciseType> => {
  const handlers = new Map<string, ExerciseTypeHandler>();
  const context = contextOf(options, {
    registerExerciseType: (registeredType, handler) => {
      handlers.set(registeredType, handler);
      return { dispose: () => void handlers.delete(registeredType) };
    },
    registerGradePolicy: () => ({ dispose: () => undefined }),
  });
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
  options: LoadOptions = {},
): Promise<LoadedGradePolicy> => {
  const handlers = new Map<string, GradePolicyHandler>();
  const context = contextOf(options, {
    registerExerciseType: () => ({ dispose: () => undefined }),
    registerGradePolicy: (registeredId, handler) => {
      handlers.set(registeredId, handler);
      return { dispose: () => void handlers.delete(registeredId) };
    },
  });
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

export interface LoadedEvents {
  /** События доставляются так же, как в хосте: подписанному обработчику, по одному. См. `MemoryEvents.emit`. */
  emit: MemoryEvents['emit'];
  storage: ExtensionStorage;
  settings: MemorySettings;
  /** Деактивирует модуль расширения. */
  dispose(): Promise<void>;
}

export interface LoadEventsOptions
  extends
    Omit<LoadOptions, 'storage' | 'settings' | 'events'>,
    MemoryEventsOptions {
  storage?: ExtensionStorage;
  /** Определения из `contributes.settings` манифеста; значения читаются и меняются через `settings`. */
  settings?: readonly SettingContribution[];
  /** Значения пользователя вместо `default`. */
  settingValues?: Readonly<Record<string, SettingValue>>;
}

/**
 * Активирует модуль с хранилищем, настройками и событиями в памяти и даёт тесту
 * отправлять события и менять настройки.
 */
export const loadEvents = async (
  module: ExtensionModule,
  options: LoadEventsOptions = {},
): Promise<LoadedEvents> => {
  const events = createMemoryEvents(options);
  const storage = options.storage ?? createMemoryStorage();
  const settings = createMemorySettings(
    options.settings ?? [],
    options.settingValues,
  );
  const context = contextOf(
    {
      ...(options.library !== undefined && { library: options.library }),
      ...(options.logger !== undefined && { logger: options.logger }),
      storage,
      settings,
      events,
    },
    {
      registerExerciseType: () => ({ dispose: () => undefined }),
      registerGradePolicy: () => ({ dispose: () => undefined }),
    },
  );
  await module.activate(context);
  return {
    emit: events.emit,
    storage,
    settings,
    dispose: async () => {
      await module.deactivate?.();
    },
  };
};

export interface LoadedCommands {
  run: MemoryCommands['run'];
  ids: MemoryCommands['ids'];
  /** Деактивирует модуль расширения. */
  dispose(): Promise<void>;
}

export interface LoadCommandsOptions
  extends Omit<LoadOptions, 'commands'>, MemoryCommandsOptions {}

/** Активирует модуль с командами в памяти и даёт тесту вызывать их как хост. */
export const loadCommands = async (
  module: ExtensionModule,
  options: LoadCommandsOptions = {},
): Promise<LoadedCommands> => {
  const commands = createMemoryCommands(options);
  const context = contextOf(
    {
      ...(options.library !== undefined && { library: options.library }),
      ...(options.logger !== undefined && { logger: options.logger }),
      ...(options.storage !== undefined && { storage: options.storage }),
      ...(options.settings !== undefined && { settings: options.settings }),
      ...(options.events !== undefined && { events: options.events }),
      commands,
    },
    {
      registerExerciseType: () => ({ dispose: () => undefined }),
      registerGradePolicy: () => ({ dispose: () => undefined }),
    },
  );
  await module.activate(context);
  return {
    run: commands.run,
    ids: commands.ids,
    dispose: async () => {
      await module.deactivate?.();
    },
  };
};
