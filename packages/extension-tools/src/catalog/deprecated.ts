import { readFile } from 'node:fs/promises';
import {
  CatalogFormatError,
  parseDeprecatedList,
} from '@dolphy-app/extension-catalog';
import type {
  CatalogEntry,
  DeprecatedItem,
} from '@dolphy-app/extension-catalog';
import { BuildError } from '../errors.ts';

/** Reads `deprecated.json`; every problem is a `BuildError` (nothing is written by the caller). */
export const loadDeprecated = async (
  file: string,
): Promise<DeprecatedItem[]> => {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new BuildError(
      `deprecated list is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      file,
    );
  }
  try {
    return parseDeprecatedList(raw);
  } catch (error) {
    if (!(error instanceof CatalogFormatError)) throw error;
    throw new BuildError(
      `deprecated list is invalid: ${error.issues.join('; ')}`,
      file,
    );
  }
};

/** Problems of the list against the ids known to the index: unknown `id`, alternative missing from the index. */
export const deprecatedProblems = (
  items: readonly DeprecatedItem[],
  known: ReadonlySet<string>,
  { checkIds = true }: { checkIds?: boolean } = {},
): { id: string; field: string; message: string }[] =>
  items.flatMap((item) => [
    ...(checkIds && !known.has(item.id)
      ? [
          {
            id: item.id,
            field: 'id',
            message: `'${item.id}' is not in the index`,
          },
        ]
      : []),
    ...item.alternatives
      .filter((alternative) => !known.has(alternative))
      .map((alternative) => ({
        id: item.id,
        field: 'alternatives',
        message: `alternative '${alternative}' is not in the index`,
      })),
  ]);

/** Sets `deprecated` of the entries from the list and removes it from entries no longer listed. */
export const applyDeprecated = (
  entries: readonly CatalogEntry[],
  items: readonly DeprecatedItem[],
  file: string,
): CatalogEntry[] => {
  const problems = deprecatedProblems(
    items,
    new Set(entries.map(({ id }) => id)),
  );
  if (problems.length > 0) {
    throw new BuildError(
      problems.map(({ id, message }) => `${id}: ${message}`).join('; '),
      file,
    );
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  return entries.map((entry) => {
    const next: CatalogEntry = { ...entry };
    delete next.deprecated;
    const item = byId.get(entry.id);
    if (item !== undefined) {
      next.deprecated = {
        versions: item.versions ?? null,
        reason: item.reason,
        alternatives: [...item.alternatives],
      };
    }
    return next;
  });
};
