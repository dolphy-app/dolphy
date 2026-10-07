import type { ExtensionReloader } from '@dolphy-app/engine/ports';
import type { ExtensionLogger } from '@dolphy-app/extension-api';
import type { HostChannel } from './channel.ts';
import type { DiscoveryResult } from './discover.ts';
import type { DiscoveryHolder } from './holder.ts';

export interface ExtensionReloaderOptions {
  holder: DiscoveryHolder;
  /** Перечитывает корни расширений (`discoverExtensions` с теми же настройками, что при запуске). */
  discover(): Promise<DiscoveryResult>;
  channel: Pick<HostChannel, 'replaceExtensions' | 'connected'>;
  logger: ExtensionLogger;
}

/**
 * Порт `ExtensionReloader` на стороне движка: перечитывает расширения,
 * заменяет общий снимок (политика, каталог, реестр, установщик), отправляет
 * кандидатов хосту расширений и применяет регистрации из его ответа. Хост,
 * которого сейчас нет, набор не получает: канал отправит текущий при
 * следующем подключении (`currentExtensions`) и отдаст регистрации в
 * `onRegistrations`, поэтому отсутствие хоста — не отказ.
 */
export const createExtensionReloader = ({
  holder,
  discover,
  channel,
  logger,
}: ExtensionReloaderOptions): ExtensionReloader => ({
  async reload() {
    const next = await discover();
    holder.replace(next);
    if (!channel.connected()) return;
    try {
      holder.applyRegistrations(
        await channel.replaceExtensions(next.extensions),
      );
    } catch (error) {
      // хост перезапустится или подключится позже и получит набор сам
      logger.warn(
        { error },
        'extension host did not acknowledge the new extension set',
      );
    }
  },
});
