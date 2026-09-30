import type { ExtensionInfoDto } from '@lms/engine-contract';
import type { ExtensionRegistry } from '@lms/engine/ports';
import type { DiscoveryResult, ResolvedExtension } from './discover.ts';

const NO_CONTRIBUTES: ExtensionInfoDto['contributes'] = {
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
};

const loaded = (extension: ResolvedExtension): ExtensionInfoDto => ({
  id: extension.id,
  version: extension.version,
  origin: extension.origin,
  state: 'loaded',
  contributes: {
    exerciseTypes: extension.exerciseTypes.map(({ id }) => id),
    themes: extension.themes.map(({ id }) => id),
    markdownRenderers: extension.markdownRenderers.map(
      ({ language }) => language,
    ),
    gradePolicies: extension.gradePolicies.map(({ id }) => id),
  },
  message: null,
});

/** Адаптер: результат обнаружения → порт `ExtensionRegistry`. */
export const createExtensionRegistry = (
  discovery: DiscoveryResult,
): ExtensionRegistry => {
  const overriddenItems: ExtensionInfoDto[] = discovery.overridden.map(
    ({ id, version, origin, by }) => ({
      id,
      version,
      origin,
      state: 'overridden',
      contributes: NO_CONTRIBUTES,
      message: `overridden by ${by.origin} ${by.version}`,
    }),
  );
  const invalidItems: ExtensionInfoDto[] = discovery.diagnostics.map(
    ({ extensionId, origin, message }) => ({
      id: extensionId,
      version: null,
      origin,
      state: 'invalid',
      contributes: NO_CONTRIBUTES,
      message,
    }),
  );
  const items = [
    ...discovery.extensions.map(loaded),
    ...overriddenItems,
    ...invalidItems,
  ];
  const { extensions } = discovery;
  return {
    list: () => items.map((item) => structuredClone(item)),
    contributions: () => ({
      themes: extensions.flatMap(({ id, themes }) =>
        themes.map((theme) => structuredClone({ ...theme, extensionId: id })),
      ),
      markdownRenderers: extensions.flatMap(({ id, markdownRenderers }) =>
        markdownRenderers.map((renderer) => ({
          ...renderer,
          extensionId: id,
        })),
      ),
      gradePolicies: extensions.flatMap(({ id, gradePolicies }) =>
        gradePolicies.map((policy) => ({
          id: policy.id,
          extensionId: id,
          label: policy.label,
        })),
      ),
    }),
  };
};
