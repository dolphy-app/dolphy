import type { ContributionsDto, ExtensionInfoDto } from '@lms/engine-contract';
import type { ExtensionRegistry } from '@lms/engine/ports';

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
