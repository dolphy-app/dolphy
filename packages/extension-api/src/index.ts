/**
 * Публичный API расширений. Пакет не зависит от движка и DOM: его импортируют
 * и код расширения (`main.mjs`), и элемент ответа (`view.mjs`), и сам движок.
 */

export const EXTENSION_API_VERSION = 1 as const;
export const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
/** GitHub-логин автора расширения (`author` в манифесте и каталоге). */
export const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** Возможности, которые расширение объявляет в манифесте; без объявления — ни одной. */
export const EXTENSION_PERMISSIONS = [
  'library.read',
  'process.spawn',
  'worker.threads',
  'native.addons',
  'network',
  'learning.events',
] as const;
export type ExtensionPermission = (typeof EXTENSION_PERMISSIONS)[number];
/** Платформы, на которых расширение может работать (`process.platform`). */
export const EXTENSION_PLATFORMS = ['darwin', 'linux', 'win32'] as const;
export type ExtensionPlatform = (typeof EXTENSION_PLATFORMS)[number];
export const ELEMENT_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

/** Имена событий custom element'а ответа. */
export const ANSWER_EVENT = {
  change: 'dolphy-answer-change',
  submit: 'dolphy-answer-submit',
} as const;

export interface AnswerChangeDetail {
  value: unknown;
  /** Ответ можно отправлять на проверку. */
  complete: boolean;
}

/** Свойства, которые приложение выставляет элементу ответа. */
export interface AnswerElementProps {
  /** Результат `project()`. */
  view: unknown;
  /** Текущий ответ (для восстановления). */
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
  /** Равен id расширения или начинается с `<id расширения>.`. */
  id: string;
  /** JSON Schema 2020-12 для `engine.exercise.spec`: путь внутри каталога расширения (`./schema/spec.json`) или схема объектом. */
  specSchema: string | JsonSchema;
  /** JSON Schema 2020-12 для ответа ученика (`submitAnswer.answer`): путь или схема объектом. */
  answerSchema: string | JsonSchema;
  /** Тег custom element'а (дефис обязателен), рисующего ввод ответа. */
  element: string;
  /** Путь к ES-модулю, определяющему элемент (`./view.mjs`). */
  renderer: string;
}

/** Тема оформления, добавляемая расширением: только данные, без кода. */
export interface ThemeContribution {
  /** Равен id расширения или начинается с `<id расширения>.`; не из `BUILTIN_THEME_IDS`. */
  id: string;
  /** Название плитки в «Настройки → Внешний вид», до 60 символов. */
  label: string;
  dark: boolean;
  /** Ключи из `THEME_COLOR_KEYS`, значения — `#rrggbb` или `#rrggbbaa`. */
  colors: Record<string, string>;
  /** Ключи из `THEME_VARIABLE_KEYS`: `border-color` — цвет, остальные — числа 0..1. */
  variables?: Record<string, string | number>;
}

/** Рендерер содержимого: блоки ` ```<language> ` выводит модуль расширения. */
export interface MarkdownRendererContribution {
  /** Язык блока кода: `[a-z][a-z0-9-]{0,31}`. */
  language: string;
  /** Путь к ES-модулю; в нормализованном манифесте задан всегда. */
  renderer?: string;
}

/** Команда расширения: действие в палитре команд, выполняемое кодом расширения (`ctx.commands.register`). */
export interface CommandContribution {
  /** Равен id расширения или начинается с `<id расширения>.`. */
  id: string;
  /** Название в палитре, 1–60 символов. */
  title: string;
  /** До 200 символов. */
  description?: string;
  /** Группа в палитре, до 40 символов. */
  category?: string;
  /** Подсказка вида `Mod+Shift+L` (`KEYBINDING_PATTERN`); приложение клавишу не назначает. */
  keybinding?: string;
  /** `false` скрывает команду из палитры, оставляя её доступной панели; по умолчанию `true`. */
  palette?: boolean;
}

/** Панель расширения: экран приложения в изолированной рамке с пунктом бокового меню. */
export interface PanelContribution {
  /** Равен id расширения или начинается с `<id расширения>.`. */
  id: string;
  /** Название пункта меню и заголовка страницы, 1–60 символов. */
  title: string;
  /** Путь к ES-модулю панели (`.js` или `.mjs`); по умолчанию `DEFAULT_PANEL`. */
  module?: string;
}

/** Значение настройки расширения. */
export type SettingValue = boolean | string | number;

interface SettingContributionBase {
  /** Равен id расширения или начинается с `<id расширения>.`. */
  id: string;
  /** Подпись поля в диалоге настроек, до 60 символов; данные расширения, не переводится. */
  label: string;
  /** Пояснение под полем, до 500 символов. */
  description?: string;
}

export interface BooleanSettingContribution extends SettingContributionBase {
  type: 'boolean';
  default: boolean;
}

export interface StringSettingContribution extends SettingContributionBase {
  type: 'string';
  default: string;
  /** Длина в кодовых единицах UTF-16, 1..10000; нет ключа — без ограничения (в пределах 10000). */
  maxLength?: number;
}

export interface NumberSettingContribution extends SettingContributionBase {
  type: 'number';
  default: number;
  min?: number;
  max?: number;
  /** Только целые значения. */
  integer?: boolean;
}

export interface EnumSettingOption {
  value: string;
  label: string;
}

export interface EnumSettingContribution extends SettingContributionBase {
  type: 'enum';
  /** Одно из `options[].value`. */
  default: string;
  options: EnumSettingOption[];
}

/** Настройка, которую пользователь меняет в «Настройки → Расширения»; форму рисует приложение. */
export type SettingContribution =
  | BooleanSettingContribution
  | StringSettingContribution
  | NumberSettingContribution
  | EnumSettingContribution;

/** События обучения, на которые расширение с разрешением `learning.events` может подписаться. */
export const LEARNING_EVENT_NAMES = [
  'session.started',
  'session.finished',
  'attempt.closed',
] as const;
export type LearningEventName = (typeof LEARNING_EVENT_NAMES)[number];

/** Итог закрытой попытки: `self-assessed` — оценку поставил ученик. */
export type AttemptOutcome = 'passed' | 'failed' | 'gave-up' | 'self-assessed';

/** Откуда оценка попытки (тип движка целиком). */
export type AttemptSource = 'self' | 'runner' | 'placement' | 'trane-import';

/**
 * Поля событий обучения: только идентификаторы, оценка и время — ответы,
 * `spec`, обратная связь и текст упражнения в них не попадают. Совпадает с
 * `LearningEventPayloads` движка (пакет от движка не зависит; совпадение
 * проверяет тест `extension-host`).
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
    /** `self` — ученик закрыл попытку сам, `runner` — по вердикту раннера; другие значения событие не несёт. */
    source: AttemptSource;
    /** Миллисекунды Unix-эпохи. */
    at: number;
  };
}

/** Подписка расширения на событие обучения (`contributes.events`). */
export interface EventContribution {
  event: LearningEventName;
}

/** Правило оценки: как вердикты превращаются в оценку 1–5. */
export interface GradePolicyContribution {
  /** Равен id расширения или начинается с `<id расширения>.`; не `passAtN`. */
  id: string;
  label: string;
}

/** Нормализованный манифест: все умолчания применены. */
export interface ExtensionManifest {
  id: string;
  /** semver */
  version: string;
  apiVersion: typeof EXTENSION_API_VERSION;
  /** Путь к `.mjs` с кодом расширения; `null` — расширению код не нужен. */
  main: string | null;
  /** Объявленные возможности кода расширения; по умолчанию пусто. */
  permissions: ExtensionPermission[];
  /** Человекочитаемое название; `null` — не задано. */
  name: string | null;
  description: string | null;
  /** GitHub-логин автора; `null` — не задан. */
  author: string | null;
  /** Пусто — любая платформа. */
  platforms: readonly ExtensionPlatform[];
  /** Минимальная версия приложения (semver); `null` — любая. */
  minAppVersion: string | null;
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

/** Вид задания в `extension.json`, как его пишет автор. */
export interface ExerciseTypeContributionInput {
  id: string;
  specSchema: string | JsonSchema;
  answerSchema: string | JsonSchema;
  /** По умолчанию `defaultElementName(id)`. */
  element?: string;
  /** По умолчанию `DEFAULT_RENDERER`. */
  renderer?: string;
}

/** `extension.json`, как его пишет автор. */
export interface ExtensionManifestInput {
  id: string;
  version: string;
  apiVersion: typeof EXTENSION_API_VERSION;
  /** По умолчанию `DEFAULT_MAIN`, если код нужен вкладам; иначе `null`. */
  main?: string;
  permissions?: ExtensionPermission[];
  name?: string;
  description?: string;
  author?: string;
  /** Нет ключа — любая платформа. */
  platforms?: ExtensionPlatform[];
  minAppVersion?: string;
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

/** Идентификаторы встроенных тем: расширения не могут их занять. */
export const BUILTIN_THEME_IDS = ['system', 'light', 'dark'] as const;

/** Допустимые ключи `ThemeContribution.colors`. */
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

/** Допустимые ключи `ThemeContribution.variables`. */
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
 * Подсказка клавиш команды: до трёх модификаторов (`Mod`, `Ctrl`, `Alt`,
 * `Shift`) и клавиша через `+`: буква или цифра, `F1`–`F12` либо имя
 * (`Enter`, `Space`, `Tab`, `Escape`, `Backspace`, `Delete`, стрелки,
 * `Home`, `End`, `PageUp`, `PageDown`).
 */
export const KEYBINDING_PATTERN =
  /^(?:(?:Mod|Ctrl|Alt|Shift)\+){0,3}(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Enter|Space|Tab|Escape|Backspace|Delete|Arrow(?:Up|Down|Left|Right)|Home|End|Page(?:Up|Down))$/;

/** Потолки команд и панелей (R1, R3); совпадают с теми, что проверяют манифест, хост и движок. */
export const EXTENSION_COMMAND_LIMITS = Object.freeze({
  /** Команд на расширение. */
  commands: 64,
  /** Панелей на расширение. */
  panels: 8,
  titleLength: 60,
  categoryLength: 40,
  descriptionLength: 200,
  /** `JSON.stringify(args).length` на границе движка. */
  argsChars: 200_000,
  /** JSON-текст результата в байтах UTF-8. */
  resultBytes: 64 * 1024,
  /** Длина `notify` в кодовых единицах UTF-16. */
  notifyChars: 500,
  /** Бюджет обработчика, мс. */
  handlerMs: 10_000,
});

export type GradeValue = 1 | 2 | 3 | 4 | 5;

/** Вход правила оценки: вердикты попытки и признак «сдался». */
export interface GradePolicyInput {
  verdicts: readonly {
    outcome: 'passed' | 'failed' | 'error';
    reason?: string;
  }[];
  gaveUp: boolean;
}

/** `null` — правило не выставляет оценку. */
export type GradePolicyHandler = (
  input: GradePolicyInput,
) => GradeValue | null | Promise<GradeValue | null>;

/** Контекст вывода блока; структурный `AbortSignal` (в пакете нет DOM-типов). */
export interface MarkdownRenderContext {
  language: string;
  signal: {
    readonly aborted: boolean;
    addEventListener(type: 'abort', listener: () => void): void;
  };
}

/** `export default` модуля рендерера содержимого. */
export interface MarkdownRendererModule<Container = unknown> {
  render(
    source: string,
    container: Container,
    context: MarkdownRenderContext,
  ): void | Promise<void>;
}

/** Что обработчик команды просит выполнить приложение: показать уведомление. */
export interface NotifyEffect {
  notify: string;
}

/** Что обработчик команды просит выполнить приложение: открыть свою панель. */
export interface OpenPanelEffect {
  openPanel: string;
  props?: JsonValue;
}

export type CommandEffect = NotifyEffect | OpenPanelEffect;

/**
 * Результат обработчика команды: ничего (`undefined`), эффект для приложения
 * (`CommandEffect`; объект с `notify`/`openPanel` не может нести других
 * ключей) или любой JSON-ответ вызывающему.
 */
export type CommandResult = void | undefined | CommandEffect | JsonValue;

/** `args` — JSON вызывающего; без аргументов — `undefined`. */
export type CommandHandler = (
  args: JsonValue | undefined,
) => CommandResult | Promise<CommandResult>;

/** Результат команды в том виде, в котором его получает вызывающий (`normalizeCommandResult`). */
export type CommandOutcome =
  | { kind: 'none' }
  | { kind: 'notify'; text: string }
  | { kind: 'openPanel'; panelId: string; props?: JsonValue }
  | { kind: 'data'; value: JsonValue };

/** Результат обработчика не годится: не JSON, длиннее потолка, смешанный эффект, чужая панель. */
export class InvalidCommandResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCommandResultError';
  }
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Длина строки в байтах UTF-8 (пакет без DOM-типов и `TextEncoder`); строка из `JSON.stringify` не содержит одиночных суррогатов. */
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
 * Приводит то, что вернул обработчик команды, к `CommandOutcome`: правила хоста
 * и `loadCommands` из SDK одни. `undefined` и `null` — `none`; объект с
 * `notify` (строка 1–500 символов) или `openPanel` (id панели из `panels`;
 * `undefined` — любая строка, для тестов без манифеста) и
 * без других ключей (кроме `props` у `openPanel`) — эффект; остальной JSON —
 * `data`. Значение проходит через JSON (`undefined`-поля отбрасываются), его
 * текст не длиннее `EXTENSION_COMMAND_LIMITS.resultBytes`. Нарушение бросает
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

/** Контекст модуля панели; исполняется в рамке без доступа к данным приложения. */
export interface PanelContext {
  panelId: string;
  /** Свойства, с которыми панель открыта (`openPanel(id, props)`); `undefined` — без свойств. */
  props: JsonValue | undefined;
  /** Прерывается, когда рамка закрывается. */
  signal: {
    readonly aborted: boolean;
    addEventListener(type: 'abort', listener: () => void): void;
  };
  /**
   * Вызывает объявленную команду этого расширения (в том числе `palette: false`);
   * не чаще 20 вызовов в секунду и не более 4 одновременных. Возвращает
   * JSON-ответ обработчика (`undefined` — ответа нет); `notify` и `openPanel`
   * выполняет приложение. Сбой — отклонённый промис с `Error`.
   */
  call(commandId: string, args?: JsonValue): Promise<JsonValue | undefined>;
  /** Подписка на новые свойства открытой панели; возвращает отписку. */
  onProps(listener: (props: JsonValue | undefined) => void): () => void;
}

/** `export default` модуля панели. */
export interface PanelModule<Container = unknown> {
  mount(container: Container, context: PanelContext): void | Promise<void>;
}

export const DEFAULT_MAIN = './main.mjs';
export const DEFAULT_RENDERER = './view.mjs';

/** Тег элемента по умолчанию: `dolphy.sql` → `dolphy-sql-answer`. */
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
  /** Публичный вид для элемента ответа; секреты (ключи ответов) сюда не попадают. Вызывается при `beginAttempt`. */
  project(request: { exerciseId: string; spec: Spec }): View | Promise<View>;
  grade(
    request: GradeRequest<Spec, Answer>,
  ): GradeResult | Promise<GradeResult>;
  /** Эталонный ответ для проверки компилятором (`E_REFERENCE_FAILS`); `undefined` — эталона нет. */
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

/** Чтение библиотеки курсов (пути от корня библиотеки, разделитель `/`). */
export interface LibraryReader {
  readText(path: string): Promise<string>;
  stat(path: string): Promise<LibraryStat | null>;
}

/** Бросается, когда расширение вызывает возможность без объявленного разрешения. */
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

/** Потолки хранилища расширения (R2); совпадают с потолками движка, который их и проверяет. */
export const EXTENSION_STORAGE_LIMITS = Object.freeze({
  /** Длина ключа в кодовых единицах UTF-16. */
  keyLength: 128,
  /** JSON-текст одного значения в байтах UTF-8. */
  valueBytes: 64 * 1024,
  /** Число ключей. */
  keys: 256,
  /** Сумма JSON-текстов всех значений в байтах UTF-8. */
  totalBytes: 1024 * 1024,
});

/** Какой потолок хранилища превышен. */
export type StorageQuotaKind =
  'key-length' | 'value-size' | 'key-count' | 'total-size';

/** Бросается `ctx.storage.set`, когда запись превысила потолок: запись не произошла, остальные данные не изменились. */
export class StorageQuotaError extends Error {
  readonly kind: StorageQuotaKind;
  /** Превышенный потолок: символы, байты или число ключей — по `kind`. */
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
 * Хранилище данных расширения: JSON по строковым ключам. У каждого расширения
 * своё пространство; данные переживают перезапуск, обновление и отключение.
 * Разрешение не требуется; потолки — `EXTENSION_STORAGE_LIMITS`.
 */
export interface ExtensionStorage {
  get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined>;
  /** Превышение потолка — `StorageQuotaError`, запись не происходит. */
  set(key: string, value: JsonValue): Promise<void>;
  /** `false`, если ключа не было. */
  delete(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
}

/** Изменение значения настройки: пользователь, «Сбросить» или «Очистить данные». */
export interface SettingChange {
  id: string;
  /** Действующее значение. */
  value: SettingValue;
}

/** Настройки расширения (`contributes.settings`). */
export interface ExtensionSettings {
  /** Текущее значение или `default`; `id`, не объявленный в манифесте, бросает. */
  get<T extends SettingValue = SettingValue>(id: string): T;
  /** Обработчик вызывается после изменения, без перезапуска расширения; сбой обработчика только логируется. */
  onDidChange(handler: (change: SettingChange) => void): Disposable;
}

export type LearningEventHandler<N extends LearningEventName> = (
  payload: LearningEventPayloads[N],
) => void | Promise<void>;

/** События обучения; нужны разрешение `learning.events` и объявление события в `contributes.events`. */
export interface ExtensionEvents {
  /**
   * Один обработчик на событие. Доставка асинхронная, по порядку, не более
   * одного раза; на обработчик — 2 с; сбой только логируется.
   */
  on<N extends LearningEventName>(
    name: N,
    handler: LearningEventHandler<N>,
  ): Disposable;
}

/** Команды расширения (`contributes.commands`). */
export interface ExtensionCommands {
  /**
   * `id` обязан быть объявлен в `commands` манифеста этого расширения, иначе
   * бросает; повторная регистрация бросает. Обработчик выполняется не дольше
   * `EXTENSION_COMMAND_LIMITS.handlerMs`; сбой и превышение бюджета уходят
   * вызывающему ошибкой.
   */
  register(id: string, handler: CommandHandler): Disposable;
}

export interface Disposable {
  dispose(): void | Promise<void>;
}

/** Совпадает по методам и сигнатурам с портом `Logger` движка. */
export interface ExtensionLogger {
  debug(fields: object, message?: string): void;
  info(fields: object, message?: string): void;
  warn(fields: object, message?: string): void;
  error(fields: object, message?: string): void;
}

export interface ExtensionContext {
  readonly extensionId: string;
  readonly logger: ExtensionLogger;
  readonly library: LibraryReader;
  readonly storage: ExtensionStorage;
  readonly settings: ExtensionSettings;
  readonly events: ExtensionEvents;
  readonly commands: ExtensionCommands;
  /** `type` обязан быть объявлен в манифесте этого расширения, иначе бросает. */
  registerExerciseType(type: string, handler: ExerciseTypeHandler): Disposable;
  /** `id` обязан быть объявлен в `gradePolicies` манифеста этого расширения, иначе бросает. */
  registerGradePolicy(id: string, handler: GradePolicyHandler): Disposable;
}

export interface ExtensionModule {
  activate(context: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
