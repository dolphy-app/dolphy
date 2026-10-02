import type { ExtensionInfoDto } from '@dolphy-app/engine-contract';
import type {
  ExtensionRegistry,
  RegistryContributions,
} from '@dolphy-app/engine/ports';

/** Реестр расширений с фиксированным содержимым (по умолчанию пуст). */
export const createFakeExtensionRegistry = (
  items: readonly ExtensionInfoDto[] = [],
  contributions: RegistryContributions = {
    exerciseTypes: [],
    themes: [],
    markdownRenderers: [],
    gradePolicies: [],
    settings: [],
  },
): ExtensionRegistry => ({
  list: () => items,
  contributions: () => contributions,
});
