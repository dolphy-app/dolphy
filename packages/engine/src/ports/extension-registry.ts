import type {
  ContributionsDto,
  ExtensionInfoDto,
} from '@dolphy-app/engine-contract';

/** Вклады без поколения: его ведёт движок (`ExtensionApply`), а не адаптер реестра. */
export type RegistryContributions = Omit<ContributionsDto, 'generation'>;

/** Обзор найденных расширений (загруженные, перекрытые, некорректные). */
export interface ExtensionRegistry {
  list(): readonly ExtensionInfoDto[];
  /** Вклады загруженных расширений; без встроенного правила оценки. */
  contributions(): RegistryContributions;
}
