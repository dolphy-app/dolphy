import type { ExtensionInfoDto } from '@lms/engine-contract';
import type { ExtensionPolicy, ExtensionRegistry } from '@lms/engine/ports';
import type { DiscoveryResult, ResolvedExtension } from './discover.ts';

const NO_CONTRIBUTES: ExtensionInfoDto['contributes'] = {
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
};

const isolationOf = (
  extension: Pick<ResolvedExtension, 'id'>,
  policy: ExtensionPolicy,
): ExtensionInfoDto['isolation'] =>
  policy.isIsolated(extension.id) ? 'isolated' : 'trusted';

const loaded = (
  extension: ResolvedExtension,
  policy: ExtensionPolicy,
): ExtensionInfoDto => ({
  id: extension.id,
  version: extension.version,
  origin: extension.origin,
  state: policy.isEnabled(extension.id) ? 'loaded' : 'disabled',
  contributes: {
    exerciseTypes: extension.exerciseTypes.map(({ id }) => id),
    themes: extension.themes.map(({ id }) => id),
    markdownRenderers: extension.markdownRenderers.map(
      ({ language }) => language,
    ),
    gradePolicies: extension.gradePolicies.map(({ id }) => id),
  },
  message: null,
  permissions: [...extension.permissions],
  isolation: isolationOf(extension, policy),
  toggleable: extension.origin !== 'bundled',
});

/** Адаптер: результат обнаружения + политика → порт `ExtensionRegistry`; политика читается при каждом вызове. */
export const createExtensionRegistry = (
  discovery: DiscoveryResult,
  policy: ExtensionPolicy,
): ExtensionRegistry => {
  const overriddenItems: ExtensionInfoDto[] = discovery.overridden.map(
    ({ id, version, origin, by }) => ({
      id,
      version,
      origin,
      state: 'overridden',
      contributes: NO_CONTRIBUTES,
      message: `overridden by ${by.origin} ${by.version}`,
      permissions: [],
      isolation: origin === 'bundled' ? 'trusted' : 'isolated',
      toggleable: false,
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
      permissions: [],
      isolation: origin === 'bundled' ? 'trusted' : 'isolated',
      toggleable: false,
    }),
  );
  const { extensions } = discovery;
  const enabled = (): ResolvedExtension[] =>
    extensions.filter(({ id }) => policy.isEnabled(id));
  return {
    list: () =>
      [
        ...extensions.map((extension) => loaded(extension, policy)),
        ...overriddenItems,
        ...invalidItems,
      ].map((item) => structuredClone(item)),
    contributions: () => ({
      themes: enabled().flatMap(({ id, themes }) =>
        themes.map((theme) => structuredClone({ ...theme, extensionId: id })),
      ),
      markdownRenderers: enabled().flatMap((extension) =>
        extension.markdownRenderers.map((renderer) => ({
          ...renderer,
          extensionId: extension.id,
          isolated: policy.isIsolated(extension.id),
        })),
      ),
      gradePolicies: enabled().flatMap(({ id, gradePolicies }) =>
        gradePolicies.map((policyItem) => ({
          id: policyItem.id,
          extensionId: id,
          label: policyItem.label,
        })),
      ),
    }),
  };
};
