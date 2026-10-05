/**
 * Public extension API. The package depends on neither the engine nor the DOM: it is imported
 * by extension code (`main.mjs`), by the answer element (`view.mjs`), and by the engine itself.
 */

export * from './locale.ts';

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
  'learning.stats',
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
  /** Name shown on the contribution chip, 1–60 characters; without it the id is shown. */
  title?: string;
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
  /** Name shown on the contribution chip, 1–60 characters; without it the language is shown. */
  title?: string;
  /** Path to the ES module; always set in the normalized manifest. */
  renderer?: string;
}

/** Command key binding (`commands[].keybindings`). */
export interface CommandKeybinding {
  /** Key notation such as `Mod+Shift+L` or `Mod+K Mod+S`; valid on every platform. */
  key: string;
  /** Replaces `key` on macOS. */
  mac?: string;
  /** Replaces `key` on Windows. */
  windows?: string;
  /** Replaces `key` on Linux. */
  linux?: string;
  /** Condition such as `page == 'settings'`; a key that types text needs one inactive while `inputFocus`. */
  when?: string;
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
  /** Active binding without a condition, such as `Mod+Shift+L` (`KEYBINDING_PATTERN`); needs `palette: true`. */
  keybinding?: string;
  /** Up to `EXTENSION_COMMAND_LIMITS.keybindingsPerCommand` bindings; needs `palette: true`. The user may replace them in settings. */
  keybindings?: CommandKeybinding[];
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

/** What an importer accepts: `text` hands the handler the file as a UTF-8 string, `bytes` as a `Uint8Array`. */
export type ImporterInputKind = 'text' | 'bytes';

/** Extension importer: turns a file the user picked into a course directory (`ctx.importers.register`). */
export interface ImporterContribution {
  /** Equal to the extension id or starts with `<extension id>.`. */
  id: string;
  /** Name in the command palette and the library card, 1–60 characters. */
  title: string;
  /** 1–`EXTENSION_TRANSFER_LIMITS.acceptExtensions` unique file extensions in lower case, such as `.csv` (`TRANSFER_ACCEPT_PATTERN`). */
  accept: string[];
  /** Defaults to `text`. */
  input?: ImporterInputKind;
}

/** What an exporter hands the extension: a course snapshot or aggregated progress. */
export type ExporterScope = 'course' | 'progress';

/** Extension exporter: turns a course or the learning progress into a file the user saves (`ctx.exporters.register`). */
export interface ExporterContribution {
  /** Equal to the extension id or starts with `<extension id>.`. */
  id: string;
  /** Name in the command palette and the library card, 1–60 characters. */
  title: string;
  /** `progress` needs the `learning.stats` permission. */
  scope: ExporterScope;
}

/** Value of an extension setting. */
export type SettingValue = boolean | string | number | string[];

/** Shows a setting only while another setting of the same extension has the value `equals`. */
export interface SettingVisibleWhen {
  /** Id of a setting of the same extension: not itself, not a `list`, and one without its own `visibleWhen` (no chains). */
  setting: string;
  /** Value of the target setting; its type must match the target (`boolean`, `number`, or a string). */
  equals: boolean | string | number;
}

interface SettingContributionBase {
  /** Equal to the extension id or starts with `<extension id>.`. */
  id: string;
  /** Field label in the settings dialog, up to 60 characters; extension data, not translated. */
  label: string;
  /** Help text under the field, up to 500 characters. */
  description?: string;
  /** Section title in the settings dialog, 1–60 characters; settings without it come first, with no title. */
  group?: string;
  /** Sort key in the form, an integer 0–1000; default 0, ties keep the declaration order. */
  order?: number;
  /** The field is hidden while the condition is false; the hidden value is kept and still reaches the code. */
  visibleWhen?: SettingVisibleWhen;
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

/** A multi-line string. */
export interface TextSettingContribution extends SettingContributionBase {
  type: 'text';
  default: string;
  /** Length in UTF-16 code units, 1..10000; no key means unlimited (within 10000). */
  maxLength?: number;
}

/** A color `#rrggbb`; the stored value is lower-case. */
export interface ColorSettingContribution extends SettingContributionBase {
  type: 'color';
  /** `#rrggbb`. */
  default: string;
}

/** A list of strings; the code receives `string[]`. */
export interface ListSettingContribution extends SettingContributionBase {
  type: 'list';
  default: string[];
  /** Most items, 1..50; default 50. */
  maxItems?: number;
  /** Longest item in UTF-16 code units, 1..200; default 200. */
  itemMaxLength?: number;
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
  | TextSettingContribution
  | ColorSettingContribution
  | ListSettingContribution
  | NumberSettingContribution
  | EnumSettingContribution;

/** Limits of the settings types (`text`, `color`, `list`, `group`, `order`); they match those checked by the manifest and the engine. */
export const SETTING_LIMITS = Object.freeze({
  /** `maxLength` of `string` and `text`. */
  stringLength: 10_000,
  /** `maxItems` of `list`. */
  listItems: 50,
  /** `itemMaxLength` of `list`. */
  listItemLength: 200,
  groupLength: 60,
  orderMax: 1000,
});

/** `#rrggbb` (any case in the manifest; the stored value is lower-case). */
export const COLOR_SETTING_PATTERN = /^#[0-9a-fA-F]{6}$/;

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
    importers: (ImporterContribution & { input: ImporterInputKind })[];
    exporters: ExporterContribution[];
  };
}

/** Kind of exercise in `extension.json`, as the author writes it. */
export interface ExerciseTypeContributionInput {
  id: string;
  /** Name shown on the contribution chip, 1–60 characters. */
  title?: string;
  specSchema: string | JsonSchema;
  answerSchema: string | JsonSchema;
  /** Defaults to `defaultElementName(id)`. */
  element?: string;
  /** Defaults to `DEFAULT_RENDERER`. */
  renderer?: string;
}

/** `extension.json` as the author writes it. */
export interface ExtensionManifestInput {
  /** Path or URL of `extension.schema.json` for editors; ignored by the app and the tools. */
  $schema?: string;
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
    importers?: ImporterContribution[];
    exporters?: ExporterContribution[];
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

const KEYBINDING_MODIFIER =
  '(?:Mod|Ctrl|Control|Alt|Option|Shift|Cmd|Command|Meta|Win|Super)\\+';
const KEYBINDING_KEY =
  "(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Enter|Return|Space|Tab|Escape|Esc|Backspace|Delete|Insert|Arrow(?:Up|Down|Left|Right)|Home|End|Page(?:Up|Down)|Plus|\\[[A-Za-z][A-Za-z0-9]*\\]|[`\\-=\\[\\]\\\\;',./+])";
const KEYBINDING_STROKE = `(?:${KEYBINDING_MODIFIER}){0,3}${KEYBINDING_KEY}`;

/**
 * Key notation: one stroke or two strokes separated by a space
 * (`Mod+K Mod+S`). A stroke is up to three modifiers (`Mod`, `Ctrl`, `Alt`,
 * `Shift`, `Cmd`, `Meta`, `Win`, `Super`, `Option`, ...) and a key joined with
 * `+`: a letter or digit, `F1`–`F24`, a punctuation mark, a physical key
 * (`[KeyK]`) or a name (`Enter`, `Space`, `Tab`, `Escape`, `Insert`, arrows,
 * `Home`, `End`, `PageUp`, `PageDown`). A superset for the JSON Schema; the
 * host validates every string authoritatively with `@dolphy-app/keybindings`.
 */
export const KEYBINDING_PATTERN = new RegExp(
  `^${KEYBINDING_STROKE}(?: ${KEYBINDING_STROKE})?$`,
);

/** Limits on commands and panels (R1, R3); they match those checked by the manifest, host, and engine. */
export const EXTENSION_COMMAND_LIMITS = Object.freeze({
  /** Keybinding entries (`keybindings`) per command. */
  keybindingsPerCommand: 4,
  /** Length of a `keybindings[].when` condition. */
  whenLength: 200,
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

/** A file extension an importer accepts: a dot and 1–16 lower-case letters or digits. */
export const TRANSFER_ACCEPT_PATTERN = /^\.[a-z0-9]{1,16}$/;

/** Limits on importers and exporters; the manifest, host, and engine check the same numbers. */
export const EXTENSION_TRANSFER_LIMITS = Object.freeze({
  /** Importers per extension. */
  importers: 8,
  /** Exporters per extension. */
  exporters: 8,
  /** Entries in `accept` of one importer. */
  acceptExtensions: 8,
  /** Handler budget, ms (import and export). */
  handlerMs: 30_000,
  /** Size of the file the user picks for an importer, bytes. */
  inputBytes: 20 * 1024 * 1024,
  /** Files in the directory an importer returns. */
  files: 5000,
  /** One file of the returned directory, UTF-8 bytes. */
  fileBytes: 2 * 1024 * 1024,
  /** All files of the returned directory (and of a course snapshot), UTF-8 bytes. */
  totalBytes: 20 * 1024 * 1024,
  /** Size of the file an exporter returns, bytes. */
  outputBytes: 20 * 1024 * 1024,
  /** Length of the file name an exporter returns. */
  filenameChars: 120,
  /** One path of the returned directory, UTF-8 bytes. */
  pathBytes: 1024,
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

/** What a `text` importer handler receives: the picked file's base name and its content as a UTF-8 string. */
export interface TextImportInput {
  name: string;
  text: string;
}

/** What a `bytes` importer handler receives: the picked file's base name and its content. */
export interface BytesImportInput {
  name: string;
  bytes: Uint8Array;
}

/** What an importer handler receives: the picked file's base name and its content, as the importer's `input` declares. */
export type ImportInput = TextImportInput | BytesImportInput;

/**
 * What an importer handler returns: the files of a new course directory.
 * Paths are relative, use `/`, and have no `..`, empty, or dot-leading
 * segments and no case-insensitive duplicates; the files are text. At most
 * `EXTENSION_TRANSFER_LIMITS.files` files, `fileBytes` each, `totalBytes` in all.
 */
export interface ImportResult {
  files: Record<string, string>;
}

/**
 * Importer handler. Written as a method type so that a handler of a `text`
 * importer may declare `(input: TextImportInput)` and one of a `bytes` importer
 * `(input: BytesImportInput)`; the host passes the form the manifest declares.
 */
export type ImporterHandler = {
  handle(input: ImportInput): ImportResult | Promise<ImportResult>;
}['handle'];

/** What a `course` exporter handler receives: the text files of the course directory (up to `EXTENSION_TRANSFER_LIMITS.totalBytes`). */
export interface CourseExportInput {
  scope: 'course';
  courseId: string;
  title: string;
  /** Path relative to the course directory → content. */
  files: Record<string, string>;
}

/** What a `progress` exporter handler receives; it reads the data through `ctx.stats`. */
export interface ProgressExportInput {
  scope: 'progress';
}

export type ExportInput = CourseExportInput | ProgressExportInput;

/**
 * What an exporter handler returns: the file to save. `filename` has no path
 * separators and at most `EXTENSION_TRANSFER_LIMITS.filenameChars`
 * characters; the content is at most `outputBytes`.
 */
export type ExportResult =
  { filename: string; text: string } | { filename: string; bytes: Uint8Array };

/**
 * Exporter handler. Written as a method type so that a handler of a `course`
 * exporter may declare `(input: CourseExportInput)` and one of a `progress`
 * exporter `(input: ProgressExportInput)`; the host passes the scope the
 * manifest declares.
 */
export type ExporterHandler = {
  handle(input: ExportInput): ExportResult | Promise<ExportResult>;
}['handle'];

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

/** String length in UTF-8 bytes (the package has no DOM types or `TextEncoder`); a lone surrogate counts as U+FFFD, as `TextEncoder` encodes it. */
const utf8Length = (text: string): number => {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 3;
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

/** The result of an importer or exporter handler is unusable: wrong shape, a bad path or file name, or over a limit. */
export class InvalidTransferResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransferResultError';
  }
}

/**
 * Why a path of an imported course directory is not allowed, or `null`. The
 * path is relative, uses `/`, and has no empty, `.`-leading (so no `..`)
 * segment, no backslash or control character, and at most
 * `EXTENSION_TRANSFER_LIMITS.pathBytes` UTF-8 bytes.
 */
export const findTransferPathProblem = (path: string): string | null => {
  if (path === '') return 'path is empty';
  if (utf8Length(path) > EXTENSION_TRANSFER_LIMITS.pathBytes) {
    return `path is longer than ${EXTENSION_TRANSFER_LIMITS.pathBytes} bytes`;
  }
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (/[\\\u0000-\u001f\u007f]/.test(path)) {
    return 'path has a backslash or a control character';
  }
  for (const segment of path.split('/')) {
    if (segment === '') return 'path has an empty segment';
    if (segment.startsWith('.')) {
      return `path segment '${segment}' starts with a dot`;
    }
  }
  return null;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

/**
 * Checks what an importer handler returned and returns a copy: an object with
 * only `files`, a record of path → text. At most `EXTENSION_TRANSFER_LIMITS.files`
 * files, `fileBytes` each and `totalBytes` in all (UTF-8); paths per
 * `findTransferPathProblem`, no two equal ignoring case. A violation throws
 * `InvalidTransferResultError`. The host, the app, and `loadImporters` share it.
 */
export const normalizeImportResult = (raw: unknown): ImportResult => {
  if (!isPlainObject(raw)) {
    throw new InvalidTransferResultError(
      "result must be an object like { files: { 'path': 'text' } }",
    );
  }
  const stray = Object.keys(raw).find((key) => key !== 'files');
  if (stray !== undefined) {
    throw new InvalidTransferResultError(`unexpected key '${stray}'`);
  }
  const { files } = raw;
  if (!isPlainObject(files)) {
    throw new InvalidTransferResultError('files must be an object');
  }
  const entries = Object.entries(files);
  if (entries.length > EXTENSION_TRANSFER_LIMITS.files) {
    throw new InvalidTransferResultError(
      `more than ${EXTENSION_TRANSFER_LIMITS.files} files`,
    );
  }
  const seen = new Map<string, string>();
  let total = 0;
  for (const [path, content] of entries) {
    const problem = findTransferPathProblem(path);
    if (problem !== null) {
      throw new InvalidTransferResultError(
        `${JSON.stringify(path)}: ${problem}`,
      );
    }
    const folded = path.toLowerCase();
    const clash = seen.get(folded);
    if (clash !== undefined) {
      throw new InvalidTransferResultError(
        `${JSON.stringify(path)} and ${JSON.stringify(clash)} differ only in case`,
      );
    }
    seen.set(folded, path);
    if (typeof content !== 'string') {
      throw new InvalidTransferResultError(
        `${JSON.stringify(path)}: content must be a string`,
      );
    }
    const size = utf8Length(content);
    if (size > EXTENSION_TRANSFER_LIMITS.fileBytes) {
      throw new InvalidTransferResultError(
        `${JSON.stringify(path)} is longer than ${EXTENSION_TRANSFER_LIMITS.fileBytes} bytes`,
      );
    }
    total += size;
    if (total > EXTENSION_TRANSFER_LIMITS.totalBytes) {
      throw new InvalidTransferResultError(
        `the files are longer than ${EXTENSION_TRANSFER_LIMITS.totalBytes} bytes in all`,
      );
    }
  }
  return { files: Object.fromEntries(entries) as Record<string, string> };
};

/**
 * Checks what an exporter handler returned and returns it: an object with
 * `filename` and exactly one of `text` (a string) or `bytes` (a `Uint8Array`),
 * at most `EXTENSION_TRANSFER_LIMITS.outputBytes` of content. The file name
 * is 1..`filenameChars` characters without `/`, `\`, or control characters,
 * and is not `.` or `..`. A violation throws `InvalidTransferResultError`.
 */
export const normalizeExportResult = (raw: unknown): ExportResult => {
  if (!isPlainObject(raw)) {
    throw new InvalidTransferResultError(
      'result must be an object like { filename, text } or { filename, bytes }',
    );
  }
  const { filename } = raw;
  const hasText = 'text' in raw;
  const hasBytes = 'bytes' in raw;
  const stray = Object.keys(raw).find(
    (key) => key !== 'filename' && key !== 'text' && key !== 'bytes',
  );
  if (stray !== undefined) {
    throw new InvalidTransferResultError(`unexpected key '${stray}'`);
  }
  if (hasText === hasBytes) {
    throw new InvalidTransferResultError(
      "result must have exactly one of 'text' and 'bytes'",
    );
  }
  if (
    typeof filename !== 'string' ||
    filename === '' ||
    filename.length > EXTENSION_TRANSFER_LIMITS.filenameChars
  ) {
    throw new InvalidTransferResultError(
      `filename must be a string of 1..${EXTENSION_TRANSFER_LIMITS.filenameChars} characters`,
    );
  }
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (/[/\\\u0000-\u001f\u007f]/.test(filename) || /^\.\.?$/.test(filename)) {
    throw new InvalidTransferResultError(
      'filename must not contain path separators or control characters',
    );
  }
  if (hasText) {
    const { text } = raw;
    if (typeof text !== 'string') {
      throw new InvalidTransferResultError('text must be a string');
    }
    if (utf8Length(text) > EXTENSION_TRANSFER_LIMITS.outputBytes) {
      throw new InvalidTransferResultError(
        `the file is longer than ${EXTENSION_TRANSFER_LIMITS.outputBytes} bytes`,
      );
    }
    return { filename, text };
  }
  const { bytes } = raw;
  if (!(bytes instanceof Uint8Array)) {
    throw new InvalidTransferResultError('bytes must be a Uint8Array');
  }
  if (bytes.byteLength > EXTENSION_TRANSFER_LIMITS.outputBytes) {
    throw new InvalidTransferResultError(
      `the file is longer than ${EXTENSION_TRANSFER_LIMITS.outputBytes} bytes`,
    );
  }
  return { filename, bytes };
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

/** Secret limits; the engine enforces them (`StorageQuotaError`, kinds `key-length`, `value-size`, `key-count`). */
export const EXTENSION_SECRET_LIMITS = Object.freeze({
  /** Key length in UTF-16 code units. */
  keyLength: 128,
  /** Value size in UTF-8 bytes. */
  valueBytes: 4 * 1024,
  /** Number of keys. */
  keys: 32,
});

/**
 * Thrown by `ctx.secrets.set` and by `ctx.secrets.get` of an existing key when
 * the operating system has no secure key store: no store, Linux `basic_text`
 * backend, the app is not ready yet, or the stored value cannot be decrypted
 * any more (the keychain changed; `delete` and write again).
 */
export class SecretsUnavailableError extends Error {
  readonly code = 'SECRETS_UNAVAILABLE';
  constructor(message?: string) {
    super(message ?? 'the system secret store is unavailable');
    this.name = 'SecretsUnavailable';
  }
}

/**
 * Secret strings (tokens, passwords) encrypted with the system key store.
 * No permission is required; each extension has its own space, cleared with
 * the extension data. Limits are `EXTENSION_SECRET_LIMITS`.
 */
export interface ExtensionSecrets {
  /** `undefined` if the key does not exist (also when the key store is unavailable). */
  get(key: string): Promise<string | undefined>;
  /** Throws `SecretsUnavailableError` without a key store, `StorageQuotaError` over a limit; the write does not happen then. */
  set(key: string, value: string): Promise<void>;
  /** `false` if the key did not exist. Works without a key store. */
  delete(key: string): Promise<boolean>;
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

/** Limits of `ctx.stats`; the engine enforces them. */
export const EXTENSION_STATS_LIMITS = Object.freeze({
  /** Most dates in one `daily` range (both ends included). */
  dailyDays: 366,
});

/** Study streak in days; see `ExtensionStats.streak`. */
export interface StreakStats {
  /** Consecutive days with attempts ending today, or yesterday while today has none yet. */
  readonly current: number;
  /** Longest run of consecutive days with attempts in the history. */
  readonly longest: number;
}

/** One local calendar day of study; see `ExtensionStats.daily`. */
export interface DailyStat {
  /** Local date `YYYY-MM-DD`. */
  readonly date: string;
  readonly attempts: number;
  /** Attempts graded 3 or higher. */
  readonly correct: number;
  /** `correct / attempts`; `null` without attempts. */
  readonly accuracy: number | null;
}

/**
 * Aggregated learning statistics; need the `learning.stats` permission, otherwise
 * every call rejects with `PermissionError('learning.stats')`. Numbers only: no
 * exercise or course identifiers, answers or content. Days are local days in
 * the user's time zone; an attempt is correct at grade 3 or higher; the
 * history counts attempts even after a progress reset. An unknown `courseId`
 * gives zeros.
 */
export interface ExtensionStats {
  streak(options?: { courseId?: string }): Promise<StreakStats>;
  /**
   * One entry for every date from `from` to `to` inclusive (`YYYY-MM-DD`, up to
   * `EXTENSION_STATS_LIMITS.dailyDays` dates); a malformed or reversed range
   * rejects.
   */
  daily(options: {
    from: string;
    to: string;
    courseId?: string;
  }): Promise<DailyStat[]>;
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

/** Importers of the extension (`contributes.importers`); `Id` narrows the importer ids. */
export interface ExtensionImporters<Id extends string = string> {
  /**
   * `id` must be declared in the `importers` of this extension's manifest,
   * otherwise it throws; registering twice throws. The handler runs for at
   * most `EXTENSION_TRANSFER_LIMITS.handlerMs`; a failure, an exceeded budget,
   * or a result `normalizeImportResult` refuses reaches the user as an error.
   */
  register(id: Id, handler: ImporterHandler): Disposable;
}

/** Exporters of the extension (`contributes.exporters`); `Id` narrows the exporter ids. */
export interface ExtensionExporters<Id extends string = string> {
  /**
   * `id` must be declared in the `exporters` of this extension's manifest,
   * otherwise it throws; registering twice throws. The handler runs for at
   * most `EXTENSION_TRANSFER_LIMITS.handlerMs`; a failure, an exceeded budget,
   * or a result `normalizeExportResult` refuses reaches the user as an error.
   */
  register(id: Id, handler: ExporterHandler): Disposable;
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
  importers: string;
  exporters: string;
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
  readonly secrets: ExtensionSecrets;
  readonly settings: ExtensionSettings<Ids['settings']>;
  readonly events: ExtensionEvents<Ids['events']>;
  /** Learning statistics; needs the `learning.stats` permission. */
  readonly stats: ExtensionStats;
  readonly commands: ExtensionCommands<Ids['commands']>;
  readonly importers: ExtensionImporters<Ids['importers']>;
  readonly exporters: ExtensionExporters<Ids['exporters']>;
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
