import path from 'node:path';
import type {
  ExtensionClientDto,
  ExtensionInfoDto,
} from '@dolphy-app/engine-contract';
import type {
  ExtensionPolicy,
  ExtensionRegistry,
} from '@dolphy-app/engine/ports';
import type { ExtensionCandidate, ResolvedExtension } from './discover.ts';
import type { DiscoverySource } from './holder.ts';
import { revocationReason } from './revocation.ts';
import type { RevocationLookup } from './revocation.ts';

const NO_CONTRIBUTES: ExtensionInfoDto['contributes'] = {
  exerciseTypes: [],
  gradePolicies: [],
  settings: [],
  events: [],
  commands: [],
  schedules: [],
  importers: [],
  exporters: [],
};

/** Перекрытые и некорректные расширения манифеста не дали; удалить можно пользовательский каталог. */
const withoutMetadata = (
  origin: ExtensionInfoDto['origin'],
): Pick<
  ExtensionInfoDto,
  | 'name'
  | 'description'
  | 'author'
  | 'dependencies'
  | 'icon'
  | 'tags'
  | 'installed'
  | 'removable'
  | 'revoked'
  | 'deprecated'
> => ({
  name: null,
  description: null,
  author: null,
  dependencies: [],
  icon: null,
  tags: [],
  installed: null,
  removable: origin === 'user',
  revoked: null,
  deprecated: null,
});

/** Идентификаторы серверных вкладов расширения в том же виде, что в записи каталога. */
export const contributesOf = (
  extension: Pick<
    ResolvedExtension,
    | 'exerciseTypes'
    | 'gradePolicies'
    | 'settings'
    | 'events'
    | 'commands'
    | 'schedules'
    | 'importers'
    | 'exporters'
  >,
): ExtensionInfoDto['contributes'] => ({
  exerciseTypes: extension.exerciseTypes.map(({ id }) => id),
  gradePolicies: extension.gradePolicies.map(({ id }) => id),
  settings: extension.settings.map(({ id }) => id),
  events: [...extension.events],
  commands: extension.commands.map(({ id }) => id),
  schedules: extension.schedules.map(({ id }) => id),
  importers: extension.importers.map(({ id }) => id),
  exporters: extension.exporters.map(({ id }) => id),
});

/** `dolphy-ext://<id>/<путь клиентской части от каталога расширения>`. */
const clientUrlOf = (
  { id, dir }: Pick<ExtensionCandidate, 'id' | 'dir'>,
  clientPath: string,
): string =>
  `dolphy-ext://${id}/${path
    .relative(dir, clientPath)
    .split(path.sep)
    .map(encodeURIComponent)
    .join('/')}`;

const loaded = (
  extension: ResolvedExtension,
  policy: ExtensionPolicy,
  revocationOf: RevocationLookup | undefined,
): ExtensionInfoDto => {
  const revoked = revocationReason(extension, revocationOf);
  const issues = policy.dependencyIssues(extension.id);
  let state: ExtensionInfoDto['state'] = 'disabled';
  if (issues.length > 0) state = 'dependencies-unmet';
  else if (policy.isEnabled(extension.id)) state = 'loaded';
  return {
    id: extension.id,
    version: extension.version,
    origin: extension.origin,
    state,
    contributes: contributesOf(extension),
    diagnostics: [
      ...(policy.safeMode() && extension.origin !== 'bundled'
        ? [{ code: 'safe-mode' as const, data: {} }]
        : []),
      ...issues,
      ...extension.warnings,
    ],
    toggleable: extension.origin !== 'bundled' && revoked === null,
    name: extension.name,
    description: extension.description,
    author: extension.author,
    dependencies: extension.dependencies.map(({ id, range }) => ({
      id,
      range,
    })),
    icon: extension.icon,
    tags: [...extension.tags],
    installed: extension.install === null ? null : { ...extension.install },
    removable: extension.origin === 'user',
    revoked,
    // пометку «устарело» накладывает сервис `extensions.list`: реестр о каталоге знает только отзыв
    deprecated: null,
  };
};

/**
 * Адаптер: снимок обнаружения + политика → порт `ExtensionRegistry`; снимок,
 * политика и отзыв (`revocationOf`, из установщика) читаются при каждом вызове.
 */
export const createExtensionRegistry = (
  discovery: DiscoverySource,
  policy: ExtensionPolicy,
  revocationOf?: RevocationLookup,
): ExtensionRegistry => {
  const overriddenItems = (): ExtensionInfoDto[] =>
    discovery.get().overridden.map(({ id, version, origin, by }) => ({
      id,
      version,
      origin,
      state: 'overridden',
      contributes: NO_CONTRIBUTES,
      diagnostics: [
        {
          code: 'overridden-by',
          data: { origin: by.origin, version: by.version },
        },
      ],
      toggleable: false,
      ...withoutMetadata(origin),
    }));
  const invalidItems = (): ExtensionInfoDto[] =>
    discovery.get().diagnostics.map(({ extensionId, origin, diagnostic }) => ({
      id: extensionId,
      version: null,
      origin,
      state: 'invalid',
      contributes: NO_CONTRIBUTES,
      diagnostics: [diagnostic],
      toggleable: false,
      ...withoutMetadata(origin),
    }));
  const enabled = (): ResolvedExtension[] =>
    discovery.get().extensions.filter(({ id }) => policy.isEnabled(id));
  return {
    list: () =>
      [
        ...discovery
          .get()
          .extensions.map((extension) =>
            loaded(extension, policy, revocationOf),
          ),
        ...overriddenItems(),
        ...invalidItems(),
      ].map((item) => structuredClone(item)),
    contributions: () => ({
      clients: enabled().flatMap((extension): ExtensionClientDto[] =>
        extension.clientPath === null
          ? []
          : [
              {
                extensionId: extension.id,
                url: clientUrlOf(extension, extension.clientPath),
                origin: extension.origin,
                revision: extension.revision,
              },
            ],
      ),
      exerciseTypes: enabled().flatMap((extension) =>
        extension.exerciseTypes.map((type) => ({
          type: type.id,
          extensionId: extension.id,
          title: type.title,
        })),
      ),
      gradePolicies: enabled().flatMap(({ id, gradePolicies }) =>
        gradePolicies.map((policyItem) => ({
          id: policyItem.id,
          extensionId: id,
          label: policyItem.label,
        })),
      ),
      settings: enabled().flatMap(({ id, settings }) =>
        settings.map((setting) =>
          structuredClone({ ...setting, extensionId: id }),
        ),
      ),
      commands: enabled().flatMap(({ id, commands }) =>
        commands.map((command) =>
          structuredClone({ ...command, extensionId: id }),
        ),
      ),
      schedules: enabled().flatMap(({ id, schedules }) =>
        schedules.map((schedule) => ({ ...schedule, extensionId: id })),
      ),
      importers: enabled().flatMap(({ id, importers }) =>
        importers.map((importer) => ({
          ...importer,
          accept: [...importer.accept],
          extensionId: id,
        })),
      ),
      exporters: enabled().flatMap(({ id, exporters }) =>
        exporters.map((exporter) => ({ ...exporter, extensionId: id })),
      ),
    }),
  };
};
