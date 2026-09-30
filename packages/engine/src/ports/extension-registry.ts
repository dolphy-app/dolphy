import type {
  ContributionsDto,
  ExtensionInfoDto,
} from '@dolphy-app/engine-contract';

/** Обзор найденных расширений (загруженные, перекрытые, некорректные). */
export interface ExtensionRegistry {
  list(): readonly ExtensionInfoDto[];
  /** Вклады загруженных расширений; без встроенного правила оценки. */
  contributions(): ContributionsDto;
}
