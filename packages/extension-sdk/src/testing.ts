import {
  COLOR_SETTING_PATTERN,
  DEFAULT_EXTENSION_ICON,
  EXTENSION_COMMAND_LIMITS,
  EXTENSION_NOTIFICATION_LIMITS,
  EXTENSION_SCHEDULE_LIMITS,
  EXTENSION_SECRET_LIMITS,
  INJECTION_LIMITS,
  INJECTION_POSITIONS,
  EXTENSION_STATS_LIMITS,
  EXTENSION_STORAGE_LIMITS,
  EXTENSION_TRANSFER_LIMITS,
  SETTING_LIMITS,
  InvalidCommandResultError,
  MARKDOWN_LANGUAGE_PATTERN,
  InvalidTransferResultError,
  NotificationRateLimitError,
  SecretsUnavailableError,
  StorageQuotaError,
  normalizeCommandResult,
  normalizeExportResult,
  normalizeImportResult,
} from '@dolphy-app/extension-api';
import type {
  ClientCommandRegistration,
  CommandKeybinding,
  CommandOutcome,
  CommandRegistration,
  DailyStat,
  Disposable,
  ExerciseTypeRegistration,
  ExportInput,
  ExportResult,
  ExporterRegistration,
  ExtensionLogger,
  ExtensionNotification,
  ExtensionNotifications,
  ExtensionSecrets,
  ExtensionSettings,
  ExtensionStats,
  ExtensionStorage,
  GradePolicyInput,
  GradePolicyRegistration,
  GradeResult,
  GradeValue,
  ImportInput,
  ImportResult,
  ImporterRegistration,
  JsonSchema,
  JsonValue,
  LearningEventName,
  LearningEventPayloads,
  LibraryReader,
  RegisteredKeybinding,
  RegisteredSetting,
  ScheduleHandler,
  ScheduleRegistration,
  ServerContext,
  ServerEntry,
  ServerRegistration,
  SettingChange,
  SettingDefinition,
  SettingValue,
  StreakStats,
  ThemeRegistration,
} from '@dolphy-app/extension-api';
import type { Component } from 'vue';
import type {
  ClientContext,
  ClientEntry,
  InjectionRegistration,
  PanelRegistration,
} from './define-entry.ts';
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
  definition: SettingDefinition,
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
  definition: SettingDefinition,
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
  /** Adds definitions, as `server.registerSettings` does; an id registered twice throws. The returned `Disposable` removes them. */
  register(definitions: readonly SettingDefinition[]): Disposable;
}

/**
 * In-memory settings. `definitions` are registered at once, more come through
 * `register`; `initial` provides user values in place of `default`, applied
 * when the setting with that id is registered.
 */
export const createMemorySettings = (
  definitions: readonly SettingDefinition[] = [],
  initial: Readonly<Record<string, SettingValue>> = {},
): MemorySettings => {
  const byId = new Map<string, SettingDefinition>();
  const values = new Map<string, SettingValue>();
  const handlers = new Set<(change: SettingChange) => void>();
  const known = (id: string): SettingDefinition => {
    const definition = byId.get(id);
    if (definition === undefined) {
      throw new Error(`setting '${id}' is not registered`);
    }
    return definition;
  };
  const checked = (id: string, value: unknown): SettingValue => {
    const problem = findSettingProblem(known(id), value);
    if (problem !== null) throw new Error(`setting '${id}' ${problem}`);
    return storedForm(known(id), value as SettingValue);
  };
  const register = (added: readonly SettingDefinition[]): Disposable => {
    for (const definition of added) {
      if (byId.has(definition.id)) {
        throw new Error(`setting '${definition.id}' is already registered`);
      }
      byId.set(definition.id, definition);
      values.set(definition.id, storedForm(definition, definition.default));
      const user = initial[definition.id];
      if (user !== undefined)
        values.set(definition.id, checked(definition.id, user));
    }
    return {
      dispose: () => {
        for (const definition of added) {
          byId.delete(definition.id);
          values.delete(definition.id);
        }
      },
    };
  };
  register(definitions);
  return {
    register,
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

const isGradeValue = (value: unknown): value is GradeValue =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 5;

const registeredSettingOf = (
  definition: SettingDefinition,
): RegisteredSetting => {
  const base = {
    id: definition.id,
    label: definition.label,
    description: definition.description ?? null,
    group: definition.group ?? null,
    order: definition.order ?? 0,
    visibleWhen: definition.visibleWhen ?? null,
  };
  switch (definition.type) {
    case 'boolean':
    case 'color':
      return {
        ...base,
        type: definition.type,
        default: definition.default,
      } as RegisteredSetting;
    case 'string':
    case 'text':
      return {
        ...base,
        type: definition.type,
        default: definition.default,
        maxLength: definition.maxLength ?? null,
      };
    case 'list':
      return {
        ...base,
        type: 'list',
        default: [...definition.default],
        maxItems: definition.maxItems ?? SETTING_LIMITS.listItems,
        itemMaxLength:
          definition.itemMaxLength ?? SETTING_LIMITS.listItemLength,
      };
    case 'number':
      return {
        ...base,
        type: 'number',
        default: definition.default,
        min: definition.min ?? null,
        max: definition.max ?? null,
        integer: definition.integer ?? false,
      };
    default:
      return {
        ...base,
        type: 'enum',
        default: definition.default,
        options: definition.options.map((option) => ({ ...option })),
      };
  }
};

const registeredKeybindingOf = (
  binding: CommandKeybinding,
): RegisteredKeybinding => ({
  key: binding.key,
  mac: binding.mac ?? null,
  windows: binding.windows ?? null,
  linux: binding.linux ?? null,
  when: binding.when ?? null,
});

/** What a test replaces in the context of the server part; by default everything is in memory and silent. */
export interface TestServerOptions {
  /** Default `test`. When set, every registered id must be equal to it or start with `<extensionId>.`, as the host checks. */
  extensionId?: string;
  library?: LibraryReader;
  logger?: ExtensionLogger;
  storage?: ExtensionStorage;
  secrets?: MemorySecrets;
  stats?: MemoryStats;
  notifications?: MemoryNotifications;
  /** User values of settings in place of `default`, by setting id; every id must be registered by the entry. */
  settingValues?: Readonly<Record<string, SettingValue>>;
}

export interface TestExerciseType {
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
}

export interface TestGradePolicy {
  evaluate(input: GradePolicyInput): Promise<GradeValue | null>;
}

export interface TestImporter {
  /**
   * Runs the importer the way the host does: the input must have the form the
   * importer declares and at most `EXTENSION_TRANSFER_LIMITS.inputBytes`; the
   * result goes through `normalizeImportResult`. An invalid result rejects the
   * promise. The handler timeout is not applied.
   */
  run(input: ImportInput): Promise<ImportResult>;
}

export interface TestExporter {
  /**
   * Runs the exporter the way the host does: the input must match the
   * exporter's `scope` and a course snapshot is at most
   * `EXTENSION_TRANSFER_LIMITS.totalBytes`; the result goes through
   * `normalizeExportResult`. An invalid result rejects the promise. The handler
   * timeout is not applied.
   */
  run(input: ExportInput): Promise<ExportResult>;
}

/** The server part of an extension, started on in-memory fakes. */
export interface TestServer {
  readonly extensionId: string;
  /** What the entry registered, as the host's registrar hands it to the engine (checked for types and unique ids only: the host checks the rest). */
  readonly registration: ServerRegistration;
  readonly library: LibraryReader;
  readonly storage: ExtensionStorage;
  readonly secrets: MemorySecrets;
  readonly settings: MemorySettings;
  readonly stats: MemoryStats;
  readonly notifications: MemoryNotifications;
  readonly commands: {
    /**
     * Runs a registered command the way the host does: the same argument and
     * result bounds, the same result normalization. An unregistered command
     * and an invalid result reject the promise. The handler timeout is not applied.
     */
    run(id: string, args?: JsonValue): Promise<CommandOutcome>;
  };
  readonly events: {
    /**
     * Sends the event to the subscribed handler and awaits it. With no
     * subscription the event is skipped, as in the host. Unlike the host, a
     * handler failure is not swallowed but rejects the promise, and the
     * handler timeout is not applied.
     */
    emit<N extends LearningEventName>(
      name: N,
      payload: LearningEventPayloads[N],
    ): Promise<void>;
  };
  readonly schedule: {
    /**
     * Fires a registered schedule the way the host does and awaits the
     * handler: resolves `true` once the handler returned, `false` while the
     * handler of the previous firing is still running. An unregistered
     * schedule rejects the promise. Unlike the host, a handler failure is not
     * swallowed but rejects the promise.
     */
    fire(id: string): Promise<boolean>;
  };
  exerciseType(id: string): TestExerciseType;
  gradePolicy(id: string): TestGradePolicy;
  importer(id: string): TestImporter;
  exporter(id: string): TestExporter;
  /** Runs the cleanup the entry returned and removes the registrations. */
  dispose(): Promise<void>;
}

const registered = <T>(map: Map<string, T>, kind: string, id: string): T => {
  const entry = map.get(id);
  if (entry === undefined)
    throw new Error(`${kind} '${id}' was not registered`);
  return entry;
};

/**
 * Starts `entry` (the `server` export of an extension) with in-memory
 * storage, secrets, settings, statistics, notifications and library, and
 * returns a harness to call what it registered. Registration is all or
 * nothing, as in the host: when `entry` throws, so does `createTestServer`.
 */
export const createTestServer = async (
  entry: ServerEntry,
  options: TestServerOptions = {},
): Promise<TestServer> => {
  const extensionId = options.extensionId ?? 'test';
  const library = options.library ?? createMemoryLibrary({});
  const storage = options.storage ?? createMemoryStorage();
  const secrets = options.secrets ?? createMemorySecrets();
  const stats = options.stats ?? createMemoryStats();
  const notifications = options.notifications ?? createMemoryNotifications();
  const settings = createMemorySettings([], options.settingValues);

  const exerciseTypes = new Map<string, ExerciseTypeRegistration>();
  const gradePolicies = new Map<string, GradePolicyRegistration>();
  const commands = new Map<string, CommandRegistration>();
  const schedules = new Map<
    string,
    { reg: ScheduleRegistration; handler: ScheduleHandler }
  >();
  const importers = new Map<string, ImporterRegistration>();
  const exporters = new Map<string, ExporterRegistration>();
  const events = new Map<
    LearningEventName,
    (payload: never) => void | Promise<void>
  >();
  const definitions: SettingDefinition[] = [];
  const running = new Set<string>();

  const add = <T>(
    map: Map<string, T>,
    kind: string,
    id: string,
    value: T,
    max?: number,
  ): Disposable => {
    if (typeof id !== 'string' || id === '') {
      throw new Error(`${kind} id must be a non-empty string`);
    }
    if (
      options.extensionId !== undefined &&
      id !== extensionId &&
      !id.startsWith(`${extensionId}.`)
    ) {
      throw new Error(
        `${kind} id '${id}' must be '${extensionId}' or start with '${extensionId}.'`,
      );
    }
    if (map.has(id)) throw new Error(`${kind} '${id}' is already registered`);
    if (max !== undefined && map.size >= max) {
      throw new Error(`more than ${max} ${kind}s`);
    }
    map.set(id, value);
    return {
      dispose: () => {
        if (map.get(id) === value) map.delete(id);
      },
    };
  };

  const context: ServerContext = {
    extensionId,
    logger: options.logger ?? silentLogger,
    library,
    storage,
    secrets,
    settings,
    stats,
    notifications,
    registerExerciseType: (reg) =>
      add(exerciseTypes, 'exercise type', reg.id, reg),
    registerGradePolicy: (reg) =>
      add(gradePolicies, 'grade policy', reg.id, reg),
    registerSettings: (added) => {
      const registeredSettings = settings.register(added);
      definitions.push(...added);
      return {
        dispose: () => {
          registeredSettings.dispose();
          for (const definition of added) {
            definitions.splice(definitions.indexOf(definition), 1);
          }
        },
      };
    },
    on: (name, handler) => {
      if (events.has(name)) {
        throw new Error(`event '${name}' is already subscribed`);
      }
      events.set(name, handler);
      return {
        dispose: () => {
          if (events.get(name) === handler) events.delete(name);
        },
      };
    },
    registerCommand: (reg) =>
      add(commands, 'command', reg.id, reg, EXTENSION_COMMAND_LIMITS.commands),
    schedule: (reg, handler) =>
      add(
        schedules,
        'schedule',
        reg.id,
        { reg, handler },
        EXTENSION_SCHEDULE_LIMITS.schedules,
      ),
    registerImporter: (reg) =>
      add(
        importers,
        'importer',
        reg.id,
        reg,
        EXTENSION_TRANSFER_LIMITS.importers,
      ),
    registerExporter: (reg) =>
      add(
        exporters,
        'exporter',
        reg.id,
        reg,
        EXTENSION_TRANSFER_LIMITS.exporters,
      ),
  };

  const cleanup = await entry(context);
  for (const id of Object.keys(options.settingValues ?? {})) {
    if (!definitions.some((definition) => definition.id === id)) {
      throw new Error(`setting '${id}' of settingValues is not registered`);
    }
  }

  const registration: ServerRegistration = {
    exerciseTypes: [...exerciseTypes.values()].map((reg) => ({
      id: reg.id,
      title: reg.title ?? null,
      specSchema: reg.specSchema,
      answerSchema: reg.answerSchema,
    })),
    gradePolicies: [...gradePolicies.values()].map((reg) => ({
      id: reg.id,
      label: reg.label,
    })),
    settings: definitions.map(registeredSettingOf),
    events: [...events.keys()],
    commands: [...commands.values()].map((reg) => ({
      id: reg.id,
      title: reg.title,
      description: reg.description ?? null,
      category: reg.category ?? null,
      palette: reg.palette ?? true,
      icon: reg.icon ?? DEFAULT_EXTENSION_ICON,
      keybindings: (reg.keybindings ?? []).map(registeredKeybindingOf),
      when: reg.when ?? null,
    })),
    schedules: [...schedules.values()].map(({ reg }) => ({
      id: reg.id,
      every: reg.every,
      at: reg.every === 'daily' ? reg.at : null,
    })),
    importers: [...importers.values()].map((reg) => ({
      id: reg.id,
      title: reg.title,
      accept: [...reg.accept],
      input: reg.input,
    })),
    exporters: [...exporters.values()].map((reg) => ({
      id: reg.id,
      title: reg.title,
      scope: reg.scope,
    })),
  };

  return {
    extensionId,
    registration,
    library,
    storage,
    secrets,
    settings,
    stats,
    notifications,
    commands: {
      async run(id, args) {
        const { run } = registered(commands, 'command', id);
        if (
          (JSON.stringify(args)?.length ?? 0) >
          EXTENSION_COMMAND_LIMITS.argsChars
        ) {
          throw new Error(
            `args are longer than ${EXTENSION_COMMAND_LIMITS.argsChars} characters`,
          );
        }
        const result = await run(args);
        try {
          return normalizeCommandResult(result, undefined);
        } catch (error) {
          if (error instanceof InvalidCommandResultError) {
            throw new Error(`invalid command result: ${error.message}`);
          }
          throw error;
        }
      },
    },
    events: {
      async emit(name, payload) {
        await events.get(name)?.(payload as never);
      },
    },
    schedule: {
      async fire(id) {
        const { handler } = registered(schedules, 'schedule', id);
        if (running.has(id)) return false;
        running.add(id);
        try {
          await handler();
          return true;
        } finally {
          running.delete(id);
        }
      },
    },
    exerciseType(id) {
      const reg = registered(exerciseTypes, 'exercise type', id);
      return {
        project: async (spec, { exerciseId = DEFAULT_EXERCISE_ID } = {}) =>
          reg.project({ exerciseId, spec }),
        grade: async ({
          spec,
          answer,
          exerciseId = DEFAULT_EXERCISE_ID,
          timeoutMs = DEFAULT_TIMEOUT_MS,
          authorMode = false,
        }) => {
          const result = await reg.grade({
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
          const answer = await reg.referenceAnswer?.({ exerciseId, spec });
          return answer === undefined
            ? { found: false }
            : { found: true, answer };
        },
      };
    },
    gradePolicy(id) {
      const reg = registered(gradePolicies, 'grade policy', id);
      return {
        evaluate: async (input) => {
          const result = await reg.evaluate(input);
          if (result !== null && !isGradeValue(result)) {
            throw new Error(
              `invalid grade policy result: ${JSON.stringify(result)} is not an integer 1..5 or null`,
            );
          }
          return result;
        },
      };
    },
    importer(id) {
      const reg = registered(importers, 'importer', id);
      return {
        async run(input) {
          if (('text' in input ? 'text' : 'bytes') !== reg.input) {
            throw new Error(`importer '${id}' takes ${reg.input} input`);
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
          const result = await reg.run(input);
          try {
            return normalizeImportResult(result);
          } catch (error) {
            if (error instanceof InvalidTransferResultError) {
              throw new Error(`invalid import result: ${error.message}`);
            }
            throw error;
          }
        },
      };
    },
    exporter(id) {
      const reg = registered(exporters, 'exporter', id);
      return {
        async run(input) {
          if (reg.scope !== input.scope) {
            throw new Error(`exporter '${id}' takes the ${reg.scope} scope`);
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
          const result = await reg.run(input);
          try {
            return normalizeExportResult(result);
          } catch (error) {
            if (error instanceof InvalidTransferResultError) {
              throw new Error(`invalid export result: ${error.message}`);
            }
            throw error;
          }
        },
      };
    },
    async dispose() {
      exerciseTypes.clear();
      gradePolicies.clear();
      commands.clear();
      schedules.clear();
      importers.clear();
      exporters.clear();
      events.clear();
      if (typeof cleanup === 'function') await cleanup();
      else if (cleanup !== undefined) await cleanup.dispose();
    },
  };
};

/** The client part of an extension, started on a recording context. */
export interface TestClient {
  readonly extensionId: string;
  readonly panels: readonly PanelRegistration[];
  /** Injections as registered, with `position` defaulted to `append`. */
  readonly injections: readonly Required<InjectionRegistration>[];
  /** Answer views by exercise type id. */
  readonly answerViews: ReadonlyMap<string, Component>;
  /** Markdown renderers by block language. */
  readonly markdownRenderers: ReadonlyMap<string, Component>;
  readonly themes: readonly ThemeRegistration[];
  readonly commands: readonly ClientCommandRegistration[];
  /** Runs the cleanup the entry returned and removes the registrations. */
  dispose(): Promise<void>;
}

export interface TestClientOptions {
  /** Default `test`. When set, every registered id must be equal to it or start with `<extensionId>.`, as the window checks. */
  extensionId?: string;
}

/**
 * Starts `entry` (the `client` export of an extension) on a context that
 * records what it adds, so a test can mount the components and read the
 * themes and commands. An id added twice and an injection with a bad target
 * or position fail like in the window.
 */
export const createTestClient = async (
  entry: ClientEntry,
  options: TestClientOptions = {},
): Promise<TestClient> => {
  const extensionId = options.extensionId ?? 'test';
  const panels: PanelRegistration[] = [];
  const injections: Required<InjectionRegistration>[] = [];
  const answerViews = new Map<string, Component>();
  const markdownRenderers = new Map<string, Component>();
  const themes: ThemeRegistration[] = [];
  const commands: ClientCommandRegistration[] = [];

  const checkId = (kind: string, id: string): void => {
    if (
      options.extensionId !== undefined &&
      id !== extensionId &&
      !id.startsWith(`${extensionId}.`)
    ) {
      throw new Error(
        `${kind} id '${id}' must be '${extensionId}' or start with '${extensionId}.'`,
      );
    }
  };
  const addTo = <T extends { id: string }>(
    list: T[],
    kind: string,
    value: T,
  ): Disposable => {
    checkId(kind, value.id);
    if (list.some((item) => item.id === value.id)) {
      throw new Error(`${kind} '${value.id}' is already added`);
    }
    list.push(value);
    return { dispose: () => void list.splice(list.indexOf(value), 1) };
  };
  const addToMap = (
    map: Map<string, Component>,
    kind: string,
    key: string,
    component: Component,
  ): Disposable => {
    if (map.has(key)) throw new Error(`${kind} '${key}' is already added`);
    map.set(key, component);
    return {
      dispose: () => {
        if (map.get(key) === component) map.delete(key);
      },
    };
  };

  const context: ClientContext = {
    extensionId,
    addPanel: (reg) => addTo(panels, 'panel', reg),
    addInjection: (reg) => {
      const { target } = reg;
      if (
        target.length === 0 ||
        target.length > INJECTION_LIMITS.selectorLength
      ) {
        throw new Error(
          `injection target must be 1–${INJECTION_LIMITS.selectorLength} characters`,
        );
      }
      const position = reg.position ?? 'append';
      if (!INJECTION_POSITIONS.includes(position)) {
        throw new Error(`injection position '${position}' is not valid`);
      }
      if (injections.some(({ id }) => id === reg.id)) {
        throw new Error(`injection '${reg.id}' is already added`);
      }
      const added = { ...reg, position };
      injections.push(added);
      return {
        dispose: () => void injections.splice(injections.indexOf(added), 1),
      };
    },
    addAnswerView: (id, component) =>
      addToMap(answerViews, 'answer view', id, component),
    addMarkdownRenderer: (language, component) => {
      if (!MARKDOWN_LANGUAGE_PATTERN.test(language)) {
        throw new Error(`markdown language '${language}' is not valid`);
      }
      return addToMap(
        markdownRenderers,
        'markdown renderer',
        language,
        component,
      );
    },
    addTheme: (reg) => addTo(themes, 'theme', reg),
    addCommand: (reg) => addTo(commands, 'command', reg),
  };

  const cleanup = await entry(context);
  return {
    extensionId,
    panels,
    injections,
    answerViews,
    markdownRenderers,
    themes,
    commands,
    async dispose() {
      panels.length = 0;
      injections.length = 0;
      answerViews.clear();
      markdownRenderers.clear();
      themes.length = 0;
      commands.length = 0;
      if (typeof cleanup === 'function') await cleanup();
      else if (cleanup !== undefined) await cleanup.dispose();
    },
  };
};
