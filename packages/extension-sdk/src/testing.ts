import {
  EXTENSION_COMMAND_LIMITS,
  COLOR_SETTING_PATTERN,
  EXTENSION_STORAGE_LIMITS,
  SETTING_LIMITS,
  InvalidCommandResultError,
  PermissionError,
  ANSWER_EVENT,
  StorageQuotaError,
  normalizeCommandResult,
} from '@dolphy-app/extension-api';
import type {
  AnswerChangeDetail,
  AnswerElementProps,
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
  PanelModule,
  SettingChange,
  SettingContribution,
  SettingValue,
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

/** The value as the host stores it: a color in lower case, a list copied. */
const storedForm = (
  definition: SettingContribution,
  value: SettingValue,
): SettingValue =>
  definition.type === 'color' && typeof value === 'string'
    ? value.toLowerCase()
    : Array.isArray(value)
      ? [...value]
      : value;

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
    get: <T extends SettingValue = SettingValue>(id: string): T => {
      return storedForm(known(id), values.get(id) as SettingValue) as T;
    },
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

/** What a test replaces in the extension context; by default everything is in memory and silent. */
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
  settings: MemorySettings;
  /** Deactivates the extension module. */
  dispose(): Promise<void>;
}

export interface LoadEventsOptions
  extends
    Omit<LoadOptions, 'storage' | 'settings' | 'events'>,
    MemoryEventsOptions {
  storage?: ExtensionStorage;
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
  /** Where to mount; defaults to a new `div` in `document.body`. */
  container?: HTMLElement;
}

export interface LoadedPanel {
  /** Container the panel received in `mount`. */
  readonly container: HTMLElement;
  /** `ctx.call` invocations in order. */
  readonly calls: readonly {
    commandId: string;
    args: JsonValue | undefined;
  }[];
  /** Whether `ctx.signal` was aborted (after `dispose()`). */
  readonly aborted: boolean;
  /** Sends new properties to the panel (`ctx.onProps`). */
  setProps(props: JsonValue | undefined): void;
  /** Closes the frame: aborts `ctx.signal` and removes the container. */
  dispose(): void;
}

/** Mounts a panel from `panels[id]` in the test DOM environment with the same context the frame provides. */
export const loadPanel = async (
  panels: Readonly<Record<string, PanelModule<HTMLElement>>>,
  id: string,
  options: LoadPanelOptions = {},
): Promise<LoadedPanel> => {
  const doc = requireDocument('loadPanel');
  const panel = panels[id];
  if (panel === undefined) throw new Error(`panel '${id}' was not exported`);
  const calls: { commandId: string; args: JsonValue | undefined }[] = [];
  const listeners = new Set<(props: JsonValue | undefined) => void>();
  const controller = new AbortController();
  const container =
    options.container ?? doc.body.appendChild(doc.createElement('div'));
  await panel.mount(container, {
    panelId: id,
    props: options.props,
    signal: controller.signal,
    call: async (commandId, args) => {
      calls.push({ commandId, args });
      if (options.call === undefined) {
        throw new Error(`command '${commandId}' is not available in this test`);
      }
      return options.call(commandId, args);
    },
    onProps: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  });
  return {
    container,
    calls,
    get aborted() {
      return controller.signal.aborted;
    },
    setProps: (props) => {
      for (const listener of [...listeners]) listener(props);
    },
    dispose: () => {
      controller.abort();
      if (options.container === undefined) container.remove();
    },
  };
};
