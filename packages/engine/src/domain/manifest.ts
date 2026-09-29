/**
 * Wire-типы манифестов Trane v0.34.1 после применения умолчаний схемы:
 * необязательные поля Rust — `T | null`, enum внешне тегированы
 * (`{ Variant: payload }`), unit-варианты — строки. Расширение `engine` —
 * необязательный объект, который Trane игнорирует (engine-ts.md §5.4).
 * Источник: engine-ts/spike/loader-bench/src/types.ts, spike/compiler/src/schema.ts.
 */
export type Metadata = Record<string, string[]>;
export type EncompassedEntry = [id: string, weight: number];

export type BasicAsset =
  | { MarkdownAsset: { path: string } }
  | { InlinedAsset: { content: string } }
  | { InlinedUniqueAsset: { content: string } };

export type ExerciseType = 'Declarative' | 'Procedural';

export type ExerciseAsset =
  | { BasicAsset: BasicAsset }
  | { FlashcardAsset: { front_path: string; back_path: string | null } }
  | {
      InlineFlashcardAsset: {
        front_content: string;
        back_content: string | null;
      };
    };

export type CourseGenerator = { KnowledgeBase: { inlined: boolean } };

export type Bloom =
  'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';

export interface Verification {
  runner: string;
  timeoutMs?: number;
  /** Параметры раннера (`fixture`, `expected`, …). */
  [param: string]: unknown;
}

export interface EngineExtension {
  verification?: Verification;
  keyPrerequisites?: string[];
  tags?: string[];
  bloom?: Bloom;
  dok?: 1 | 2 | 3 | 4;
  /** Курс: у каждого упражнения должна быть `verification`. */
  requiresChecks?: boolean;
  /** Урок: `true` — все охваты, массив — перечисленные id. */
  nonAncestor?: boolean | string[];
}

export interface CourseManifest {
  id: string;
  name: string;
  dependencies: string[];
  encompassed: EncompassedEntry[];
  superseded: string[];
  description: string | null;
  authors: string[] | null;
  metadata: Metadata | null;
  course_material: BasicAsset | null;
  course_instructions: BasicAsset | null;
  generator_config: CourseGenerator | null;
  engine?: EngineExtension;
}

export interface LessonManifest {
  id: string;
  dependencies: string[];
  encompassed: EncompassedEntry[];
  superseded: string[];
  course_id: string;
  name: string;
  description: string | null;
  metadata: Metadata | null;
  lesson_material: BasicAsset | null;
  lesson_instructions: BasicAsset | null;
  engine?: EngineExtension;
}

export interface ExerciseManifest {
  id: string;
  lesson_id: string;
  course_id: string;
  name: string;
  description: string | null;
  exercise_type: ExerciseType;
  exercise_asset: ExerciseAsset;
  engine?: EngineExtension;
}

export interface UserPreferences {
  scheduler: { batch_size: number | null } | null;
  ignored_paths: string[];
}
