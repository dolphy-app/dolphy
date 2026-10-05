import type {
  CommandContributionDto,
  ExporterContributionDto,
  ExtensionSettingDefDto,
  ImporterContributionDto,
  PanelContributionDto,
  ScheduleContributionDto,
  WidgetContributionDto,
} from '@dolphy-app/engine-contract';
import type {
  EventContribution,
  ExtensionManifest,
  ExtensionManifestInput,
  GradePolicyContribution,
  JsonSchema,
} from '@dolphy-app/extension-api';
import type { Ajv2020 } from 'ajv/dist/2020.js';
import type { z } from 'zod';

export interface ResolvedExerciseType {
  id: string;
  /** Название для чипа вклада; `null` — показывается id. */
  title: string | null;
  specSchema: JsonSchema;
  answerSchema: JsonSchema;
  element: string;
  rendererUrl: string;
}

export interface ResolvedTheme {
  id: string;
  label: string;
  dark: boolean;
  colors: Record<string, string>;
  variables: Record<string, string | number>;
}

export interface ResolvedMarkdownRenderer {
  language: string;
  /** Название для чипа вклада; `null` — показывается язык. */
  title: string | null;
  rendererUrl: string;
}

export type ResolvedGradePolicy = GradePolicyContribution;

type WithoutExtension<T> = T extends unknown ? Omit<T, 'extensionId'> : never;

/** Определение настройки в виде, в котором его получает окно (DTO движка без `extensionId`). */
export type ResolvedSetting = WithoutExtension<ExtensionSettingDefDto>;

export type ResolvedEvent = EventContribution;

/** Команда в виде, в котором её получает окно (DTO движка без `extensionId`). */
export type ResolvedCommand = Omit<CommandContributionDto, 'extensionId'>;

/** Панель: модуль в рамке; `isolated`, `origin` и `revision` добавляет реестр. */
export type ResolvedPanel = Pick<
  PanelContributionDto,
  'id' | 'title' | 'icon' | 'rendererUrl'
>;

/** Виджет: модуль в рамке; `isolated`, `origin` и `revision` добавляет реестр. */
export type ResolvedWidget = Pick<
  WidgetContributionDto,
  'id' | 'title' | 'slot' | 'minHeight' | 'maxHeight' | 'rendererUrl'
>;

/** Расписание в виде, в котором его получает окно (DTO движка без `extensionId`). */
export type ResolvedSchedule = Omit<ScheduleContributionDto, 'extensionId'>;

/** Импортёр в виде, в котором его получает окно (DTO движка без `extensionId`). */
export type ResolvedImporter = Omit<ImporterContributionDto, 'extensionId'>;

/** Экспортёр в виде, в котором его получает окно (DTO движка без `extensionId`). */
export type ResolvedExporter = Omit<ExporterContributionDto, 'extensionId'>;

export interface ResolvedContributions {
  exerciseTypes: ResolvedExerciseType[];
  themes: ResolvedTheme[];
  markdownRenderers: ResolvedMarkdownRenderer[];
  gradePolicies: ResolvedGradePolicy[];
  settings: ResolvedSetting[];
  events: ResolvedEvent[];
  commands: ResolvedCommand[];
  panels: ResolvedPanel[];
  widgets: ResolvedWidget[];
  schedules: ResolvedSchedule[];
  importers: ResolvedImporter[];
  exporters: ResolvedExporter[];
}

export type PointKey = keyof ResolvedContributions;

export type PointInput<K extends PointKey> = NonNullable<
  ExtensionManifestInput['contributes'][K]
>;

export type PointEntries<K extends PointKey> =
  ExtensionManifest['contributes'][K];

export interface ResolveContext {
  dir: string;
  extensionId: string;
  verifyFiles: boolean;
  ajv: Ajv2020;
}

/** Точка вклада: всё, что манифест и обнаружение знают о ключе `contributes`. */
export interface ContributionPoint<K extends PointKey = PointKey> {
  key: K;
  /** Схема одной записи массива в `extension.json`. */
  schema: z.ZodType;
  /** Записям нужен код расширения (`main`). */
  needsMain: boolean;
  /** Применяет умолчания к записям. */
  normalize(entries: PointInput<K>): PointEntries<K>;
  /** Сообщения о нарушениях в нормализованных записях (с путём `contributes.<key>.<i>`). */
  check(entries: PointEntries<K>, extensionId: string): string[];
  /** Проверяет файлы и загружает данные; ошибка — расширение пропускается. */
  resolve(
    entries: PointEntries<K>,
    context: ResolveContext,
  ): Promise<ResolvedContributions[K]>;
  /** Глобально уникальные строки `вид:значение`. */
  claims(resolved: ResolvedContributions[K]): string[];
}
