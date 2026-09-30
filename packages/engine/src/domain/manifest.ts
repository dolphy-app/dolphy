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
export type LiteracyLessonType = 'Reading' | 'Dictation';
export type TranscriptionLink = { YouTube: string };
export type LiteracyExample = [string, string | null];

/**
 * Варианты `Literacy`, `SoundSlice` и `Transcription` движок не исполняет:
 * они разбираются схемой (реальные манифесты Trane их содержат), компилятор
 * даёт `W_UNSUPPORTED_GENERATOR` и `W_ASSET_KIND_UNSUPPORTED`.
 */
export type ExerciseAsset =
  | { BasicAsset: BasicAsset }
  | { FlashcardAsset: { front_path: string; back_path: string | null } }
  | {
      InlineFlashcardAsset: {
        front_content: string;
        back_content: string | null;
      };
    }
  | {
      LiteracyAsset: {
        lesson_type: LiteracyLessonType;
        examples: LiteracyExample[];
        exceptions: LiteracyExample[];
      };
    }
  | {
      SoundSliceAsset: {
        link: string;
        description: string | null;
        backup: string | null;
      };
    }
  | {
      TranscriptionAsset: {
        content: string;
        external_link: TranscriptionLink | null;
      };
    };

export type TranscriptionAssetDefinition = {
  Track: {
    short_id: string;
    track_name: string;
    artist_name: string | null;
    album_name: string | null;
    duration: string | null;
    external_link: TranscriptionLink | null;
  };
};

export interface TranscriptionPassages {
  asset: TranscriptionAssetDefinition;
  intervals: Record<string, [string, string]>;
}

export interface KnowledgeBaseConfig {
  inlined: boolean;
}

export interface LiteracyConfig {
  generate_dictation: boolean;
  exercise_type: ExerciseType;
}

export interface TranscriptionConfig {
  transcription_dependencies: string[];
  passage_directory: string;
  inlined_passages: TranscriptionPassages[];
  skip_singing_lessons: boolean;
  skip_advanced_lessons: boolean;
}

export type CourseGenerator =
  | { KnowledgeBase: KnowledgeBaseConfig }
  | { Literacy: LiteracyConfig }
  | { Transcription: TranscriptionConfig };

export type Bloom =
  'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';

export interface ExerciseBlock {
  type: string;
  timeoutMs?: number;
  spec?: Record<string, unknown>;
}

export interface EngineExtension {
  exercise?: ExerciseBlock;
  keyPrerequisites?: string[];
  tags?: string[];
  bloom?: Bloom;
  dok?: 1 | 2 | 3 | 4;
  /** Курс: у каждого упражнения должен быть `engine.exercise`. */
  requiresChecks?: boolean;
  /** Урок: `true` — все охваты, массив — перечисленные id. */
  nonAncestor?: boolean | string[];
  /**
   * Курс: пороги числа упражнений на урок для `W_GRANULARITY`
   * (по умолчанию 3 и 12 [НЕ ПОДТВЕРЖДЕНО, engine-ts.md §12.18]).
   */
  granularity?: { min?: number; max?: number };
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

export interface Instrument {
  id: string;
  name: string;
}

export interface TranscriptionPreferences {
  instruments: Instrument[];
  download_path: string | null;
  download_path_alias: string | null;
}

export interface UserPreferences {
  scheduler: { batch_size: number | null } | null;
  ignored_paths: string[];
  /** Настройка загрузчика транскрипций Trane: разбирается, движком не используется. */
  transcription?: TranscriptionPreferences | null;
}
