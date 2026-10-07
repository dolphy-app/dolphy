/**
 * Public extension API. At run time the package depends on neither the engine nor the DOM: it is imported
 * by the server part of an extension (`main.mjs`, entry `server`), by its client part (`client.mjs`, entry `client`) and by the engine itself.
 */

// `InjectionHandle.target` is a DOM `Element`; the directive gives the type to every
// package that compiles this file without a DOM lib in its own config
/// <reference lib="dom" />

import type { ZodType } from 'zod';
import type { LocalizedText } from './locale.ts';
import { WHEN_MAX_LENGTH } from './when.ts';

export * from './locale.ts';
export * from './when.ts';

export const EXTENSION_API_VERSION = 1 as const;
export const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
/** GitHub login of the extension author (`author` in the manifest and catalog). */
export const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
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

/** Verdict of the last check as the app hands it to an answer view. */
export interface AnswerVerdict {
  outcome: 'passed' | 'failed' | 'error';
  reason?: string;
  feedback?: string;
  data?: unknown;
}

/**
 * Props of an answer view: a Vue component the extension registers with
 * `client.addAnswerView(<exercise type id>, component)`. The component declares `emits: ['change',
 * 'submit']`: `change` carries an `AnswerChange`, `submit` asks the app to
 * check the answer.
 */
export interface AnswerViewProps<View = unknown, Answer = unknown> {
  /** Result of `project()`. */
  readonly view: View;
  /** Current answer (for restoring); `undefined` — none yet. */
  readonly value: Answer | undefined;
  readonly disabled: boolean;
  readonly verdict: AnswerVerdict | null;
  /** Accessible name of the input set by the app; `null` if none. */
  readonly label: string | null;
}

/** Payload of the `change` event of an answer view. */
export interface AnswerChange<Answer = unknown> {
  value: Answer;
  /** The answer can be submitted for checking. */
  complete: boolean;
}

/** Props of a content renderer: a Vue component the extension registers with `client.addMarkdownRenderer(<language>, component)`. */
export interface MarkdownBlockProps {
  /** Text of the ` ```<language> ` block. */
  readonly source: string;
  readonly language: string;
}

export type JsonSchema = Record<string, unknown>;

/** Key binding of a command (`keybindings` of a command registration). */
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

/**
 * Closed list of icon names an extension picks from (`icon` of a command or panel); the
 * app draws its own glyph for each name, so nothing from the extension is rendered as an image.
 */
export const EXTENSION_ICONS = [
  'puzzle',
  'book',
  'brain',
  'calendar',
  'chart',
  'check',
  'clock',
  'cog',
  'fire',
  'flag',
  'heart',
  'help',
  'home',
  'idea',
  'list',
  'message',
  'pencil',
  'play',
  'star',
  'target',
  'trophy',
  'bell',
  'bookmark',
  'tag',
] as const;
export type ExtensionIconName = (typeof EXTENSION_ICONS)[number];
/** Icon of a command or panel without `icon`. */
export const DEFAULT_EXTENSION_ICON: ExtensionIconName = 'puzzle';

/** Fields shared by a server command (`CommandRegistration`) and a client command (`ClientCommandRegistration`); the texts are at most `EXTENSION_COMMAND_LIMITS.titleLength`, `descriptionLength`, `categoryLength` characters. */
export interface CommandMetadata {
  /** Equal to the extension id or starts with `<extension id>.`; at most `EXTENSION_COMMAND_LIMITS.commands` commands per extension. */
  id: string;
  /** Title in the palette, 1–`EXTENSION_COMMAND_LIMITS.titleLength` characters. */
  title: LocalizedText;
  /** Up to `EXTENSION_COMMAND_LIMITS.descriptionLength` characters. */
  description?: LocalizedText;
  /** Palette group, up to `EXTENSION_COMMAND_LIMITS.categoryLength` characters. */
  category?: LocalizedText;
  /** Up to `EXTENSION_COMMAND_LIMITS.keybindingsPerCommand` bindings; needs `palette: true`. The user may replace them in settings. */
  keybindings?: readonly CommandKeybinding[];
  /** `false` hides the command from the palette while keeping it available to the panel; defaults to `true`. */
  palette?: boolean;
  /**
   * Visibility condition (see `parseWhen`), such as `route == 'courses'`. While it is false the
   * command is not shown in the palette and does not run from a key binding; the extension's
   * panels and injected components still call it.
   */
  when?: string;
  /** Glyph in the palette, from `EXTENSION_ICONS`; defaults to `DEFAULT_EXTENSION_ICON`. Decorative. */
  icon?: ExtensionIconName;
}

/** A command whose handler runs in the extension host (`server.registerCommand`): metadata and handler in one object. */
export interface CommandRegistration extends CommandMetadata {
  /**
   * Runs for at most `EXTENSION_COMMAND_LIMITS.handlerMs`; a failure or an
   * exceeded budget reaches the caller as an error.
   */
  run: CommandHandler;
}

/** A command whose handler runs in the app window (`client.addCommand`). */
export interface ClientCommandRegistration extends CommandMetadata {
  run: () => void | Promise<void>;
}

/** A panel: an app screen drawn by a Vue component of the extension, with a sidebar menu entry (`client.addPanel`); at most `EXTENSION_COMMAND_LIMITS.panels` per extension. */
export interface PanelRegistration {
  /** Equal to the extension id or starts with `<extension id>.`. */
  id: string;
  /** Menu entry and page heading title, 1–`EXTENSION_COMMAND_LIMITS.titleLength` characters. */
  title: LocalizedText;
  /** Glyph of the sidebar entry, from `EXTENSION_ICONS`; defaults to `DEFAULT_EXTENSION_ICON`. Decorative. */
  icon?: ExtensionIconName;
  /** Visibility condition (see `parseWhen`): while it is false the sidebar entry is hidden; the panel still opens with `openPanel`. */
  when?: string;
  /** The panel's Vue component (`unknown`: this package does not depend on Vue). */
  component: unknown;
}

/** Where an injected component goes relative to its target element. */
export const INJECTION_POSITIONS = [
  'before',
  'after',
  'prepend',
  'append',
] as const;
export type InjectionPosition = (typeof INJECTION_POSITIONS)[number];

/** Limits on injections; the app enforces them. */
export const INJECTION_LIMITS = Object.freeze({
  /** Characters in `InjectionRegistration.target`. */
  selectorLength: 200,
});

/** Attribute with which the app marks the stable places an extension can inject into. */
export const ANCHOR_ATTRIBUTE = 'data-ext-anchor';

/** Selector of the element the app marks with `data-ext-anchor="<id>"`. */
export const anchorSelector = (id: string): string =>
  `[${ANCHOR_ATTRIBUTE}="${id.replace(/["\\]/g, '\\$&')}"]`;

/**
 * A component an extension draws in the window next to or inside every element
 * that matches `target` (`client.addInjection`). The window watches the DOM:
 * the component is mounted when a target appears and removed when it goes away.
 */
export interface InjectionRegistration {
  /** Unique within the extension. */
  id: string;
  /**
   * CSS selector, 1–`INJECTION_LIMITS.selectorLength` characters, that
   * `document.querySelector` accepts. Prefer `anchorSelector(id)`: the app keeps
   * its anchors stable, any other selector depends on the app's markup.
   */
  target: string;
  /** Defaults to `append`. `before` and `after` put the component next to the target, `prepend` and `append` inside it. */
  position?: InjectionPosition;
  /** The Vue component (`unknown`: this package does not depend on Vue). */
  component: unknown;
}

/** How often a schedule fires. */
export const EXTENSION_SCHEDULE_EVERY = ['daily', 'hourly'] as const;
export type ExtensionScheduleEvery = (typeof EXTENSION_SCHEDULE_EVERY)[number];

/** `at` of a `daily` schedule: `HH:MM`, 24-hour clock, local time. */
export const SCHEDULE_AT_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Limits on schedules; the host, the scheduler, and the runtime enforce them. */
export const EXTENSION_SCHEDULE_LIMITS = Object.freeze({
  /** Schedules per extension. */
  schedules: 4,
  /** Handler budget, ms. */
  handlerMs: 10_000,
  /** A firing found later than this after its moment (the app was closed or asleep) is skipped, ms. */
  lateMs: 120_000,
  /** How often the app looks for due firings, ms. */
  tickMs: 30_000,
});

/**
 * A schedule: a handler the app runs at fixed local times
 * (`server.schedule`) while it is running. `daily` fires at `at`; `hourly` at
 * the start of every hour and takes no `at`. At most
 * `EXTENSION_SCHEDULE_LIMITS.schedules` per extension.
 */
export type ScheduleRegistration =
  | {
      /** Equal to the extension id or starts with `<extension id>.`. */
      id: string;
      every: 'daily';
      /** `HH:MM` local time (`SCHEDULE_AT_PATTERN`). */
      at: string;
    }
  | {
      /** Equal to the extension id or starts with `<extension id>.`. */
      id: string;
      every: 'hourly';
    };

/** What an importer accepts: `text` hands the handler the file as a UTF-8 string, `bytes` as a `Uint8Array`. */
export type ImporterInputKind = 'text' | 'bytes';

/** An importer: turns a file the user picked into a course directory (`server.registerImporter`); at most `EXTENSION_TRANSFER_LIMITS.importers` per extension. */
export interface ImporterRegistration {
  /** Equal to the extension id or starts with `<extension id>.`. */
  id: string;
  /** Name in the command palette and the library card, 1–`EXTENSION_COMMAND_LIMITS.titleLength` characters. */
  title: LocalizedText;
  /** 1–`EXTENSION_TRANSFER_LIMITS.acceptExtensions` unique file extensions in lower case, such as `.csv` (`TRANSFER_ACCEPT_PATTERN`). */
  accept: readonly string[];
  input: ImporterInputKind;
  /**
   * Runs for at most `EXTENSION_TRANSFER_LIMITS.handlerMs`; a failure, an
   * exceeded budget, or a result `normalizeImportResult` refuses reaches the
   * user as an error.
   */
  run: ImporterHandler;
}

/** What an exporter hands the extension: a course snapshot or aggregated progress. */
export type ExporterScope = 'course' | 'progress';

/** An exporter: turns a course or the learning progress into a file the user saves (`server.registerExporter`); at most `EXTENSION_TRANSFER_LIMITS.exporters` per extension. */
export interface ExporterRegistration {
  /** Equal to the extension id or starts with `<extension id>.`. */
  id: string;
  /** Name in the command palette and the library card, 1–`EXTENSION_COMMAND_LIMITS.titleLength` characters. */
  title: LocalizedText;
  scope: ExporterScope;
  /**
   * Runs for at most `EXTENSION_TRANSFER_LIMITS.handlerMs`; a failure, an
   * exceeded budget, or a result `normalizeExportResult` refuses reaches the
   * user as an error.
   */
  run: ExporterHandler;
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

interface SettingDefinitionBase {
  /** Equal to the extension id or starts with `<extension id>.`. */
  id: string;
  /** Field label in the settings dialog, 1–`SETTING_LIMITS.labelLength` characters. */
  label: LocalizedText;
  /** Help text under the field, 1–`SETTING_LIMITS.descriptionLength` characters. */
  description?: LocalizedText;
  /** Section title in the settings dialog, 1–`SETTING_LIMITS.groupLength` characters; settings without it come first, with no title. */
  group?: LocalizedText;
  /** Sort key in the form, an integer 0–`SETTING_LIMITS.orderMax`; default 0, ties keep the declaration order. */
  order?: number;
  /** The field is hidden while the condition is false; the hidden value is kept and still reaches the code. */
  visibleWhen?: SettingVisibleWhen;
}

export interface BooleanSettingDefinition extends SettingDefinitionBase {
  type: 'boolean';
  default: boolean;
}

export interface StringSettingDefinition extends SettingDefinitionBase {
  type: 'string';
  default: string;
  /** Length in UTF-16 code units, 1..10000; no key means unlimited (within 10000). */
  maxLength?: number;
}

/** A multi-line string. */
export interface TextSettingDefinition extends SettingDefinitionBase {
  type: 'text';
  default: string;
  /** Length in UTF-16 code units, 1..10000; no key means unlimited (within 10000). */
  maxLength?: number;
}

/** A color `#rrggbb`; the stored value is lower-case. */
export interface ColorSettingDefinition extends SettingDefinitionBase {
  type: 'color';
  /** `#rrggbb`. */
  default: string;
}

/** A list of strings; the code receives `string[]`. */
export interface ListSettingDefinition extends SettingDefinitionBase {
  type: 'list';
  default: string[];
  /** Most items, 1..50; default 50. */
  maxItems?: number;
  /** Longest item in UTF-16 code units, 1..200; default 200. */
  itemMaxLength?: number;
}

export interface NumberSettingDefinition extends SettingDefinitionBase {
  type: 'number';
  default: number;
  min?: number;
  max?: number;
  /** Integer values only. */
  integer?: boolean;
}

export interface EnumSettingOption {
  /** 1–`SETTING_LIMITS.optionValueLength` characters, unique in the list. */
  value: string;
  /** 1–`SETTING_LIMITS.labelLength` characters. */
  label: LocalizedText;
}

export interface EnumSettingDefinition extends SettingDefinitionBase {
  type: 'enum';
  /** One of `options[].value`. */
  default: string;
  /** 1–`SETTING_LIMITS.options` options. */
  options: EnumSettingOption[];
}

/** A setting the user changes in "Settings → Extensions"; the app renders the form (`server.registerSettings`). */
export type SettingDefinition =
  | BooleanSettingDefinition
  | StringSettingDefinition
  | TextSettingDefinition
  | ColorSettingDefinition
  | ListSettingDefinition
  | NumberSettingDefinition
  | EnumSettingDefinition;

/** Limits of the settings types (`text`, `color`, `list`, `enum`, `group`, `order`); they match those checked by the host and the engine. */
export const SETTING_LIMITS = Object.freeze({
  /** `maxLength` of `string` and `text`. */
  stringLength: 10_000,
  /** `maxItems` of `list`. */
  listItems: 50,
  /** `itemMaxLength` of `list`. */
  listItemLength: 200,
  /** Length of a label, in UTF-16 code units; also of an option's label. */
  labelLength: 60,
  /** Length of a help text. */
  descriptionLength: 500,
  groupLength: 60,
  orderMax: 1000,
  /** Options of one `enum`. */
  options: 64,
  /** Length of an option's value. */
  optionValueLength: 100,
});

/** `#rrggbb` (any case in a definition; the stored value is lower-case). */
export const COLOR_SETTING_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Learning events an extension can subscribe to. */
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

/** Most entries in `dependencies`. */
export const MAX_EXTENSION_DEPENDENCIES = 16;

/**
 * Another extension this one needs (`dependencies`). The extension loads only
 * while the dependency is installed, enabled, loaded and its version fits
 * `range`; the app never installs a dependency on its own.
 */
export interface ExtensionDependency {
  /** Id of the required extension; not the extension's own id, unique in the list. */
  id: string;
  /** Version range: space-separated comparators that must all hold (`>=1.2.0 <2.0.0`; operators `<`, `<=`, `>=`, `>`, `=`; bare `1.2.0` means `=1.2.0`); `null` — any version. */
  range: string | null;
}

/**
 * Normalized manifest: all defaults applied. It holds identity and
 * compatibility only; contributions are registered by code (`server`, `client`).
 */
export interface ExtensionManifest {
  id: string;
  /** semver */
  version: string;
  apiVersion: typeof EXTENSION_API_VERSION;
  /** Built server part inside the extension (`./main.mjs`, exports `server`); `null` — no server part. */
  main: string | null;
  /** Built client part inside the extension (`./client.mjs`, exports `client`); `null` — no client part. */
  client: string | null;
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
  /** Catalog tags (from `EXTENSION_TAGS`); empty — none. */
  tags: ExtensionTag[];
  /** Extensions this one needs; empty — none. */
  dependencies: ExtensionDependency[];
}

/** `extension.json` as the author (or `dolphy-ext build`) writes it. */
export interface ExtensionManifestInput {
  /** Path or URL of `extension.schema.json` for editors; ignored by the app and the tools. */
  $schema?: string;
  id: string;
  version: string;
  apiVersion: typeof EXTENSION_API_VERSION;
  /** Built server part (`DEFAULT_MAIN`); no key or `null` — none. */
  main?: string | null;
  /** Built client part (`DEFAULT_CLIENT`); no key or `null` — none. */
  client?: string | null;
  name?: string;
  description?: string;
  author?: string;
  /** No key means any platform. */
  platforms?: ExtensionPlatform[];
  minAppVersion?: string;
  /** Path of the extension icon (`.png` or `.webp`, square, 64–512 px, up to 16 KiB); no key — no icon. */
  icon?: string;
  /** Up to 5 unique catalog tags from `EXTENSION_TAGS`; no key — no tags. */
  tags?: ExtensionTag[];
  /** Up to `MAX_EXTENSION_DEPENDENCIES` extensions this one needs, without the extension itself and repeats; no key — none. */
  dependencies?: { id: string; range?: string }[];
}

/** Identifiers of built-in themes: extensions cannot take them. */
export const BUILTIN_THEME_IDS = ['system', 'light', 'dark'] as const;

/** Allowed keys of `ThemeRegistration.colors`. */
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

/** Allowed keys of `ThemeRegistration.variables`. */
export const THEME_VARIABLE_KEYS: readonly string[] = [
  'border-color',
  'border-opacity',
  'medium-emphasis-opacity',
  'high-emphasis-opacity',
  'disabled-opacity',
];

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

/** Limits on commands and panels (R1, R3); they match those checked by the host and the engine. */
export const EXTENSION_COMMAND_LIMITS = Object.freeze({
  /** Keybinding entries (`keybindings`) per command. */
  keybindingsPerCommand: 4,
  /** Length of a `when` condition (of a command, panel or `keybindings[]` entry). */
  whenLength: WHEN_MAX_LENGTH,
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

/** Limits on importers and exporters; the host and the engine check the same numbers. */
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
 * `(input: BytesImportInput)`; the host passes the form the registration declares.
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

/** What a `progress` exporter handler receives; it reads the data through `server.stats`. */
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
 * registration declares.
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
 * `undefined` means any string, for tests without a registration) and
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

/** What the app tells a panel component about its surroundings; read only. */
export interface PanelContextInfo {
  /** The course the app is focused on; `null` — all courses. */
  readonly courseId: string | null;
}

/**
 * Key under which the app provides the handle of the panel being drawn
 * (Vue `provide`/`inject`); a registered symbol, so the app and the bundle of
 * an extension agree on it without sharing a module.
 */
export const PANEL_HANDLE_KEY = Symbol.for('dolphy.extension.panel');

/**
 * What a panel component gets from the app. A panel is a Vue component the
 * extension registers with `client.addPanel`; the app draws it as a page inside
 * its own tree.
 */
export interface PanelHandle<Commands extends string = string> {
  readonly panelId: string;
  /** Properties the panel was opened with (`openPanel(id, props)`); reactive, `undefined` — none. */
  readonly props: JsonValue | undefined;
  /** The current surroundings; reactive, the app updates it in place. */
  readonly context: PanelContextInfo;
  /**
   * Calls a command this extension registers (including `palette: false`
   * ones). Resolves to the JSON answer of the handler (`undefined` — no
   * answer); the app runs `notify` and `openPanel` itself. A failure is a
   * rejected promise with an `Error`.
   */
  call(commandId: Commands, args?: JsonValue): Promise<JsonValue | undefined>;
}

/**
 * Key under which the app provides the handle of the injected component being
 * drawn (Vue `provide`/`inject`); a registered symbol, so the app and the
 * bundle of an extension agree on it without sharing a module.
 */
export const INJECTION_HANDLE_KEY = Symbol.for('dolphy.extension.injection');

/**
 * What an injected component gets from the app. The component is registered
 * with `client.addInjection`; the app draws it inside its own tree, so it
 * uses the app's Vue, Vuetify, theme and language.
 */
export interface InjectionHandle {
  /** The element the component is drawn at. */
  readonly target: Element;
  readonly position: InjectionPosition;
}

/**
 * Key under which the app provides the id of the extension to every component
 * of that extension: panel, injected component, answer view, markdown
 * renderer and a component mounted with `useApp().mountAt`. The value is the
 * extension id string; `useRpc` reads it to address the extension's server.
 */
export const EXTENSION_ID_KEY = Symbol.for('dolphy.extension.id');

/**
 * Key under which the app provides the object returned by `useApp()`
 * (Vue `provide` on the app level).
 */
export const APP_KEY = Symbol.for('dolphy.extension.app');

/**
 * Key under which the app provides the engine client returned by
 * `useEngine()` (Vue `provide` on the app level). It is the same client object
 * the window itself uses; the app provides it under this key apart from its
 * internal one.
 */
export const ENGINE_KEY = Symbol.for('dolphy.extension.engine');

/** Kind of a toast shown by `AppApi.notify`. */
export type AppNotifyKind = 'info' | 'success' | 'warning' | 'error';

/** Language of the window. */
export type AppLocale = 'en' | 'ru';

/** The theme the window shows. */
export interface AppTheme {
  /** `BUILTIN_THEME_IDS` entry or the id of an extension theme; the effective one, `system` is already resolved. */
  readonly id: string;
  readonly dark: boolean;
}

/**
 * The capabilities of the window an extension component may use
 * (`useApp()`, `ClientContext.app`). It is an explicit list: no stores, no
 * router. `theme` and `locale` are getters over reactive state, so reading
 * them inside `computed`, `watch` or a template tracks the change.
 */
export interface AppApi {
  /** Opens the course page. */
  openCourse(courseId: string): void;
  openLesson(courseId: string, lessonId: string): void;
  openExercise(courseId: string, lessonId: string, exerciseId: string): void;
  /** Opens a panel of an extension (`client.addPanel` id); `props` reach it as `usePanel().props`. */
  openPanel(extensionId: string, panelId: string, props?: unknown): void;
  /** Opens "Settings → Extensions", at the extension's section when `extensionId` is given. */
  openSettings(extensionId?: string): void;
  /** Shows a toast with `message` (as is, no markup); `kind` defaults to `info`. */
  notify(message: string, kind?: AppNotifyKind): void;
  readonly theme: AppTheme;
  readonly locale: AppLocale;
  /**
   * Runs a command of the app's palette by its key, such as
   * `extension:<extension id>:<command id>` for an extension command. The
   * commands are run without arguments. Rejects when there is no such
   * command, it is disabled, or it fails.
   */
  runCommand(commandKey: string): Promise<void>;
  /**
   * Mounts a Vue component into an element of the window with the app's
   * context (Vuetify, i18n, theme). A string `target` is a CSS selector, the
   * first matching element is taken at the call; an absent element throws.
   * Mounts once: the component is not re-mounted when the element
   * is replaced. `dispose()` unmounts it. For a component that follows the
   * DOM use `client.addInjection`.
   */
  mountAt(
    target: Element | string,
    component: unknown,
    props?: Readonly<Record<string, unknown>>,
  ): Disposable;
}

/**
 * Name of an RPC contract: lower-case dot-separated segments, such as
 * `greeting.say-hello`, the first segment without a hyphen, at least two
 * segments, at most `EXTENSION_RPC_LIMITS.nameLength` characters.
 */
export const RPC_NAME_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/;

/** Limits on RPC between the client and the server part of an extension; the host and the engine check the same numbers. */
export const EXTENSION_RPC_LIMITS = Object.freeze({
  /** Characters in the name of a contract. */
  nameLength: 120,
  /** Handlers (`server.handle`) per extension. */
  rpcs: 64,
  /** `JSON.stringify(input).length` at the engine boundary. */
  inputChars: 200_000,
  /** Handler budget, ms. */
  handlerMs: 10_000,
});

/**
 * A typed call between the client and the server part of an extension: the
 * name and the schemas of the input and the output, shared by both parts
 * (`defineRpc`). Both sides validate with the schemas; the data crosses the
 * process boundary as JSON.
 */
export interface RpcContract<Input, Output> {
  /** Matches `RPC_NAME_PATTERN`. */
  readonly name: string;
  readonly input: ZodType<Input>;
  readonly output: ZodType<Output>;
}

export const DEFAULT_MAIN = './main.mjs';
export const DEFAULT_CLIENT = './client.mjs';

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
  /** Public view for the answer view component; secrets (answer keys) are excluded. Called on `beginAttempt`. */
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

/** Thrown by `server.storage.set` when a write exceeds a limit: the write did not happen, other data is unchanged. */
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
 * Limits are `EXTENSION_STORAGE_LIMITS`.
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
 * Thrown by `server.secrets.set` and by `server.secrets.get` of an existing key when
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
 * Each extension has its own space, cleared with the extension data. Limits are `EXTENSION_SECRET_LIMITS`.
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

/** Settings of the extension (`server.registerSettings`); `S` maps setting ids to value types. */
export interface ExtensionSettings<S extends SettingValues = SettingValues> {
  /** The current value or the `default`; an `id` nobody registered throws. */
  get<K extends keyof S & string>(id: K): S[K];
  /** The handler runs after a change, without restarting the extension; a handler failure is only logged. */
  onDidChange(handler: (change: SettingChange<S>) => void): Disposable;
}

/** Limits of `server.stats`; the engine enforces them. */
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
 * Aggregated learning statistics. Numbers only: no
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

/** Limits of `server.notifications`; the engine enforces them. */
export const EXTENSION_NOTIFICATION_LIMITS = Object.freeze({
  /** Title length in characters (code points). */
  titleLength: 80,
  /** Body length in characters (code points). */
  bodyLength: 300,
  /** Notifications per rolling minute and extension. */
  perMinute: 3,
  /** Notifications per rolling hour and extension. */
  perHour: 30,
});

/** Which window of `EXTENSION_NOTIFICATION_LIMITS` was exceeded. */
export type NotificationRateLimitWindow = 'minute' | 'hour';

/** Thrown by `server.notifications.show` over the rate limit: the notification was not shown. */
export class NotificationRateLimitError extends Error {
  readonly window: NotificationRateLimitWindow;
  /** Exceeded limit: notifications per `window`. */
  readonly limit: number;
  readonly code = 'EXT_NOTIFICATION_RATE_LIMIT';
  constructor(
    window: NotificationRateLimitWindow,
    limit: number,
    message?: string,
  ) {
    super(
      message ?? `notification rate limit exceeded: ${limit} per ${window}`,
    );
    this.name = 'NotificationRateLimitError';
    this.window = window;
    this.limit = limit;
  }
}

/** A system notification; plain text, control characters are removed. */
export interface ExtensionNotification {
  /** 1 to `EXTENSION_NOTIFICATION_LIMITS.titleLength` characters. */
  title: string;
  /** Up to `EXTENSION_NOTIFICATION_LIMITS.bodyLength` characters; may be empty. */
  body: string;
}

/**
 * System notifications. The notification
 * names the extension; a click shows the app window. Works only while the app
 * runs. The user can switch notifications off per extension in the settings.
 */
export interface ExtensionNotifications {
  /**
   * Resolves `true` once the notification is handed to the operating system;
   * `false` when the system does not support notifications or the user turned
   * them off for this extension. Rejects with `NotificationRateLimitError`
   * over `perMinute`/`perHour` and with an error for an invalid title or body.
   */
  show(notification: ExtensionNotification): Promise<boolean>;
}

/** Runs when a schedule fires; at most `EXTENSION_SCHEDULE_LIMITS.handlerMs`, a failure is only logged. */
export type ScheduleHandler = () => void | Promise<void>;

export type LearningEventHandler<N extends LearningEventName> = (
  payload: LearningEventPayloads[N],
) => void | Promise<void>;

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

/** A kind of exercise (`server.registerExerciseType`): metadata and handler in one object. */
export interface ExerciseTypeRegistration<
  Spec = unknown,
  Answer = unknown,
  View = unknown,
> extends ExerciseTypeHandler<Spec, Answer, View> {
  /** Equal to the extension id or starts with `<extension id>.`. */
  id: string;
  /** Name shown on the contribution chip, 1–`EXTENSION_COMMAND_LIMITS.titleLength` characters; without it the id is shown. */
  title?: LocalizedText;
  /** JSON Schema 2020-12 for `engine.exercise.spec`. */
  specSchema: JsonSchema;
  /** JSON Schema 2020-12 for the learner's answer (`submitAnswer.answer`). */
  answerSchema: JsonSchema;
}

/** A grading rule (`server.registerGradePolicy`): how verdicts are turned into a 1–5 grade. */
export interface GradePolicyRegistration {
  /** Equal to the extension id or starts with `<extension id>.`; not `passAtN`. */
  id: string;
  /** Name of the rule, 1–`EXTENSION_COMMAND_LIMITS.titleLength` characters. */
  label: LocalizedText;
  evaluate: GradePolicyHandler;
}

/** What an entry function may return: a cleanup called when the extension is unloaded. */
export type EntryCleanup = Disposable | (() => void | Promise<void>);

/** Result of an entry function: nothing or a cleanup. */
export type EntryResult = void | EntryCleanup;

/**
 * What the host gives the server part of an extension (`export const server`
 * of `src/index.ts`, built into `main.mjs`). Every `register*` call adds a
 * contribution and returns a `Disposable` that removes it. Ids are
 * checked by the host; a violation fails the whole registration.
 * `Engine` is the type of `engine` (`unknown`: this package does not depend on
 * the engine contract; the SDK fixes it to `ExtensionEngine`).
 */
export interface ServerContext<
  S extends SettingValues = SettingValues,
  Engine = unknown,
> {
  readonly extensionId: string;
  readonly logger: ExtensionLogger;
  readonly library: LibraryReader;
  readonly storage: ExtensionStorage;
  readonly secrets: ExtensionSecrets;
  readonly settings: ExtensionSettings<S>;
  /** Learning statistics. */
  readonly stats: ExtensionStats;
  /** System notifications. */
  readonly notifications: ExtensionNotifications;
  /**
   * The app's engine: every method of the engine contract, writing ones
   * included, and `subscribe` for the engine events. Calls are made on behalf
   * of this extension and fail with `EngineError` as in the window.
   */
  readonly engine: Engine;
  registerExerciseType(reg: ExerciseTypeRegistration): Disposable;
  registerGradePolicy(reg: GradePolicyRegistration): Disposable;
  /** Adds the settings to "Settings → Extensions"; ids are unique across the extension. */
  registerSettings(defs: readonly SettingDefinition[]): Disposable;
  /**
   * One handler per event. Delivery is asynchronous, in order, at most once;
   * 2 s per handler; a failure is only logged.
   */
  on<E extends LearningEventName>(
    event: E,
    handler: LearningEventHandler<E>,
  ): Disposable;
  registerCommand(reg: CommandRegistration): Disposable;
  /**
   * The app fires the handler by the local clock while it runs. A firing
   * found more than `EXTENSION_SCHEDULE_LIMITS.lateMs` after its moment (the
   * app was closed or asleep) is skipped and never replayed; a handler still
   * running from the previous firing misses the next one. The user can switch
   * the extension's schedules off in the settings.
   */
  schedule(reg: ScheduleRegistration, handler: ScheduleHandler): Disposable;
  registerImporter(reg: ImporterRegistration): Disposable;
  registerExporter(reg: ExporterRegistration): Disposable;
  /**
   * Answers the calls of `useRpc(contract)` from the extension's components
   * and of `engine.extensions.invokeRpc`. One handler per contract name, at
   * most `EXTENSION_RPC_LIMITS.rpcs` per extension. The input is validated
   * with `contract.input` before the handler runs and the result with
   * `contract.output` after it; a violation rejects the call. A handler runs
   * for at most `EXTENSION_RPC_LIMITS.handlerMs`; its error reaches the caller
   * with the message.
   */
  handle<Input, Output>(
    contract: RpcContract<Input, Output>,
    handler: (input: Input) => Output | Promise<Output>,
  ): Disposable;
}

/** `export const server` of an extension: registers contributions; the result, if any, runs when the extension is unloaded. */
export type ServerEntry<Engine = unknown> = (
  server: ServerContext<SettingValues, Engine>,
) => EntryResult | Promise<EntryResult>;

/**
 * The registered forms below are what the host's registrar produces from the
 * calls of `server`: handlers dropped, defaults applied, absent values `null`.
 * The engine and the window read them as they are (the engine's DTOs add
 * `extensionId` to them).
 */

/** Exercise type as the registrar hands it over: schemas, no handlers. */
export interface RegisteredExerciseType {
  id: string;
  /** `null` — the id is shown. */
  title: LocalizedText | null;
  specSchema: JsonSchema;
  answerSchema: JsonSchema;
}

/** Grading rule as the registrar hands it over: no handler. */
export type RegisteredGradePolicy = Omit<GradePolicyRegistration, 'evaluate'>;

/** Key binding with every platform field present (`null` — same as `key`; `when` `null` — no condition). */
export interface RegisteredKeybinding {
  key: string;
  mac: string | null;
  windows: string | null;
  linux: string | null;
  when: string | null;
}

/** Command as the registrar hands it over: defaults applied, no handler. */
export interface RegisteredCommand {
  id: string;
  title: LocalizedText;
  description: LocalizedText | null;
  category: LocalizedText | null;
  palette: boolean;
  icon: ExtensionIconName;
  keybindings: RegisteredKeybinding[];
  when: string | null;
}

/** Schedule as the registrar hands it over: `at` is `null` for `hourly`. */
export interface RegisteredSchedule {
  id: string;
  every: ExtensionScheduleEvery;
  at: string | null;
}

/** Importer as the registrar hands it over: no handler. */
export interface RegisteredImporter {
  id: string;
  title: LocalizedText;
  accept: string[];
  input: ImporterInputKind;
}

/** Exporter as the registrar hands it over: no handler. */
export interface RegisteredExporter {
  id: string;
  title: LocalizedText;
  scope: ExporterScope;
}

interface RegisteredSettingBase {
  id: string;
  label: LocalizedText;
  description: LocalizedText | null;
  group: LocalizedText | null;
  order: number;
  visibleWhen: SettingVisibleWhen | null;
}

export interface RegisteredBooleanSetting extends RegisteredSettingBase {
  type: 'boolean';
  default: boolean;
}

export interface RegisteredStringSetting extends RegisteredSettingBase {
  type: 'string';
  default: string;
  /** `null` — up to `SETTING_LIMITS.stringLength`. */
  maxLength: number | null;
}

export interface RegisteredTextSetting extends RegisteredSettingBase {
  type: 'text';
  default: string;
  /** `null` — up to `SETTING_LIMITS.stringLength`. */
  maxLength: number | null;
}

export interface RegisteredColorSetting extends RegisteredSettingBase {
  type: 'color';
  /** Lower-case `#rrggbb`. */
  default: string;
}

export interface RegisteredListSetting extends RegisteredSettingBase {
  type: 'list';
  default: string[];
  maxItems: number;
  itemMaxLength: number;
}

export interface RegisteredNumberSetting extends RegisteredSettingBase {
  type: 'number';
  default: number;
  min: number | null;
  max: number | null;
  integer: boolean;
}

export interface RegisteredEnumSetting extends RegisteredSettingBase {
  type: 'enum';
  default: string;
  options: EnumSettingOption[];
}

/** A `SettingDefinition` with its defaults applied. */
export type RegisteredSetting =
  | RegisteredBooleanSetting
  | RegisteredStringSetting
  | RegisteredTextSetting
  | RegisteredColorSetting
  | RegisteredListSetting
  | RegisteredNumberSetting
  | RegisteredEnumSetting;

/**
 * Everything the server part of an extension registered, as data: the host
 * keeps the handlers and sends this snapshot to the engine. Registration is
 * all or nothing: when `server` fails or exceeds its budget, the extension has no registration.
 */
export interface ServerRegistration {
  readonly exerciseTypes: readonly RegisteredExerciseType[];
  readonly gradePolicies: readonly RegisteredGradePolicy[];
  readonly settings: readonly RegisteredSetting[];
  readonly events: readonly LearningEventName[];
  readonly commands: readonly RegisteredCommand[];
  readonly schedules: readonly RegisteredSchedule[];
  readonly importers: readonly RegisteredImporter[];
  readonly exporters: readonly RegisteredExporter[];
  /** Names of the contracts of `server.handle`. */
  readonly rpcs: readonly string[];
}

/** Registration of an extension without a server part, or before it has registered anything. */
export const EMPTY_SERVER_REGISTRATION: ServerRegistration = Object.freeze({
  exerciseTypes: Object.freeze([]),
  gradePolicies: Object.freeze([]),
  settings: Object.freeze([]),
  events: Object.freeze([]),
  commands: Object.freeze([]),
  schedules: Object.freeze([]),
  importers: Object.freeze([]),
  exporters: Object.freeze([]),
  rpcs: Object.freeze([]),
});

/** Code block language of a markdown renderer: `[a-z][a-z0-9-]{0,31}`. */
export const MARKDOWN_LANGUAGE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** A theme added by an extension: data only, no code (`client.addTheme`). */
export interface ThemeRegistration {
  /** Equal to the extension id or starts with `<extension id>.`; not in `BUILTIN_THEME_IDS`. */
  id: string;
  /** Tile title in "Settings → Appearance", 1–`EXTENSION_COMMAND_LIMITS.titleLength` characters. */
  label: LocalizedText;
  dark: boolean;
  /** Keys from `THEME_COLOR_KEYS`; values are `#rrggbb` or `#rrggbbaa`. */
  colors: Record<string, string>;
  /** Keys from `THEME_VARIABLE_KEYS`: `border-color` is a color, the rest are numbers 0..1. */
  variables?: Record<string, string | number>;
}

/**
 * What the window gives the client part of an extension (`export const
 * client` of `src/index.ts`, built into `client.mjs`). Components are Vue
 * components (`unknown`: this package does not depend on Vue). Every `add*`
 * call returns a `Disposable` that removes the contribution. `Engine` is the
 * type of `engine` (`unknown`: this package does not depend on the engine
 * contract; the SDK fixes it to `ExtensionEngine`).
 */
export interface ClientContext<Engine = unknown> {
  readonly extensionId: string;
  /** The window API, the same object as `useApp()` in a component. */
  readonly app: AppApi;
  /** The engine client of the window, the same object as `useEngine()` in a component. */
  readonly engine: Engine;
  addPanel(reg: PanelRegistration): Disposable;
  /** Draws `reg.component` at every element that matches `reg.target`. */
  addInjection(reg: InjectionRegistration): Disposable;
  /** `exerciseTypeId` is an exercise type this or another extension registers on the server. */
  addAnswerView(exerciseTypeId: string, component: unknown): Disposable;
  /** `language` matches `MARKDOWN_LANGUAGE_PATTERN`. */
  addMarkdownRenderer(language: string, component: unknown): Disposable;
  addTheme(reg: ThemeRegistration): Disposable;
  addCommand(reg: ClientCommandRegistration): Disposable;
}

/** `export const client` of an extension: registers contributions; the result, if any, runs when the extension is unloaded. */
export type ClientEntry<Engine = unknown> = (
  client: ClientContext<Engine>,
) => EntryResult | Promise<EntryResult>;
