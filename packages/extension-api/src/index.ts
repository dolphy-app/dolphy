/**
 * Public extension API. The package depends on neither the engine nor the DOM: it is imported
 * by extension code (`main.mjs`), by the answer element (`view.mjs`), and by the engine itself.
 */

export const EXTENSION_API_VERSION = 1 as const;
export const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
/** GitHub login of the extension author (`author` in the manifest and catalog). */
export const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** Capabilities an extension declares in its manifest; none without a declaration. */
export const EXTENSION_PERMISSIONS = [
  'library.read',
  'process.spawn',
  'worker.threads',
  'native.addons',
  'network',
  'learning.events',
] as const;
export type ExtensionPermission = (typeof EXTENSION_PERMISSIONS)[number];
/** Platforms the extension can run on (`process.platform`). */
export const EXTENSION_PLATFORMS = ['darwin', 'linux', 'win32'] as const;
export type ExtensionPlatform = (typeof EXTENSION_PLATFORMS)[number];

/** Closed vocabulary of extension tags (`extension.json` → `tags`, up to 5 unique values). */
export const EXTENSION_TAGS = [
  'learning',
  'language',
  'content',
  'theme',
  'interface',
  'productivity',
  'developer',
] as const;
export type ExtensionTag = (typeof EXTENSION_TAGS)[number];
export const ELEMENT_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

/** Event names of the answer custom element. */
export const ANSWER_EVENT = {
  change: 'dolphy-answer-change',
  submit: 'dolphy-answer-submit',
} as const;

export interface AnswerChangeDetail {
  value: unknown;
  /** The answer can be submitted for checking. */
  complete: boolean;
}

/** Properties the app sets on the answer element. */
export interface AnswerElementProps {
  /** Result of `project()`. */
  view: unknown;
  /** Current answer (for restoring). */
  value: unknown;
  disabled: boolean;
  verdict: {
    outcome: 'passed' | 'failed' | 'error';
    reason?: string;
    feedback?: string;
    data?: unknown;
  } | null;
}

export type JsonSchema = Record<string, unknown>;

export interface ExerciseTypeContribution {
  /** Equal to the extension id or starts with `<extension id>.`. */
  id: string;
  /** JSON Schema 2020-12 for `engine.exercise.spec`: a path inside the extension directory (`./schema/spec.json`) or a schema object. */
  specSchema: string | JsonSchema;
  /** JSON Schema 2020-12 for the learner's answer (`submitAnswer.answer`): a path or a schema object. */
  answerSchema: string | JsonSchema;
  /** Tag of the custom element (a hyphen is required) that renders the answer input. */
  element: string;
  /** Path to the ES module that defines the element (`./view.mjs`). */
  renderer: string;
}

/** A theme added by an extension: data only, no code. */
export interface ThemeContribution {
  /** Equal to the extension id or starts with `<extension id>.`; not in `BUILTIN_THEME_IDS`. */
  id: string;
  /** Tile title in "Settings → Appearance", up to 60 characters. */
  label: string;
  dark: boolean;
  /** Keys from `THEME_COLOR_KEYS`; values are `#rrggbb` or `#rrggbbaa`. */
  colors: Record<string, string>;
  /** Keys from `THEME_VARIABLE_KEYS`: `border-color` is a color, the rest are numbers 0..1. */
  variables?: Record<string, string | number>;
}

/** Content renderer: ` ```<language> ` blocks are rendered by the extension module. */
export interface MarkdownRendererContribution {
  /** Code block language: `[a-z][a-z0-9-]{0,31}`. */
  language: string;
  /** Path to the ES module; always set in the normalized manifest. */
  renderer?: string;
}

/** Extension command: a command-palette action executed by extension code (`ctx.commands.register`). */
export interface CommandContribution {
  /** Equal to the extension id or starts with `<extension id>.`. */
  id: string;
  /** Title in the palette, 1–60 characters. */
  title: string;
  /** Up to 200 characters. */
  description?: string;
  /** Palette group, up to 40 characters. */
  category?: string;
  /** Hint such as `Mod+Shift+L` (`KEYBINDING_PATTERN`); the app does not bind the key. */
  keybinding?: string;
  /** `false` hides the command from the palette while keeping it available to the panel; defaults to `true`. */
  palette?: boolean;
}

/** Extension panel: an app screen in an isolated frame with a sidebar menu entry. */
export interface PanelContribution {
  /** Equal to the extension id or starts with `<extension id>.`. */
  id: string;
  /** Menu entry and page heading title, 1–60 characters. */
  title: string;
  /** Path to the panel's ES module (`.js` or `.mjs`); defaults to `DEFAULT_PANEL`. */
  module?: string;
}

/** Value of an extension setting. */
export type SettingValue = boolean | string | number;

interface SettingContributionBase {
  /** Equal to the extension id or starts with `<extension id>.`. */
  id: string;
  /** Field label in the settings dialog, up to 60 characters; extension data, not translated. */
  label: string;
  /** Help text under the field, up to 500 characters. */
  description?: string;
}

export interface BooleanSettingContribution extends SettingContributionBase {
  type: 'boolean';
  default: boolean;
}

export interface StringSettingContribution extends SettingContributionBase {
  type: 'string';
  default: string;
  /** Length in UTF-16 code units, 1..10000; no key means unlimited (within 10000). */
  maxLength?: number;
}

export interface NumberSettingContribution extends SettingContributionBase {
  type: 'number';
  default: number;
  min?: number;
  max?: number;
  /** Integer values only. */
  integer?: boolean;
}

export interface EnumSettingOption {
  value: string;
  label: string;
}

export interface EnumSettingContribution extends SettingContributionBase {
  type: 'enum';
  /** One of `options[].value`. */
  default: string;
  options: EnumSettingOption[];
}

/** A setting the user changes in "Settings → Extensions"; the app renders the form. */
export type SettingContribution =
  | BooleanSettingContribution
  | StringSettingContribution
  | NumberSettingContribution
  | EnumSettingContribution;

/** Learning events an extension with the `learning.events` permission can subscribe to. */
export const LEARNING_EVENT_NAMES = [
  'session.started',
  'session.finished',
  'attempt.closed',
] as const;
export type LearningEventName = (typeof LEARNING_EVENT_NAMES)[number];

/** Outcome of a closed attempt: `self-assessed` means the learner set the grade. */
export type AttemptOutcome = 'passed' | 'failed' | 'gave-up' | 'self-assessed';

/** Where the attempt's grade came from (the engine's full type). */
export type AttemptSource = 'self' | 'runner' | 'placement' | 'trane-import';

/**
 * Learning event fields: only identifiers, grade, and time — answers,
 * `spec`, feedback, and exercise text are not included. Matches
 * the engine's `LearningEventPayloads` (the package does not depend on the engine; the match is
 * checked by the `extension-host` test).
 */
export interface LearningEventPayloads {
  'session.started': { sessionId: string; at: number };
  'session.finished': { sessionId: string; at: number };
  'attempt.closed': {
    exerciseId: string;
    courseId: string;
    lessonId: string;
    grade: GradeValue;
    outcome: AttemptOutcome;
    /** `self` — the learner closed the attempt themselves, `runner` — by the runner's verdict; the event carries no other values. */
    source: AttemptSource;
    /** Unix epoch milliseconds. */
    at: number;
  };
}

/** An extension's subscription to a learning event (`contributes.events`). */
export interface EventContribution {
  event: LearningEventName;
}

/** Grading rule: how verdicts are turned into a 1–5 grade. */
export interface GradePolicyContribution {
  /** Equal to the extension id or starts with `<extension id>.`; not `passAtN`. */
  id: string;
  label: string;
}

/** Normalized manifest: all defaults applied. */
export interface ExtensionManifest {
  id: string;
  /** semver */
  version: string;
  apiVersion: typeof EXTENSION_API_VERSION;
  /** Path to the `.mjs` with the extension code; `null` means the extension needs no code. */
  main: string | null;
  /** Declared capabilities of the extension code; empty by default. */
  permissions: ExtensionPermission[];
  /** Human-readable name; `null` if not set. */
  name: string | null;
  description: string | null;
  /** GitHub login of the author; `null` if not set. */
  author: string | null;
  /** Empty means any platform. */
  platforms: readonly ExtensionPlatform[];
  /** Minimum app version (semver); `null` means any. */
  minAppVersion: string | null;
  /** Path of the icon inside the extension (`.png` or `.webp`, square, 64–512 px, up to 16 KiB); `null` — no icon. */
  icon: string | null;
  /** Explicit catalog tags (from `EXTENSION_TAGS`); empty — the catalog derives tags from contributions. */
  tags: ExtensionTag[];
  contributes: {
    exerciseTypes: ExerciseTypeContribution[];
    themes: ThemeContribution[];
    markdownRenderers: (MarkdownRendererContribution & {
      renderer: string;
    })[];
    gradePolicies: GradePolicyContribution[];
    settings: SettingContribution[];
    events: EventContribution[];
    commands: (CommandContribution & { palette: boolean })[];
    panels: (PanelContribution & { module: string })[];
  };
}

/** Kind of exercise in `extension.json`, as the author writes it. */
export interface ExerciseTypeContributionInput {
  id: string;
  specSchema: string | JsonSchema;
  answerSchema: string | JsonSchema;
  /** Defaults to `defaultElementName(id)`. */
  element?: string;
  /** Defaults to `DEFAULT_RENDERER`. */
  renderer?: string;
}

/** `extension.json` as the author writes it. */
export interface ExtensionManifestInput {
  id: string;
  version: string;
  apiVersion: typeof EXTENSION_API_VERSION;
  /** Defaults to `DEFAULT_MAIN` if contributions need code; otherwise `null`. */
  main?: string;
  permissions?: ExtensionPermission[];
  name?: string;
  description?: string;
  author?: string;
  /** No key means any platform. */
  platforms?: ExtensionPlatform[];
  minAppVersion?: string;
  /** Path of the extension icon (`.png` or `.webp`, square, 64–512 px, up to 16 KiB); no key — no icon. */
  icon?: string;
  /** Up to 5 unique catalog tags from `EXTENSION_TAGS`; no key — no explicit tags. */
  tags?: ExtensionTag[];
  contributes: {
    exerciseTypes?: ExerciseTypeContributionInput[];
    themes?: ThemeContribution[];
    markdownRenderers?: MarkdownRendererContribution[];
    gradePolicies?: GradePolicyContribution[];
    settings?: SettingContribution[];
    events?: EventContribution[];
    commands?: CommandContribution[];
    panels?: PanelContribution[];
  };
}

/** Identifiers of built-in themes: extensions cannot take them. */
export const BUILTIN_THEME_IDS = ['system', 'light', 'dark'] as const;

/** Allowed keys of `ThemeContribution.colors`. */
export const THEME_COLOR_KEYS: readonly string[] = [
  'background',
  'surface',
  'surface-bright',
  'surface-light',
  'surface-variant',
  'on-background',
  'on-surface',
  'on-surface-variant',
  'primary',
  'on-primary',
  'secondary',
  'on-secondary',
  'error',
  'on-error',
  'warning',
  'on-warning',
  'success',
  'on-success',
  'info',
  'on-info',
  'hero-start',
  'hero-end',
  'hero-contrast',
];

/** Allowed keys of `ThemeContribution.variables`. */
export const THEME_VARIABLE_KEYS: readonly string[] = [
  'border-color',
  'border-opacity',
  'medium-emphasis-opacity',
  'high-emphasis-opacity',
  'disabled-opacity',
];

export const DEFAULT_MARKDOWN_RENDERER = './markdown.mjs';
export const DEFAULT_PANEL = './panel.mjs';

/**
 * Command key hint: up to three modifiers (`Mod`, `Ctrl`, `Alt`,
 * `Shift`) and a key joined with `+`: a letter or digit, `F1`–`F12`, or a name
 * (`Enter`, `Space`, `Tab`, `Escape`, `Backspace`, `Delete`, arrows,
 * `Home`, `End`, `PageUp`, `PageDown`).
 */
export const KEYBINDING_PATTERN =
  /^(?:(?:Mod|Ctrl|Alt|Shift)\+){0,3}(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Enter|Space|Tab|Escape|Backspace|Delete|Arrow(?:Up|Down|Left|Right)|Home|End|Page(?:Up|Down))$/;

/** Limits on commands and panels (R1, R3); they match those checked by the manifest, host, and engine. */
export const EXTENSION_COMMAND_LIMITS = Object.freeze({
  /** Commands per extension. */
  commands: 64,
  /** Panels per extension. */
  panels: 8,
  titleLength: 60,
  categoryLength: 40,
  descriptionLength: 200,
  /** `JSON.stringify(args).length` at the engine boundary. */
  argsChars: 200_000,
  /** JSON text of the result in UTF-8 bytes. */
  resultBytes: 64 * 1024,
  /** Length of `notify` in UTF-16 code units. */
  notifyChars: 500,
  /** Handler budget, ms. */
  handlerMs: 10_000,
});

export type GradeValue = 1 | 2 | 3 | 4 | 5;

/** Grading rule input: the attempt's verdicts and a "gave up" flag. */
export interface GradePolicyInput {
  verdicts: readonly {
    outcome: 'passed' | 'failed' | 'error';
    reason?: string;
  }[];
  gaveUp: boolean;
}

/** `null` means the rule does not set a grade. */
export type GradePolicyHandler = (
  input: GradePolicyInput,
) => GradeValue | null | Promise<GradeValue | null>;

/** Block rendering context; a structural `AbortSignal` (the package has no DOM types). */
export interface MarkdownRenderContext {
  language: string;
  signal: {
    readonly aborted: boolean;
    addEventListener(type: 'abort', listener: () => void): void;
  };
}

/** `export default` of a content renderer module. */
export interface MarkdownRendererModule<Container = unknown> {
  render(
    source: string,
    container: Container,
    context: MarkdownRenderContext,
  ): void | Promise<void>;
}

/** What a command handler asks the app to do: show a notification. */
export interface NotifyEffect {
  notify: string;
}

/** What a command handler asks the app to do: open its own panel. */
export interface OpenPanelEffect {
  openPanel: string;
  props?: JsonValue;
}

export type CommandEffect = NotifyEffect | OpenPanelEffect;

/**
 * Result of a command handler: nothing (`undefined`), an effect for the app
 * (`CommandEffect`; an object with `notify`/`openPanel` cannot carry other
 * keys), or any JSON reply to the caller.
 */
export type CommandResult = void | undefined | CommandEffect | JsonValue;

/** `args` is the caller's JSON; `undefined` when there are no arguments. */
export type CommandHandler = (
  args: JsonValue | undefined,
) => CommandResult | Promise<CommandResult>;

/** Command result as the caller receives it (`normalizeCommandResult`). */
export type CommandOutcome =
  | { kind: 'none' }
  | { kind: 'notify'; text: string }
  | { kind: 'openPanel'; panelId: string; props?: JsonValue }
  | { kind: 'data'; value: JsonValue };

/** The handler's result is unusable: not JSON, over the limit, a mixed effect, or a foreign panel. */
export class InvalidCommandResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCommandResultError';
  }
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** String length in UTF-8 bytes (the package has no DOM types or `TextEncoder`); a `JSON.stringify` string contains no lone surrogates. */
const utf8Length = (text: string): number => {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
};

/**
 * Converts what a command handler returned into a `CommandOutcome`: the host's rules
 * and the SDK's `loadCommands` are the same. `undefined` and `null` are `none`; an object with
 * `notify` (a string of 1–500 characters) or `openPanel` (a panel id from `panels`;
 * `undefined` means any string, for tests without a manifest) and
 * no other keys (except `props` on `openPanel`) is an effect; any other JSON is
 * `data`. The value goes through JSON (`undefined` fields are dropped); its
 * text is at most `EXTENSION_COMMAND_LIMITS.resultBytes`. A violation throws
 * `InvalidCommandResultError`.
 */
export const normalizeCommandResult = (
  raw: unknown,
  panels: readonly string[] | undefined,
): CommandOutcome => {
  if (raw === undefined || raw === null) return { kind: 'none' };
  let text: string | undefined;
  try {
    text = JSON.stringify(raw);
  } catch (error) {
    throw new InvalidCommandResultError(
      `result is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (text === undefined) {
    throw new InvalidCommandResultError('result is not JSON');
  }
  if (utf8Length(text) > EXTENSION_COMMAND_LIMITS.resultBytes) {
    throw new InvalidCommandResultError(
      `result is longer than ${EXTENSION_COMMAND_LIMITS.resultBytes} bytes`,
    );
  }
  const value = JSON.parse(text) as JsonValue;
  if (value === null) return { kind: 'none' };
  if (!isPlainRecord(value) || !('notify' in value || 'openPanel' in value)) {
    return { kind: 'data', value };
  }
  const keys = Object.keys(value);
  if ('notify' in value) {
    if (keys.length > 1) {
      throw new InvalidCommandResultError(
        "a result with 'notify' must not have other keys",
      );
    }
    const { notify } = value;
    if (
      typeof notify !== 'string' ||
      notify.length < 1 ||
      notify.length > EXTENSION_COMMAND_LIMITS.notifyChars
    ) {
      throw new InvalidCommandResultError(
        `notify must be a string of 1..${EXTENSION_COMMAND_LIMITS.notifyChars} characters`,
      );
    }
    return { kind: 'notify', text: notify };
  }
  const { openPanel, props } = value;
  if (keys.some((key) => key !== 'openPanel' && key !== 'props')) {
    throw new InvalidCommandResultError(
      "a result with 'openPanel' may only have 'props' besides it",
    );
  }
  if (
    typeof openPanel !== 'string' ||
    (panels !== undefined && !panels.includes(openPanel))
  ) {
    throw new InvalidCommandResultError(
      `openPanel must name a panel declared by this extension, got ${JSON.stringify(openPanel)}`,
    );
  }
  return props === undefined
    ? { kind: 'openPanel', panelId: openPanel }
    : { kind: 'openPanel', panelId: openPanel, props };
};

/**
 * Context of a panel module; it runs in a frame without access to the app's
 * data. `Commands` narrows the ids `call` accepts (the SDK passes the commands
 * declared in `extension.json`).
 */
export interface PanelContext<Commands extends string = string> {
  panelId: string;
  /** Properties the panel was opened with (`openPanel(id, props)`); `undefined` — none. */
  props: JsonValue | undefined;
  /** Aborted when the frame closes. */
  signal: {
    readonly aborted: boolean;
    addEventListener(type: 'abort', listener: () => void): void;
  };
  /**
   * Calls a command this extension declares (including `palette: false`
   * ones); at most 20 calls per second and 4 at a time. Resolves to the JSON
   * answer of the handler (`undefined` — no answer); the app runs `notify` and
   * `openPanel` itself. A failure is a rejected promise with an `Error`.
   */
  call(commandId: Commands, args?: JsonValue): Promise<JsonValue | undefined>;
  /** Subscribes to new properties of the open panel; returns the unsubscribe function. */
  onProps(listener: (props: JsonValue | undefined) => void): () => void;
}

/** `export default` of a panel module. */
export interface PanelModule<
  Container = unknown,
  Commands extends string = string,
> {
  mount(
    container: Container,
    context: PanelContext<Commands>,
  ): void | Promise<void>;
}

export const DEFAULT_MAIN = './main.mjs';
export const DEFAULT_RENDERER = './view.mjs';

/** Default element tag: `dolphy.sql` → `dolphy-sql-answer`. */
export const defaultElementName = (id: string): string =>
  `${id.replaceAll('.', '-')}-answer`;

export type GradeResult =
  | { outcome: 'passed'; feedback?: string; data?: unknown }
  | {
      outcome: 'failed';
      reason: string;
      feedback?: string;
      detail?: string;
      data?: unknown;
    }
  | { outcome: 'error'; reason: string; feedback?: string; data?: unknown };

export interface GradeRequest<Spec = unknown, Answer = unknown> {
  exerciseId: string;
  spec: Spec;
  answer: Answer;
  timeoutMs: number;
  authorMode: boolean;
}

export interface ExerciseTypeHandler<
  Spec = unknown,
  Answer = unknown,
  View = unknown,
> {
  /** Public view for the answer element; secrets (answer keys) are excluded. Called on `beginAttempt`. */
  project(request: { exerciseId: string; spec: Spec }): View | Promise<View>;
  grade(
    request: GradeRequest<Spec, Answer>,
  ): GradeResult | Promise<GradeResult>;
  /** Reference answer for compiler checking (`E_REFERENCE_FAILS`); `undefined` means there is none. */
  referenceAnswer?(request: {
    exerciseId: string;
    spec: Spec;
  }): Answer | undefined | Promise<Answer | undefined>;
}

export interface LibraryStat {
  kind: 'file' | 'directory';
  bytes: number;
  mtimeMs: number;
  ctimeMs?: number;
  ino?: number;
  outsideRoot?: true;
  realPath?: string;
}

/** Course library read access (paths relative to the library root, separator `/`). */
export interface LibraryReader {
  readText(path: string): Promise<string>;
  stat(path: string): Promise<LibraryStat | null>;
}

/** Thrown when an extension calls a capability without the declared permission. */
export class PermissionError extends Error {
  readonly permission: ExtensionPermission;
  readonly code = 'EXT_PERMISSION';
  constructor(permission: ExtensionPermission, message?: string) {
    super(
      message ??
        `permission '${permission}' is not declared in the extension manifest`,
    );
    this.name = 'PermissionError';
    this.permission = permission;
  }
}

/** Extension storage limits (R2); they match the engine's limits, which enforces them. */
export const EXTENSION_STORAGE_LIMITS = Object.freeze({
  /** Key length in UTF-16 code units. */
  keyLength: 128,
  /** JSON text of a single value in UTF-8 bytes. */
  valueBytes: 64 * 1024,
  /** Number of keys. */
  keys: 256,
  /** Sum of JSON texts of all values in UTF-8 bytes. */
  totalBytes: 1024 * 1024,
});

/** Which storage limit was exceeded. */
export type StorageQuotaKind =
  'key-length' | 'value-size' | 'key-count' | 'total-size';

/** Thrown by `ctx.storage.set` when a write exceeds a limit: the write did not happen, other data is unchanged. */
export class StorageQuotaError extends Error {
  readonly kind: StorageQuotaKind;
  /** Exceeded limit: characters, bytes, or key count — per `kind`. */
  readonly limit: number;
  readonly code = 'EXT_STORAGE_QUOTA';
  constructor(kind: StorageQuotaKind, limit: number, message?: string) {
    super(message ?? `extension storage quota exceeded: ${kind} (${limit})`);
    this.name = 'StorageQuotaError';
    this.kind = kind;
    this.limit = limit;
  }
}

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * Extension data storage: JSON under string keys. Each extension has
 * its own space; data survives restart, update, and disabling.
 * No permission is required; limits are `EXTENSION_STORAGE_LIMITS`.
 */
export interface ExtensionStorage {
  get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined>;
  /** Exceeding a limit throws `StorageQuotaError` and the write does not happen. */
  set(key: string, value: JsonValue): Promise<void>;
  /** `false` if the key did not exist. */
  delete(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
}

/** Setting values of an extension by setting id. */
export type SettingValues = Record<string, SettingValue>;

/**
 * A change of a setting value: by the user, "Reset" or "Clear data". With
 * known `S` it is a union over the setting ids, so `id` narrows `value`.
 */
export type SettingChange<S extends SettingValues = SettingValues> = {
  [K in keyof S & string]: {
    id: K;
    /** The effective value. */
    value: S[K];
  };
}[keyof S & string];

/** Settings of the extension (`contributes.settings`); `S` maps declared setting ids to value types. */
export interface ExtensionSettings<S extends SettingValues = SettingValues> {
  /** The current value or the `default`; an `id` the manifest does not declare throws. */
  get<K extends keyof S & string>(id: K): S[K];
  /** The handler runs after a change, without restarting the extension; a handler failure is only logged. */
  onDidChange(handler: (change: SettingChange<S>) => void): Disposable;
}

export type LearningEventHandler<N extends LearningEventName> = (
  payload: LearningEventPayloads[N],
) => void | Promise<void>;

/** Learning events; need the `learning.events` permission and the event declared in `contributes.events`. `N` narrows the event names. */
export interface ExtensionEvents<
  N extends LearningEventName = LearningEventName,
> {
  /**
   * One handler per event. Delivery is asynchronous, in order, at most once;
   * 2 s per handler; a failure is only logged.
   */
  on<E extends N>(name: E, handler: LearningEventHandler<E>): Disposable;
}

/** Commands of the extension (`contributes.commands`); `Id` narrows the command ids. */
export interface ExtensionCommands<Id extends string = string> {
  /**
   * `id` must be declared in the `commands` of this extension's manifest,
   * otherwise it throws; registering twice throws. The handler runs for at
   * most `EXTENSION_COMMAND_LIMITS.handlerMs`; a failure or an exceeded
   * budget reaches the caller as an error.
   */
  register(id: Id, handler: CommandHandler): Disposable;
}

export interface Disposable {
  dispose(): void | Promise<void>;
}

/** Matches the `Logger` port of the engine in methods and signatures. */
export interface ExtensionLogger {
  debug(fields: object, message?: string): void;
  info(fields: object, message?: string): void;
  warn(fields: object, message?: string): void;
  error(fields: object, message?: string): void;
}

/**
 * The ids an extension declares in `extension.json`, by kind. The defaults are
 * plain strings; the SDK narrows them to the declared ids (see `ExtensionIds`
 * in `@dolphy-app/extension-sdk`).
 */
export interface ExtensionIdSet {
  exerciseTypes: string;
  gradePolicies: string;
  commands: string;
  events: LearningEventName;
  panels: string;
  /** Languages of `contributes.markdownRenderers`. */
  markdownLanguages: string;
  /** Setting id → type of its value. */
  settings: SettingValues;
}

/** `Ids` narrows what the context accepts to the ids the manifest declares. */
export interface ExtensionContext<Ids extends ExtensionIdSet = ExtensionIdSet> {
  readonly extensionId: string;
  readonly logger: ExtensionLogger;
  readonly library: LibraryReader;
  readonly storage: ExtensionStorage;
  readonly settings: ExtensionSettings<Ids['settings']>;
  readonly events: ExtensionEvents<Ids['events']>;
  readonly commands: ExtensionCommands<Ids['commands']>;
  /** `type` must be declared in the manifest of this extension, otherwise it throws. */
  registerExerciseType(
    type: Ids['exerciseTypes'],
    handler: ExerciseTypeHandler,
  ): Disposable;
  /** `id` must be declared in `gradePolicies` of this extension's manifest, otherwise it throws. */
  registerGradePolicy(
    id: Ids['gradePolicies'],
    handler: GradePolicyHandler,
  ): Disposable;
}

export interface ExtensionModule {
  activate(context: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
