import type {
  ContributionsDto,
  ExtensionInfoDto,
} from '@spirula/engine-contract';
import type { ExtensionRegistry } from '@spirula/engine/ports';

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
