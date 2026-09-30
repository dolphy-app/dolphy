import type { ExtensionInfoDto } from '@spirula-app/engine-contract';
import type {
  ExtensionPolicy,
  ExtensionRegistry,
} from '@spirula-app/engine/ports';
import type { DiscoveryResult, ResolvedExtension } from './discover.ts';
import { revocationReason } from './revocation.ts';
import type { RevocationLookup } from './revocation.ts';

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

/** Перекрытые и некорректные расширения манифеста не дали; удалить можно пользовательский каталог. */
const withoutMetadata = (
  origin: ExtensionInfoDto['origin'],
): Pick<
  ExtensionInfoDto,
  'name' | 'description' | 'author' | 'installed' | 'removable' | 'revoked'
> => ({
  name: null,
  description: null,
  author: null,
  installed: null,
  removable: origin === 'user',
  revoked: null,
});

/** Идентификаторы вкладов расширения в том же виде, что в записи каталога. */
export const contributesOf = (
  extension: Pick<
    ResolvedExtension,
    'exerciseTypes' | 'themes' | 'markdownRenderers' | 'gradePolicies'
  >,
): ExtensionInfoDto['contributes'] => ({
  exerciseTypes: extension.exerciseTypes.map(({ id }) => id),
  themes: extension.themes.map(({ id }) => id),
  markdownRenderers: extension.markdownRenderers.map(
    ({ language }) => language,
  ),
  gradePolicies: extension.gradePolicies.map(({ id }) => id),
});

const loaded = (
  extension: ResolvedExtension,
  policy: ExtensionPolicy,
  revocationOf: RevocationLookup | undefined,
): ExtensionInfoDto => {
  const revoked = revocationReason(extension, revocationOf);
  return {
    id: extension.id,
    version: extension.version,
    origin: extension.origin,
    state: policy.isEnabled(extension.id) ? 'loaded' : 'disabled',
    contributes: contributesOf(extension),
    message: revoked,
    permissions: [...extension.permissions],
    isolation: isolationOf(extension, policy),
    toggleable: extension.origin !== 'bundled' && revoked === null,
    name: extension.name,
    description: extension.description,
    author: extension.author,
    installed: extension.install === null ? null : { ...extension.install },
    removable: extension.origin === 'user',
    revoked,
  };
};

/**
 * Адаптер: результат обнаружения + политика → порт `ExtensionRegistry`;
 * политика и отзыв (`revocationOf`, из установщика) читаются при каждом вызове.
 */
export const createExtensionRegistry = (
  discovery: DiscoveryResult,
  policy: ExtensionPolicy,
  revocationOf?: RevocationLookup,
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
      ...withoutMetadata(origin),
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
      ...withoutMetadata(origin),
    }),
  );
  const { extensions } = discovery;
  const enabled = (): ResolvedExtension[] =>
    extensions.filter(({ id }) => policy.isEnabled(id));
  return {
    list: () =>
      [
        ...extensions.map((extension) =>
          loaded(extension, policy, revocationOf),
        ),
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
