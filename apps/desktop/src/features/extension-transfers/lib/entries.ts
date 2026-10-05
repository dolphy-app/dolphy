import type {
  ContributionsDto,
  ExporterContributionDto,
  ImporterContributionDto,
} from '@dolphy-app/engine-contract';

export type TransferEntry =
  | { kind: 'import'; importer: ImporterContributionDto }
  | { kind: 'export'; exporter: ExporterContributionDto };

const compare = (left: string, right: string): number => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

/** Ключ записи в реестре команд; слово вида отделяет её от команд расширения (`extension:<id>:<команда>`). */
export const transferCommandKey = (
  kind: 'import' | 'export',
  extensionId: string,
  id: string,
): string => `extension:${extensionId}:${kind}:${id}`;

/** Все импортёры, затем экспортёры включённых расширений: по id расширения, затем в порядке вклада. */
export const transferEntries = (
  contributions: Pick<ContributionsDto, 'importers' | 'exporters'>,
): {
  importers: ImporterContributionDto[];
  exporters: ExporterContributionDto[];
} => {
  const sorted = <T extends { extensionId: string }>(items: T[]): T[] =>
    items
      .map((item, index) => ({ item, index }))
      .sort(
        (left, right) =>
          compare(left.item.extensionId, right.item.extensionId) ||
          left.index - right.index,
      )
      .map(({ item }) => item);
  return {
    importers: sorted(contributions.importers),
    exporters: sorted(contributions.exporters),
  };
};
