import type {
  CatalogEntry,
  CatalogVersion,
} from '@dolphy-app/extension-catalog';
import type { InspectedManifest } from './options.ts';

const CONTRIBUTION_KEYS = [
  'exerciseTypes',
  'themes',
  'markdownRenderers',
  'gradePolicies',
  'settings',
  'events',
  'commands',
  'panels',
  'widgets',
  'schedules',
  'importers',
  'exporters',
] as const;

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((x) => right.has(x));
};

const dependencyKeys = (
  dependencies: readonly { id: string; range?: string | null | undefined }[],
): string[] => dependencies.map(({ id, range }) => `${id}@${range ?? ''}`);

/** Сообщение о расхождении скачанного каталога с записью индекса; `null` — совпадает. */
export const manifestMismatch = (
  manifest: InspectedManifest,
  entry: CatalogEntry,
  version: CatalogVersion,
): string | null => {
  if (manifest.id !== entry.id) {
    return `manifest id '${manifest.id}' differs from catalog id '${entry.id}'`;
  }
  if (manifest.version !== version.version) {
    return `manifest version '${manifest.version}' differs from catalog version '${version.version}'`;
  }
  if (manifest.icon !== (version.icon ?? null)) {
    return 'manifest icon differs from the catalog entry';
  }
  if (!sameSet(manifest.tags, version.tags ?? [])) {
    return 'manifest tags differ from the catalog entry';
  }
  if (
    !sameSet(
      dependencyKeys(manifest.dependencies),
      dependencyKeys(version.dependencies ?? []),
    )
  ) {
    return 'manifest dependencies differ from the catalog entry';
  }
  const changed = CONTRIBUTION_KEYS.find(
    (key) => !sameSet(manifest.contributes[key], entry.contributes[key] ?? []),
  );
  return changed === undefined
    ? null
    : `manifest contributions (${changed}) differ from the catalog entry`;
};
