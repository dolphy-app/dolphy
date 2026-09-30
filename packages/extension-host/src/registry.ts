import type { ExtensionInfoDto } from '@lms/engine-contract';
import type { ExtensionRegistry } from '@lms/engine/ports';
import type { DiscoveryResult, ResolvedExtension } from './discover.ts';

const loaded = (extension: ResolvedExtension): ExtensionInfoDto => ({
  id: extension.id,
  version: extension.version,
  origin: extension.origin,
  state: 'loaded',
  exerciseTypes: extension.exerciseTypes.map(({ id }) => id),
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
      exerciseTypes: [],
      message: `overridden by ${by.origin} ${by.version}`,
    }),
  );
  const invalidItems: ExtensionInfoDto[] = discovery.diagnostics.map(
    ({ extensionId, origin, message }) => ({
      id: extensionId,
      version: null,
      origin,
      state: 'invalid',
      exerciseTypes: [],
      message,
    }),
  );
  const items = [
    ...discovery.extensions.map(loaded),
    ...overriddenItems,
    ...invalidItems,
  ];
  return { list: () => items.map((item) => structuredClone(item)) };
};
