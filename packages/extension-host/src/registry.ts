import type { ExtensionInfoDto } from '@dolphy-app/engine-contract';
import type {
  ExtensionPolicy,
  ExtensionRegistry,
} from '@dolphy-app/engine/ports';
import type { ResolvedExtension } from './discover.ts';
import type { DiscoverySource } from './holder.ts';
import { revocationReason } from './revocation.ts';
import type { RevocationLookup } from './revocation.ts';

const NO_CONTRIBUTES: ExtensionInfoDto['contributes'] = {
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
  settings: [],
  events: [],
  commands: [],
  panels: [],
  widgets: [],
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
  | 'titles'
  | 'messages'
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
  titles: {},
  messages: {},
  tags: [],
  installed: null,
  removable: origin === 'user',
  revoked: null,
  deprecated: null,
});

/** Идентификаторы вкладов расширения в том же виде, что в записи каталога. */
export const contributesOf = (
  extension: Pick<
    ResolvedExtension,
    | 'exerciseTypes'
    | 'themes'
    | 'markdownRenderers'
    | 'gradePolicies'
    | 'settings'
    | 'events'
    | 'commands'
    | 'panels'
    | 'widgets'
    | 'schedules'
    | 'importers'
    | 'exporters'
  >,
): ExtensionInfoDto['contributes'] => ({
  exerciseTypes: extension.exerciseTypes.map(({ id }) => id),
  themes: extension.themes.map(({ id }) => id),
  markdownRenderers: extension.markdownRenderers.map(
    ({ language }) => language,
  ),
  gradePolicies: extension.gradePolicies.map(({ id }) => id),
  settings: extension.settings.map(({ id }) => id),
  events: extension.events.map(({ event }) => event),
  commands: extension.commands.map(({ id }) => id),
  panels: extension.panels.map(({ id }) => id),
  widgets: extension.widgets.map(({ id }) => id),
  schedules: extension.schedules.map(({ id }) => id),
  importers: extension.importers.map(({ id }) => id),
  exporters: extension.exporters.map(({ id }) => id),
});

/** Названия вкладов с `label`/`title` в том же виде, что `titles` записи каталога; пустые точки опущены. */
export const titlesOf = (
  extension: Pick<
    ResolvedExtension,
    | 'exerciseTypes'
    | 'markdownRenderers'
    | 'themes'
    | 'gradePolicies'
    | 'settings'
    | 'commands'
    | 'panels'
    | 'widgets'
    | 'importers'
    | 'exporters'
  >,
): ExtensionInfoDto['titles'] => {
  const titles: ExtensionInfoDto['titles'] = {};
  const add = (
    point: keyof ExtensionInfoDto['titles'],
    items: readonly { id: string }[],
    title: (item: never) => string,
  ): void => {
    if (items.length === 0) return;
    titles[point] = Object.fromEntries(
      items.map((item) => [item.id, title(item as never)]),
    );
  };
  const titled = <T extends { title: string | null }>(items: readonly T[]) =>
    items.filter(({ title }) => title !== null);
  add(
    'exerciseTypes',
    titled(extension.exerciseTypes),
    (item: { title: string }) => item.title,
  );
  add(
    'markdownRenderers',
    titled(extension.markdownRenderers).map((item) => ({
      ...item,
      id: item.language,
    })),
    (item: { title: string }) => item.title,
  );
  add('themes', extension.themes, (item: { label: string }) => item.label);
  add(
    'gradePolicies',
    extension.gradePolicies,
    (item: { label: string }) => item.label,
  );
  add('settings', extension.settings, (item: { label: string }) => item.label);
  add('commands', extension.commands, (item: { title: string }) => item.title);
  add('panels', extension.panels, (item: { title: string }) => item.title);
  add('widgets', extension.widgets, (item: { title: string }) => item.title);
  add(
    'importers',
    extension.importers,
    (item: { title: string }) => item.title,
  );
  add(
    'exporters',
    extension.exporters,
    (item: { title: string }) => item.title,
  );
  return titles;
};

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
    titles: titlesOf(extension),
    messages: extension.messages,
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
      exerciseTypes: enabled().flatMap((extension) =>
        extension.exerciseTypes.map((type) => ({
          type: type.id,
          extensionId: extension.id,
          rendererUrl: type.rendererUrl,
          origin: extension.origin,
          revision: extension.revision,
        })),
      ),
      themes: enabled().flatMap(({ id, themes }) =>
        themes.map((theme) => structuredClone({ ...theme, extensionId: id })),
      ),
      markdownRenderers: enabled().flatMap((extension) =>
        extension.markdownRenderers.map((renderer) => ({
          language: renderer.language,
          rendererUrl: renderer.rendererUrl,
          extensionId: extension.id,
          origin: extension.origin,
          revision: extension.revision,
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
        commands.map((command) => ({ ...command, extensionId: id })),
      ),
      panels: enabled().flatMap((extension) =>
        extension.panels.map((panel) => ({
          ...panel,
          extensionId: extension.id,
          origin: extension.origin,
          revision: extension.revision,
        })),
      ),
      widgets: enabled().flatMap((extension) =>
        extension.widgets.map((widget) => ({
          ...widget,
          extensionId: extension.id,
          origin: extension.origin,
          revision: extension.revision,
        })),
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
      messages: Object.fromEntries(
        enabled()
          .filter(({ messages }) => Object.keys(messages).length > 0)
          .map(({ id, messages }) => [id, messages]),
      ),
    }),
  };
};
