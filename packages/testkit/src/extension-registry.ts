import type {
  ContributionsDto,
  ExtensionInfoDto,
} from '@dolphy-app/engine-contract';
import type { ExtensionRegistry } from '@dolphy-app/engine/ports';

/** Реестр расширений с фиксированным содержимым (по умолчанию пуст). */
export const createFakeExtensionRegistry = (
  items: readonly ExtensionInfoDto[] = [],
  contributions: ContributionsDto = {
    themes: [],
    markdownRenderers: [],
    gradePolicies: [],
  },
): ExtensionRegistry => ({
  list: () => items,
  contributions: () => contributions,
});
