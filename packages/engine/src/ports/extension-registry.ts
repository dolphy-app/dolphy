import type { ExtensionInfoDto } from '@lms/engine-contract';

/** Обзор найденных расширений (загруженные, перекрытые, некорректные). */
export interface ExtensionRegistry {
  list(): readonly ExtensionInfoDto[];
}
