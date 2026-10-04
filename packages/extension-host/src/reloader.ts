import type { ExtensionReloader } from '@dolphy-app/engine/ports';
import type { ExtensionLogger } from '@dolphy-app/extension-api';
import type { HostChannel } from './channel.ts';
import type { DiscoveryResult } from './discover.ts';
import type { DiscoveryHolder } from './holder.ts';

export interface ExtensionReloaderOptions {
  holder: DiscoveryHolder;
  /** Перечитывает корни расширений (`discoverExtensions` с теми же настройками, что при запуске). */
  discover(): Promise<DiscoveryResult>;
  channel: Pick<HostChannel, 'call' | 'connected'>;
  logger: ExtensionLogger;
  /** Сколько ждать подтверждения хоста расширений; по умолчанию 10 с. Не уложился — канал просит перезапустить хост. */
  ackTimeoutMs?: number;
}

/**
 * Порт `ExtensionReloader` на стороне движка: перечитывает расширения,
 * заменяет общий снимок (политика, каталог, реестр, установщик) и отправляет
 * набор хосту расширений. Хост, которого сейчас нет, набор не получает: канал
 * отправит текущий при следующем подключении (`currentExtensions`), поэтому
 * отсутствие хоста — не отказ.
 */
export const createExtensionReloader = ({
  holder,
  discover,
  channel,
  logger,
  ackTimeoutMs = 10_000,
}: ExtensionReloaderOptions): ExtensionReloader => ({
  async reload() {
    const next = await discover();
    holder.replace(next);
    if (!channel.connected()) return;
    const outcome = await channel.call(
      'replaceExtensions',
      { extensions: next.extensions },
      ackTimeoutMs,
    );
    if (outcome.kind !== 'response' || !outcome.response.ok) {
      // хост перезапустится или подключится позже и получит набор сам
      logger.warn(
        { outcome: outcome.kind },
        'extension host did not acknowledge the new extension set',
      );
    }
  },
});
