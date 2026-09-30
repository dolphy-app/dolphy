/**
 * Виды заданий для `engine-cli --extensions`. Ядро от `@spirula-app/extension-host`
 * не зависит (хост зависит от `@spirula-app/engine`): пакеты подгружаются динамически
 * по имени, типы — локальные. Так CLI работает в монорепозитории, а сборка
 * ядра не тянет код хоста расширений.
 */
import type { CourseSource, Logger } from '../ports/index.ts';
import type { ExerciseTypes } from '../ports/exercise-types.ts';

export interface CliExerciseTypes {
  exerciseTypes: ExerciseTypes;
  close(): Promise<void>;
}

/** `roots` — каталоги-корни с подкаталогами `<id>/extension.json`. */
export type CreateExerciseTypes = (
  source: CourseSource,
  logger: Logger,
  roots: readonly string[],
) => Promise<CliExerciseTypes>;

interface ResolvedExtensionLike {
  id: string;
}

interface ExtensionHostModule {
  discoverExtensions(options: {
    roots: readonly { dir: string; origin: 'bundled' | 'user' }[];
    logger: Logger;
  }): Promise<{ extensions: ResolvedExtensionLike[] }>;
}

interface ExtensionHostLocalModule {
  createLocalExerciseTypes(options: {
    extensions: readonly ResolvedExtensionLike[];
    library: CourseSource;
    logger: Logger;
  }): ExerciseTypes;
}

/** Имена в переменных: без литерала `tsc` не пытается разрешить пакеты в этот проект. */
const HOST_PACKAGE = '@spirula-app/extension-host';
const HOST_LOCAL_PACKAGE = '@spirula-app/extension-host/local';

export class ExerciseTypesUnavailableError extends Error {}

export const loadExerciseTypes: CreateExerciseTypes = async (
  source,
  logger,
  roots,
) => {
  let host: ExtensionHostModule;
  let local: ExtensionHostLocalModule;
  try {
    host = (await import(HOST_PACKAGE)) as ExtensionHostModule;
    local = (await import(HOST_LOCAL_PACKAGE)) as ExtensionHostLocalModule;
  } catch (error) {
    throw new ExerciseTypesUnavailableError(
      `--extensions требует пакет ${HOST_PACKAGE}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const { extensions } = await host.discoverExtensions({
    roots: roots.map((dir) => ({ dir, origin: 'user' as const })),
    logger,
  });
  const exerciseTypes = local.createLocalExerciseTypes({
    extensions,
    library: source,
    logger,
  });
  return { exerciseTypes, close: () => exerciseTypes.close() };
};
