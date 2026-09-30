/**
 * Публичный API расширений. Пакет не зависит от движка и DOM: его импортируют
 * и код расширения (`main.mjs`), и элемент ответа (`view.mjs`), и сам движок.
 */

export const EXTENSION_API_VERSION = 1 as const;
export const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
/** Возможности, которые расширение объявляет в манифесте; без объявления — ни одной. */
export const EXTENSION_PERMISSIONS = [
  'library.read',
  'process.spawn',
  'worker.threads',
  'native.addons',
  'network',
] as const;
export type ExtensionPermission = (typeof EXTENSION_PERMISSIONS)[number];
export const ELEMENT_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

/** Имена событий custom element'а ответа. */
export const ANSWER_EVENT = {
  change: 'lms-answer-change',
  submit: 'lms-answer-submit',
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
  contributes: {
    exerciseTypes: ExerciseTypeContribution[];
    themes: ThemeContribution[];
    markdownRenderers: (MarkdownRendererContribution & {
      renderer: string;
    })[];
    gradePolicies: GradePolicyContribution[];
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
  contributes: {
    exerciseTypes?: ExerciseTypeContributionInput[];
    themes?: ThemeContribution[];
    markdownRenderers?: MarkdownRendererContribution[];
    gradePolicies?: GradePolicyContribution[];
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

export const DEFAULT_MAIN = './main.mjs';
export const DEFAULT_RENDERER = './view.mjs';

/** Тег элемента по умолчанию: `lms.sql` → `lms-sql-answer`. */
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
  /** `type` обязан быть объявлен в манифесте этого расширения, иначе бросает. */
  registerExerciseType(type: string, handler: ExerciseTypeHandler): Disposable;
  /** `id` обязан быть объявлен в `gradePolicies` манифеста этого расширения, иначе бросает. */
  registerGradePolicy(id: string, handler: GradePolicyHandler): Disposable;
}

export interface ExtensionModule {
  activate(context: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
