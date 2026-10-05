import { syncCommands } from '@/shared/lib/command-registry.ts';
import type { CommandRegistry } from '@/shared/lib/command-registry.ts';
import { textOfExtension } from '@/shared/lib/extension-text.ts';
import type { ContributionsDto } from '@dolphy-app/engine-contract';
import { transferCommandKey, transferEntries } from '../lib/entries.ts';
import type { ExtensionTransfers, Translate } from './transfers.ts';

/**
 * Держит в реестре команды «Импорт: …» и «Экспорт: …» по вкладам включённых
 * расширений: пропавшие (расширение отключено или удалено) снимаются без
 * перезагрузки окна. Название — данные расширения (`%ключ%` подставляет
 * `locale`), слово «Импорт»/«Экспорт» и категория — перевод окна. Возвращает
 * остановку со снятием всех записей.
 */
export const syncTransferCommands = (
  registry: CommandRegistry,
  contributions: () => Readonly<ContributionsDto>,
  transfers: Pick<ExtensionTransfers, 'startImport' | 'startExport'>,
  t: Translate,
  locale: () => string,
): (() => void) =>
  syncCommands(registry, () => {
    const { importers, exporters } = transferEntries(contributions());
    const titleOf = (extensionId: string, value: string) =>
      textOfExtension(value, extensionId, contributions(), locale());
    return [
      ...importers.map((importer) => ({
        descriptor: {
          key: transferCommandKey('import', importer.extensionId, importer.id),
          source: 'extension' as const,
          title: () =>
            t('transfers.command.import', {
              title: titleOf(importer.extensionId, importer.title),
            }),
          category: () => t('transfers.category'),
          caption: importer.extensionId,
          icon: 'mdi-file-import-outline',
          run: () => transfers.startImport(importer.extensionId, importer.id),
        },
        revision: JSON.stringify([importer.title]),
      })),
      ...exporters.map((exporter) => ({
        descriptor: {
          key: transferCommandKey('export', exporter.extensionId, exporter.id),
          source: 'extension' as const,
          title: () =>
            t('transfers.command.export', {
              title: titleOf(exporter.extensionId, exporter.title),
            }),
          category: () => t('transfers.category'),
          caption: exporter.extensionId,
          icon: 'mdi-file-export-outline',
          run: () => transfers.startExport(exporter.extensionId, exporter.id),
        },
        revision: JSON.stringify([exporter.title]),
      })),
    ];
  });
