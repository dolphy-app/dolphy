import type {
  ExtensionManifest,
  ExtensionManifestInput,
  GradePolicyContribution,
  JsonSchema,
} from '@lms/extension-api';
import type { Ajv2020 } from 'ajv/dist/2020.js';
import type { z } from 'zod';

export interface ResolvedExerciseType {
  id: string;
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
  rendererUrl: string;
}

export type ResolvedGradePolicy = GradePolicyContribution;

export interface ResolvedContributions {
  exerciseTypes: ResolvedExerciseType[];
  themes: ResolvedTheme[];
  markdownRenderers: ResolvedMarkdownRenderer[];
  gradePolicies: ResolvedGradePolicy[];
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
