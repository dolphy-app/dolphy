import {
  EXTENSION_COMMAND_LIMITS,
  COLOR_SETTING_PATTERN,
  EXTENSION_NOTIFICATION_LIMITS,
  EXTENSION_STATS_LIMITS,
  EXTENSION_SECRET_LIMITS,
  EXTENSION_STORAGE_LIMITS,
  EXTENSION_TRANSFER_LIMITS,
  SETTING_LIMITS,
  InvalidCommandResultError,
  InvalidTransferResultError,
  NotificationRateLimitError,
  PermissionError,
  SecretsUnavailableError,
  ANSWER_EVENT,
  StorageQuotaError,
  normalizeCommandResult,
  normalizeExportResult,
  normalizeImportResult,
} from '@dolphy-app/extension-api';
import type {
  AnswerChangeDetail,
  AnswerElementProps,
  CommandHandler,
  CommandOutcome,
  DailyStat,
  Disposable,
  ExerciseTypeHandler,
  ExportInput,
  ExportResult,
  ExporterHandler,
  ExtensionContext,
  ExtensionEvents,
  ExtensionCommands,
  ExtensionExporters,
  ExtensionImporters,
  ExtensionLogger,
  ExtensionModule,
  ExtensionNotification,
  ExtensionNotifications,
  ExtensionSchedule,
  ExtensionSecrets,
  ExtensionSettings,
  ExtensionStats,
  ExtensionStorage,
  GradePolicyHandler,
  GradePolicyInput,
  GradeResult,
  GradeValue,
  ImportInput,
  ImportResult,
  ImporterHandler,
  ImporterInputKind,
  JsonSchema,
  JsonValue,
  LearningEventHandler,
  LearningEventName,
  LearningEventPayloads,
  LibraryReader,
  PanelContextInfo,
  PanelModule,
  ScheduleHandler,
  SettingChange,
  SettingContribution,
  SettingValue,
  StreakStats,
} from '@dolphy-app/extension-api';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createAnswerElementClass } from './answer-element.ts';
import type { AnswerView } from './answer-view.ts';

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

/** UTF-8 byte order matches code point order — this is how the engine sorts keys. */
const compareKeys = (a: string, b: string): number =>
  Buffer.compare(Buffer.from(a), Buffer.from(b));

/**
 * In-memory storage with the same limits and errors as the engine
 * (`EXTENSION_STORAGE_LIMITS`, `StorageQuotaError`): values are stored as
 * JSON text and returned as copies; on rejection nothing changes.
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

/** In-memory secrets for tests: `ExtensionSecrets` plus a switch that imitates a missing system key store. */
export interface MemorySecrets extends ExtensionSecrets {
  /** Imitates the system key store becoming (un)available; stored values are kept. */
  setAvailable(available: boolean): void;
}

export interface MemorySecretsOptions {
  /** Default `true`; `false` imitates Linux `basic_text`, no key store, or an app that is not ready. */
  available?: boolean;
}

/**
 * In-memory secrets with the engine's limits and errors
 * (`EXTENSION_SECRET_LIMITS`, `StorageQuotaError`, `SecretsUnavailableError`):
 * without a key store `set` and `get` of an existing key throw, `get` of a
 * missing key gives `undefined` and `delete` works.
 */
export const createMemorySecrets = (
  options: MemorySecretsOptions = {},
): MemorySecrets => {
  const limits = EXTENSION_SECRET_LIMITS;
  const entries = new Map<string, string>();
  let available = options.available ?? true;
  const requireStore = (): void => {
    if (!available) throw new SecretsUnavailableError();
  };
  return {
    setAvailable: (value) => {
      available = value;
    },
    get: async (key) => {
      const value = entries.get(key);
      if (value !== undefined) requireStore();
      return value;
    },
    set: async (key, value) => {
      if (typeof key !== 'string' || key.length === 0) {
        throw new Error('secret key must be a non-empty string');
      }
      if (typeof value !== 'string') {
        throw new Error('secret value must be a string');
      }
      if (key.length > limits.keyLength) {
        throw new StorageQuotaError('key-length', limits.keyLength);
      }
      if (Buffer.byteLength(value) > limits.valueBytes) {
        throw new StorageQuotaError('value-size', limits.valueBytes);
      }
      requireStore();
      if (!entries.has(key) && entries.size >= limits.keys) {
        throw new StorageQuotaError('key-count', limits.keys);
      }
      entries.set(key, value);
    },
    delete: async (key) => entries.delete(key),
  };
};

/** The value as the host stores it: a color in lower case, a list copied. */
const storedForm = (
  definition: SettingContribution,
  value: SettingValue,
): SettingValue => {
  if (definition.type === 'color' && typeof value === 'string') {
    return value.toLowerCase();
  }
  return Array.isArray(value) ? [...value] : value;
};

const sameSettingValue = (a: SettingValue | undefined, b: SettingValue) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((item, index) => item === b[index])
    : Object.is(a, b);

/** Why a value does not fit the setting definition; `null` if it fits. */
const findSettingProblem = (
  definition: SettingContribution,
  value: unknown,
): string | null => {
  switch (definition.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be a boolean';
    case 'color':
      return typeof value === 'string' && COLOR_SETTING_PATTERN.test(value)
        ? null
        : 'must be a color #rrggbb';
    case 'list': {
      if (
        !Array.isArray(value) ||
        !value.every((item) => typeof item === 'string')
      ) {
        return 'must be an array of strings';
      }
      const maxItems = definition.maxItems ?? SETTING_LIMITS.listItems;
      if (value.length > maxItems) return `has more than ${maxItems} items`;
      const itemMax = definition.itemMaxLength ?? SETTING_LIMITS.listItemLength;
      return value.some((item: string) => item.length > itemMax)
        ? `has an item longer than ${itemMax} characters`
        : null;
    }
    case 'text':
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
   * Changes the value as the user does in the dialog: the value is validated
   * against the definition, and `onDidChange` subscribers are called if it changed.
   * Unlike the host, a handler failure is not swallowed but rejects the promise.
   */
  set(id: string, value: SettingValue): Promise<void>;
}

/** In-memory settings from manifest definitions; `initial` provides user values in place of `default`. */
export const createMemorySettings = (
  definitions: readonly SettingContribution[],
  initial: Readonly<Record<string, SettingValue>> = {},
): MemorySettings => {
  const byId = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const values = new Map<string, SettingValue>(
    definitions.map((definition) => [
      definition.id,
      storedForm(definition, definition.default),
    ]),
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
    return storedForm(known(id), value as SettingValue);
  };
  for (const [id, value] of Object.entries(initial)) {
    values.set(id, checked(id, value));
  }
  return {
    get: <T extends SettingValue = SettingValue>(id: string): T =>
      storedForm(known(id), values.get(id) as SettingValue) as T,
    onDidChange(handler) {
      handlers.add(handler);
      return { dispose: () => void handlers.delete(handler) };
    },
    async set(id, value) {
      const next = checked(id, value);
      if (sameSettingValue(values.get(id), next)) return;
      values.set(id, next);
      for (const handler of [...handlers]) await handler({ id, value: next });
    },
  };
};

export interface MemoryEvents extends ExtensionEvents {
  /**
   * Sends the event to the subscribed handler and awaits it. With no subscription,
   * the event is skipped, as in the host. Unlike the host, a handler failure
   * is not swallowed but rejects the promise, and the 2 s handler timeout is not applied.
   */
  emit<N extends LearningEventName>(
    name: N,
    payload: LearningEventPayloads[N],
  ): Promise<void>;
}

export interface MemoryEventsOptions {
  /** Events from `contributes.events`: subscribing to another throws, as in the host. Unset — any are allowed. */
  declared?: readonly LearningEventName[];
  /** false — subscribing throws `PermissionError`, as for an extension without `learning.events`. Defaults to true. */
  permitted?: boolean;
}

/** In-memory learning event subscriptions: one handler per event, as in the host. */
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
   * Runs a registered command the way the host does: the same
   * argument and result bounds, the same result normalization. An unregistered
   * command and an invalid result reject the promise. The 10 s handler timeout is not applied.
   */
  run(id: string, args?: JsonValue): Promise<CommandOutcome>;
  /** Registered commands in registration order. */
  ids(): string[];
}

export interface MemoryCommandsOptions {
  /** Commands from `contributes.commands`: registering another throws, as in the host. Unset — any are allowed. */
  declaredCommands?: readonly string[];
  /** Panels from `contributes.panels`: `openPanel` on another is invalid, as in the host. Unset — any. */
  declaredPanels?: readonly string[];
}

/** In-memory commands: the same registration rules and result parsing as the host. */
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

export interface MemorySchedule extends ExtensionSchedule {
  /**
   * Fires a schedule the way the host does and awaits the handler: resolves
   * `true` once the handler returned. With no subscription, or while the
   * handler of the previous firing is still running, the firing is skipped and
   * resolves `false`. Unlike the host, a handler failure is not swallowed but
   * rejects the promise, and the 10 s handler timeout is not applied.
   */
  fire(id: string): Promise<boolean>;
  /** Subscribed schedules in subscription order. */
  ids(): string[];
}

export interface MemoryScheduleOptions {
  /** Schedules from `contributes.schedules`: subscribing to another throws, as in the host. Unset — any are allowed. */
  declared?: readonly string[];
}

/** In-memory schedule subscriptions: one handler per schedule and no overlapping firings, as in the host. */
export const createMemorySchedule = (
  options: MemoryScheduleOptions = {},
): MemorySchedule => {
  const handlers = new Map<string, ScheduleHandler>();
  const running = new Set<string>();
  return {
    on(id, handler) {
      if (options.declared !== undefined && !options.declared.includes(id)) {
        throw new Error(`schedule '${id}' is not declared in the manifest`);
      }
      if (handlers.has(id)) {
        throw new Error(`schedule '${id}' is already subscribed`);
      }
      handlers.set(id, handler);
      return {
        dispose: () => {
          if (handlers.get(id) === handler) handlers.delete(id);
        },
      };
    },
    async fire(id) {
      const handler = handlers.get(id);
      if (handler === undefined || running.has(id)) return false;
      running.add(id);
      try {
        await handler();
        return true;
      } finally {
        running.delete(id);
      }
    },
    ids: () => [...handlers.keys()],
  };
};

export interface MemoryImporters extends ExtensionImporters {
  /**
   * Runs a registered importer the way the host does: the input must have the
   * form the importer declares (`text` unless `input: 'bytes'`) and at most
   * `EXTENSION_TRANSFER_LIMITS.inputBytes`; the result goes through the host's
   * rules (`normalizeImportResult`: paths, sizes, number of files). An
   * unregistered importer and an invalid result reject the promise. The 30 s
   * handler timeout is not applied.
   */
  run(id: string, input: ImportInput): Promise<ImportResult>;
  /** Registered importers in registration order. */
  ids(): string[];
}

export interface MemoryImportersOptions {
  /** Importers from `contributes.importers`: registering another throws and `input` is checked, as in the host. Unset — any are allowed. */
  declaredImporters?: readonly { id: string; input?: ImporterInputKind }[];
}

/** In-memory importers: the same registration rules and result checks as the host. */
export const createMemoryImporters = (
  options: MemoryImportersOptions = {},
): MemoryImporters => {
  const handlers = new Map<string, ImporterHandler>();
  const declaredOf = (id: string) =>
    options.declaredImporters?.find((entry) => entry.id === id);
  return {
    register(id, handler) {
      if (
        options.declaredImporters !== undefined &&
        declaredOf(id) === undefined
      ) {
        throw new Error(`importer '${id}' is not declared in the manifest`);
      }
      if (handlers.has(id)) {
        throw new Error(`importer '${id}' is already registered`);
      }
      handlers.set(id, handler);
      return {
        dispose: () => {
          if (handlers.get(id) === handler) handlers.delete(id);
        },
      };
    },
    async run(id, input) {
      const handler = handlers.get(id);
      if (handler === undefined) {
        throw new Error(`importer '${id}' was not registered`);
      }
      const expected = declaredOf(id)?.input ?? 'text';
      if (
        options.declaredImporters !== undefined &&
        ('text' in input ? 'text' : 'bytes') !== expected
      ) {
        throw new Error(`importer '${id}' takes ${expected} input`);
      }
      const size =
        'text' in input
          ? new TextEncoder().encode(input.text).length
          : input.bytes.byteLength;
      if (size > EXTENSION_TRANSFER_LIMITS.inputBytes) {
        throw new Error(
          `the file is longer than ${EXTENSION_TRANSFER_LIMITS.inputBytes} bytes`,
        );
      }
      const result = await handler(input);
      try {
        return normalizeImportResult(result);
      } catch (error) {
        if (error instanceof InvalidTransferResultError) {
          throw new Error(`invalid import result: ${error.message}`);
        }
        throw error;
      }
    },
    ids: () => [...handlers.keys()],
  };
};

export interface MemoryExporters extends ExtensionExporters {
  /**
   * Runs a registered exporter the way the host does: the input must match the
   * exporter's declared `scope` and a course snapshot is at most
   * `EXTENSION_TRANSFER_LIMITS.totalBytes`; the result goes through the host's
   * rules (`normalizeExportResult`: file name, size, `text` xor `bytes`). An
   * unregistered exporter and an invalid result reject the promise. The 30 s
   * handler timeout is not applied.
   */
  run(id: string, input: ExportInput): Promise<ExportResult>;
  /** Registered exporters in registration order. */
  ids(): string[];
}

export interface MemoryExportersOptions {
  /** Exporters from `contributes.exporters`: registering another throws and `scope` is checked, as in the host. Unset — any are allowed. */
  declaredExporters?: readonly { id: string; scope: ExportInput['scope'] }[];
}

/** In-memory exporters: the same registration rules and result checks as the host. */
export const createMemoryExporters = (
  options: MemoryExportersOptions = {},
): MemoryExporters => {
  const handlers = new Map<string, ExporterHandler>();
  const declaredOf = (id: string) =>
    options.declaredExporters?.find((entry) => entry.id === id);
  return {
    register(id, handler) {
      if (
        options.declaredExporters !== undefined &&
        declaredOf(id) === undefined
      ) {
        throw new Error(`exporter '${id}' is not declared in the manifest`);
      }
      if (handlers.has(id)) {
        throw new Error(`exporter '${id}' is already registered`);
      }
      handlers.set(id, handler);
      return {
        dispose: () => {
          if (handlers.get(id) === handler) handlers.delete(id);
        },
      };
    },
    async run(id, input) {
      const handler = handlers.get(id);
      if (handler === undefined) {
        throw new Error(`exporter '${id}' was not registered`);
      }
      const declared = declaredOf(id);
      if (declared !== undefined && declared.scope !== input.scope) {
        throw new Error(`exporter '${id}' takes the ${declared.scope} scope`);
      }
      if (input.scope === 'course') {
        const encoder = new TextEncoder();
        const size = Object.values(input.files).reduce(
          (sum, text) => sum + encoder.encode(text).length,
          0,
        );
        if (size > EXTENSION_TRANSFER_LIMITS.totalBytes) {
          throw new Error(
            `the course files are longer than ${EXTENSION_TRANSFER_LIMITS.totalBytes} bytes`,
          );
        }
      }
      const result = await handler(input);
      try {
        return normalizeExportResult(result);
      } catch (error) {
        if (error instanceof InvalidTransferResultError) {
          throw new Error(`invalid export result: ${error.message}`);
        }
        throw error;
      }
    },
    ids: () => [...handlers.keys()],
  };
};

export interface MemoryStatsAttempt {
  /** When the attempt happened: epoch milliseconds, a `Date`, or an ISO-8601 string. */
  at: number | Date | string;
  /** Grade 1-5; 3 and higher counts as correct, as in the app. */
  grade: number;
  /** Course of the attempt, for the `courseId` filter. Without it the attempt belongs to no course. */
  courseId?: string;
}

export interface MemoryStatsOptions {
  /** Attempts the statistics start with; more arrive through `record`. */
  attempts?: readonly MemoryStatsAttempt[];
  /** IANA time zone whose local days are counted. Defaults to the time zone of this process. */
  timeZone?: string;
  /** The current time, for the `current` streak. Defaults to `Date.now`. */
  now?: () => number;
  /** false — every call rejects with `PermissionError('learning.stats')`, as for an extension without the permission. Defaults to true. */
  permitted?: boolean;
}

export interface MemoryStats extends ExtensionStats {
  /** Adds an attempt to the history. */
  record(attempt: MemoryStatsAttempt): void;
}

const DAY_MS = 86_400_000;
const STATS_CORRECT_GRADE_MIN = 3;

const dayNumberOf = (year: number, month: number, day: number): number => {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.floor(date.getTime() / DAY_MS);
};

const dayLabelOf = (dayNumber: number): string =>
  new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);

const parseDay = (field: string, value: unknown): number => {
  const match =
    typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const day =
    match === null
      ? null
      : dayNumberOf(Number(match[1]), Number(match[2]), Number(match[3]));
  if (day === null || dayLabelOf(day) !== value) {
    throw new Error(`'${field}' must be a date as YYYY-MM-DD`);
  }
  return day;
};

/**
 * In-memory statistics with the semantics of the app: local days in a time zone,
 * correct at grade 3 or higher, `current` streak not broken while today has no
 * attempts yet, one `daily` entry per date (at most `EXTENSION_STATS_LIMITS.dailyDays`).
 */
export const createMemoryStats = (
  options: MemoryStatsOptions = {},
): MemoryStats => {
  const timeZone =
    options.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const localDay = (at: number): number => {
    const parts = Object.fromEntries(
      formatter.formatToParts(at).map(({ type, value }) => [type, value]),
    );
    return dayNumberOf(
      Number(parts.year),
      Number(parts.month),
      Number(parts.day),
    );
  };
  const attempts: { day: number; correct: boolean; courseId?: string }[] = [];
  const record = (attempt: MemoryStatsAttempt): void => {
    const at = new Date(attempt.at).getTime();
    if (Number.isNaN(at)) throw new Error('attempt.at is not a valid time');
    attempts.push({
      day: localDay(at),
      correct: attempt.grade >= STATS_CORRECT_GRADE_MIN,
      ...(attempt.courseId !== undefined && { courseId: attempt.courseId }),
    });
  };
  for (const attempt of options.attempts ?? []) record(attempt);

  const guard = (): void => {
    if (options.permitted === false)
      throw new PermissionError('learning.stats');
  };
  const countsOf = (courseId: string | undefined) => {
    const days = new Map<number, { attempts: number; correct: number }>();
    for (const item of attempts) {
      if (courseId !== undefined && item.courseId !== courseId) continue;
      const counts = days.get(item.day) ?? { attempts: 0, correct: 0 };
      counts.attempts += 1;
      if (item.correct) counts.correct += 1;
      days.set(item.day, counts);
    }
    return days;
  };
  return {
    record,
    async streak(streakOptions): Promise<StreakStats> {
      guard();
      const days = countsOf(streakOptions?.courseId);
      const today = localDay((options.now ?? Date.now)());
      let longest = 0;
      let run = 0;
      let previous = Number.NaN;
      for (const day of [...days.keys()].sort((a, b) => a - b)) {
        run = day === previous + 1 ? run + 1 : 1;
        longest = Math.max(longest, run);
        previous = day;
      }
      let cursor = days.has(today) ? today : today - 1;
      let current = 0;
      while (days.has(cursor)) {
        current += 1;
        cursor -= 1;
      }
      return { current, longest };
    },
    async daily({ from, to, courseId }): Promise<DailyStat[]> {
      guard();
      const first = parseDay('from', from);
      const last = parseDay('to', to);
      if (last < first || last - first + 1 > EXTENSION_STATS_LIMITS.dailyDays) {
        throw new Error(
          `the range must be ascending and cover at most ${EXTENSION_STATS_LIMITS.dailyDays} dates`,
        );
      }
      const days = countsOf(courseId);
      const result: DailyStat[] = [];
      for (let day = first; day <= last; day += 1) {
        const { attempts: made, correct } = days.get(day) ?? {
          attempts: 0,
          correct: 0,
        };
        result.push({
          date: dayLabelOf(day),
          attempts: made,
          correct,
          accuracy: made === 0 ? null : correct / made,
        });
      }
      return result;
    },
  };
};

export interface MemoryNotificationsOptions {
  /** false — every call rejects with `PermissionError('notifications')`, as for an extension without the permission. Defaults to true. */
  permitted?: boolean;
  /** false — the operating system does not support notifications: `show` resolves `false`. Defaults to true. */
  supported?: boolean;
  /** false — the user switched notifications off for the extension: `show` resolves `false`. Defaults to true. */
  enabled?: boolean;
  /** The current time for the rate windows. Defaults to `Date.now`. */
  now?: () => number;
}

export interface MemoryNotifications extends ExtensionNotifications {
  /** Notifications handed to the (imitated) operating system, oldest first, as the app shows them: sanitized text. */
  readonly shown: readonly ExtensionNotification[];
  /** The user's switch "Notifications" of the extension. */
  setEnabled(enabled: boolean): void;
  /** Whether the imitated operating system supports notifications. */
  setSupported(supported: boolean): void;
}

/** Control characters (except the line feed), line and paragraph separators and text direction marks. */
const NOTIFICATION_CONTROL =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

const notificationText = (
  field: 'title' | 'body',
  value: unknown,
  max: number,
): string => {
  if (typeof value !== 'string') {
    throw new Error(`notification ${field} must be a string`);
  }
  const unified = value.replace(/\r\n?/gu, '\n').replace(/\t/gu, ' ');
  const flat = field === 'body' ? unified : unified.replace(/\n/gu, ' ');
  const text = flat.replace(NOTIFICATION_CONTROL, '').trim();
  if ((field === 'title' && text === '') || [...text].length > max) {
    throw new Error(
      `notification ${field} must be ${field === 'title' ? '1 to ' : 'up to '}${max} characters`,
    );
  }
  return text;
};

/**
 * In-memory notifications with the engine's rules: the text is sanitized and
 * limited, `perMinute`/`perHour` windows throw `NotificationRateLimitError`,
 * a switched-off extension or an unsupporting system resolves `false` (and
 * does not use the rate limit). `shown` is the log the app's fake notifier
 * would keep.
 */
export const createMemoryNotifications = (
  options: MemoryNotificationsOptions = {},
): MemoryNotifications => {
  const now = options.now ?? Date.now;
  let enabled = options.enabled !== false;
  let supported = options.supported !== false;
  const shown: ExtensionNotification[] = [];
  const times: number[] = [];
  const limits = EXTENSION_NOTIFICATION_LIMITS;
  return {
    shown,
    setEnabled: (value) => {
      enabled = value;
    },
    setSupported: (value) => {
      supported = value;
    },
    async show(notification) {
      if (options.permitted === false) {
        throw new PermissionError('notifications');
      }
      const title = notificationText(
        'title',
        notification?.title,
        limits.titleLength,
      );
      const body = notificationText(
        'body',
        notification?.body,
        limits.bodyLength,
      );
      if (!enabled) return false;
      const at = now();
      const recent = times.filter((time) => at - time < 3_600_000);
      times.length = 0;
      times.push(...recent);
      if (
        recent.filter((time) => at - time < 60_000).length >= limits.perMinute
      ) {
        throw new NotificationRateLimitError('minute', limits.perMinute);
      }
      if (recent.length >= limits.perHour) {
        throw new NotificationRateLimitError('hour', limits.perHour);
      }
      times.push(at);
      if (!supported) return false;
      shown.push({ title, body });
      return true;
    },
  };
};

/** What a test replaces in the extension context; by default everything is in memory and silent. */
export interface LoadOptions {
  library?: LibraryReader;
  logger?: ExtensionLogger;
  storage?: ExtensionStorage;
  secrets?: ExtensionSecrets;
  settings?: ExtensionSettings;
  events?: ExtensionEvents;
  commands?: ExtensionCommands;
  importers?: ExtensionImporters;
  exporters?: ExtensionExporters;
  stats?: ExtensionStats;
  notifications?: ExtensionNotifications;
  schedule?: ExtensionSchedule;
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
  secrets: options.secrets ?? createMemorySecrets(),
  settings: options.settings ?? createMemorySettings([]),
  events: options.events ?? createMemoryEvents(),
  stats: options.stats ?? createMemoryStats(),
  notifications: options.notifications ?? createMemoryNotifications(),
  schedule: options.schedule ?? createMemorySchedule(),
  commands: options.commands ?? createMemoryCommands(),
  importers: options.importers ?? createMemoryImporters(),
  exporters: options.exporters ?? createMemoryExporters(),
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
  /** Deactivates the extension module. */
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
  /** Deactivates the extension module. */
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
  /** Events are delivered as in the host: to the subscribed handler, one at a time. See `MemoryEvents.emit`. */
  emit: MemoryEvents['emit'];
  storage: ExtensionStorage;
  secrets: ExtensionSecrets;
  settings: MemorySettings;
  /** Deactivates the extension module. */
  dispose(): Promise<void>;
}

export interface LoadEventsOptions
  extends
    Omit<LoadOptions, 'storage' | 'secrets' | 'settings' | 'events'>,
    MemoryEventsOptions {
  storage?: ExtensionStorage;
  secrets?: ExtensionSecrets;
  /** Definitions from the manifest's `contributes.settings`; values are read and changed through `settings`. */
  settings?: readonly SettingContribution[];
  /** User values in place of `default`. */
  settingValues?: Readonly<Record<string, SettingValue>>;
}

/**
 * Activates the module with in-memory storage, settings, and events, and lets the test
 * send events and change settings.
 */
export const loadEvents = async (
  module: ExtensionModule,
  options: LoadEventsOptions = {},
): Promise<LoadedEvents> => {
  const events = createMemoryEvents(options);
  const storage = options.storage ?? createMemoryStorage();
  const secrets = options.secrets ?? createMemorySecrets();
  const settings = createMemorySettings(
    options.settings ?? [],
    options.settingValues,
  );
  const context = contextOf(
    {
      ...(options.library !== undefined && { library: options.library }),
      ...(options.logger !== undefined && { logger: options.logger }),
      ...(options.stats !== undefined && { stats: options.stats }),
      ...(options.notifications !== undefined && {
        notifications: options.notifications,
      }),
      ...(options.schedule !== undefined && { schedule: options.schedule }),
      storage,
      secrets,
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
    secrets,
    settings,
    dispose: async () => {
      await module.deactivate?.();
    },
  };
};

export interface LoadedCommands {
  run: MemoryCommands['run'];
  ids: MemoryCommands['ids'];
  /** Deactivates the extension module. */
  dispose(): Promise<void>;
}

export interface LoadCommandsOptions
  extends Omit<LoadOptions, 'commands'>, MemoryCommandsOptions {}

/** Activates the module with in-memory commands and lets the test invoke them like the host. */
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
      ...(options.secrets !== undefined && { secrets: options.secrets }),
      ...(options.settings !== undefined && { settings: options.settings }),
      ...(options.events !== undefined && { events: options.events }),
      ...(options.stats !== undefined && { stats: options.stats }),
      ...(options.notifications !== undefined && {
        notifications: options.notifications,
      }),
      ...(options.schedule !== undefined && { schedule: options.schedule }),
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

/** The context parts a test replaced, without the keys it left unset. */
const loadOptionsOf = (options: LoadOptions): LoadOptions => ({
  ...(options.library !== undefined && { library: options.library }),
  ...(options.logger !== undefined && { logger: options.logger }),
  ...(options.storage !== undefined && { storage: options.storage }),
  ...(options.secrets !== undefined && { secrets: options.secrets }),
  ...(options.settings !== undefined && { settings: options.settings }),
  ...(options.events !== undefined && { events: options.events }),
  ...(options.commands !== undefined && { commands: options.commands }),
  ...(options.stats !== undefined && { stats: options.stats }),
  ...(options.notifications !== undefined && {
    notifications: options.notifications,
  }),
  ...(options.schedule !== undefined && { schedule: options.schedule }),
});

export interface LoadedImporters {
  run: MemoryImporters['run'];
  ids: MemoryImporters['ids'];
  /** Deactivates the extension module. */
  dispose(): Promise<void>;
}

export interface LoadImportersOptions
  extends Omit<LoadOptions, 'importers'>, MemoryImportersOptions {}

/** Activates the module with in-memory importers and lets the test run them like the host. */
export const loadImporters = async (
  module: ExtensionModule,
  options: LoadImportersOptions = {},
): Promise<LoadedImporters> => {
  const importers = createMemoryImporters(options);
  const context = contextOf(
    { ...loadOptionsOf(options), importers },
    {
      registerExerciseType: () => ({ dispose: () => undefined }),
      registerGradePolicy: () => ({ dispose: () => undefined }),
    },
  );
  await module.activate(context);
  return {
    run: importers.run,
    ids: importers.ids,
    dispose: async () => {
      await module.deactivate?.();
    },
  };
};

export interface LoadedExporters {
  run: MemoryExporters['run'];
  ids: MemoryExporters['ids'];
  /** Deactivates the extension module. */
  dispose(): Promise<void>;
}

export interface LoadExportersOptions
  extends Omit<LoadOptions, 'exporters'>, MemoryExportersOptions {}

/** Activates the module with in-memory exporters and lets the test run them like the host; `stats` feeds `ctx.stats` of a progress exporter. */
export const loadExporters = async (
  module: ExtensionModule,
  options: LoadExportersOptions = {},
): Promise<LoadedExporters> => {
  const exporters = createMemoryExporters(options);
  const context = contextOf(
    { ...loadOptionsOf(options), exporters },
    {
      registerExerciseType: () => ({ dispose: () => undefined }),
      registerGradePolicy: () => ({ dispose: () => undefined }),
    },
  );
  await module.activate(context);
  return {
    run: exporters.run,
    ids: exporters.ids,
    dispose: async () => {
      await module.deactivate?.();
    },
  };
};

export interface LoadedSchedules {
  fire: MemorySchedule['fire'];
  ids: MemorySchedule['ids'];
  /** Deactivates the extension module. */
  dispose(): Promise<void>;
}

export interface LoadSchedulesOptions
  extends Omit<LoadOptions, 'schedule'>, MemoryScheduleOptions {}

/** Activates the module with in-memory schedules and lets the test fire them like the host. */
export const loadSchedules = async (
  module: ExtensionModule,
  options: LoadSchedulesOptions = {},
): Promise<LoadedSchedules> => {
  const schedule = createMemorySchedule(options);
  const context = contextOf(
    { ...loadOptionsOf(options), schedule },
    {
      registerExerciseType: () => ({ dispose: () => undefined }),
      registerGradePolicy: () => ({ dispose: () => undefined }),
    },
  );
  await module.activate(context);
  return {
    fire: schedule.fire,
    ids: schedule.ids,
    dispose: async () => {
      await module.deactivate?.();
    },
  };
};

const requireDocument = (helper: string): Document => {
  if (typeof document === 'undefined') {
    throw new Error(
      `${helper} needs a DOM: run the test in a DOM environment (happy-dom or jsdom)`,
    );
  }
  return document;
};

const microtask = (): Promise<void> => Promise.resolve();

export interface LoadViewOptions extends Partial<AnswerElementProps> {
  /** `aria-label` of the host element, as the app sets it. */
  label?: string;
  /** Where to mount; defaults to a new `div` in `document.body`. */
  container?: HTMLElement;
}

export interface LoadedView {
  /** The kind's custom element, as the app creates it. */
  readonly element: HTMLElement;
  /** The element's shadow root: the view renders its UI here. */
  readonly root: ShadowRoot;
  /** `dolphy-answer-change` events in order. */
  readonly changes: readonly AnswerChangeDetail[];
  /** How many times the view asked to submit the answer (`dolphy-answer-submit`). */
  readonly submissions: number;
  /** Sets element properties and waits for the view to apply the update. */
  update(props: Partial<AnswerElementProps>): Promise<void>;
  query<E extends Element = Element>(selector: string): E | null;
  queryAll<E extends Element = Element>(selector: string): E[];
  /** Removes the element from the document; the view receives `destroy()`. */
  dispose(): void;
}

let viewCounter = 0;

/**
 * Mounts a view from `views[id]` in the test DOM environment with the same element
 * the app creates (test tags are issued; the manifest `element` is not needed).
 */
export const loadView = async (
  views: Readonly<Record<string, AnswerView>>,
  id: string,
  options: LoadViewOptions = {},
): Promise<LoadedView> => {
  const doc = requireDocument('loadView');
  const view = views[id];
  if (view === undefined) throw new Error(`view '${id}' was not exported`);
  const tag = `dolphy-test-view-${++viewCounter}`;
  customElements.define(tag, createAnswerElementClass(tag, view));
  const element = doc.createElement(tag) as HTMLElement &
    Partial<AnswerElementProps>;
  if (options.label !== undefined) {
    element.setAttribute('aria-label', options.label);
  }
  for (const key of ['view', 'value', 'disabled', 'verdict'] as const) {
    if (options[key] !== undefined)
      Object.assign(element, { [key]: options[key] });
  }
  const changes: AnswerChangeDetail[] = [];
  let submissions = 0;
  element.addEventListener(ANSWER_EVENT.change, (event) => {
    changes.push((event as CustomEvent<AnswerChangeDetail>).detail);
  });
  element.addEventListener(ANSWER_EVENT.submit, () => void (submissions += 1));
  const container =
    options.container ?? doc.body.appendChild(doc.createElement('div'));
  container.append(element);
  await microtask();
  const root = element.shadowRoot as ShadowRoot;
  return {
    element,
    root,
    changes,
    get submissions() {
      return submissions;
    },
    update: async (props) => {
      Object.assign(element, props);
      await microtask();
    },
    query: (selector) => root.querySelector(selector),
    queryAll: (selector) => [...root.querySelectorAll(selector)] as never,
    dispose: () => {
      element.remove();
      if (options.container === undefined) container.remove();
    },
  };
};

export interface LoadPanelOptions {
  /** Properties the panel was opened with (`openPanel(id, props)`). */
  props?: JsonValue;
  /** Reply to `ctx.call`; by default the call is rejected. */
  call?: (
    commandId: string,
    args: JsonValue | undefined,
  ) => JsonValue | undefined | Promise<JsonValue | undefined>;
  /** The surroundings the frame starts with (`ctx.context`); defaults to all courses (`courseId: null`). */
  context?: PanelContextInfo;
  /** Where to mount; defaults to a new `div` in `document.body`. */
  container?: HTMLElement;
}

export interface LoadedFrame {
  /** Container the module received in `mount`. */
  readonly container: HTMLElement;
  /** `ctx.call` invocations in order. */
  readonly calls: readonly {
    commandId: string;
    args: JsonValue | undefined;
  }[];
  /** Whether `ctx.signal` was aborted (after `dispose()`). */
  readonly aborted: boolean;
  /** The app focused another course: updates `ctx.context` and notifies `ctx.onContextChange` subscribers. */
  setContext(context: PanelContextInfo): void;
  /** Closes the frame: aborts `ctx.signal` and removes the container. */
  dispose(): void;
}

export interface LoadedPanel extends LoadedFrame {
  /** Sends new properties to the panel (`ctx.onProps`). */
  setProps(props: JsonValue | undefined): void;
}

/** The context of a panel, with the controls a test needs. */
const createFrameContext = (options: LoadPanelOptions, doc: Document) => {
  const calls: { commandId: string; args: JsonValue | undefined }[] = [];
  const listeners = new Set<(context: PanelContextInfo) => void>();
  const controller = new AbortController();
  const container =
    options.container ?? doc.body.appendChild(doc.createElement('div'));
  let current: PanelContextInfo = {
    courseId: options.context?.courseId ?? null,
  };
  const context = {
    get context() {
      return current;
    },
    signal: controller.signal,
    call: async (commandId: string, args?: JsonValue) => {
      calls.push({ commandId, args });
      if (options.call === undefined) {
        throw new Error(`command '${commandId}' is not available in this test`);
      }
      return options.call(commandId, args);
    },
    onContextChange: (listener: (context: PanelContextInfo) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const frame: LoadedFrame = {
    container,
    calls,
    get aborted() {
      return controller.signal.aborted;
    },
    setContext: (next) => {
      current = { courseId: next.courseId };
      for (const listener of [...listeners]) listener(current);
    },
    dispose: () => {
      controller.abort();
      if (options.container === undefined) container.remove();
    },
  };
  return { context, frame, container };
};

/** Mounts a panel from `panels[id]` in the test DOM environment with the same context the frame provides. */
export const loadPanel = async (
  panels: Readonly<Record<string, PanelModule<HTMLElement>>>,
  id: string,
  options: LoadPanelOptions = {},
): Promise<LoadedPanel> => {
  const doc = requireDocument('loadPanel');
  const panel = panels[id];
  if (panel === undefined) throw new Error(`panel '${id}' was not exported`);
  const { context, frame, container } = createFrameContext(options, doc);
  const listeners = new Set<(props: JsonValue | undefined) => void>();
  await panel.mount(container, {
    get context() {
      return context.context;
    },
    signal: context.signal,
    call: context.call,
    onContextChange: context.onContextChange,
    panelId: id,
    props: options.props,
    onProps: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  });
  return Object.assign(frame, {
    setProps: (props: JsonValue | undefined) => {
      for (const listener of [...listeners]) listener(props);
    },
  });
};
