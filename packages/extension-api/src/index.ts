/**
 * Публичный API расширений. Пакет не зависит от движка и DOM: его импортируют
 * и код расширения (`main.mjs`), и элемент ответа (`view.mjs`), и сам движок.
 */

export const EXTENSION_API_VERSION = 1 as const;
export const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
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

/** Нормализованный манифест: все умолчания применены. */
export interface ExtensionManifest {
  id: string;
  /** semver */
  version: string;
  apiVersion: typeof EXTENSION_API_VERSION;
  /** Путь к `.mjs` с кодом расширения: `export default` — `ExtensionModule`. */
  main: string;
  contributes: { exerciseTypes: ExerciseTypeContribution[] };
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
  /** По умолчанию `DEFAULT_MAIN`. */
  main?: string;
  contributes: { exerciseTypes: ExerciseTypeContributionInput[] };
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
}

export interface ExtensionModule {
  activate(context: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
