import type { ResolvedExtension } from './discover.ts';

/**
 * Причина отзыва версии по индексу действующего каталога; `null` — не отозвана.
 * `catalogUrl` — каталог, из которого расширение установлено: отзыв другого
 * каталога на него не действует.
 */
export type RevocationLookup = (
  id: string,
  version: string,
  catalogUrl: string,
) => string | null;

/**
 * Отзыв действует на расширения, установленные из каталога (origin `user` со
 * сведениями об установке): скопированное вручную или из поставки каталог не
 * отключает. Адрес каталога установки уходит в `lookup`: после смены адреса
 * отзыв нового каталога установленное из прежнего не отключает.
 */
export const revocationReason = (
  extension: Pick<ResolvedExtension, 'id' | 'version' | 'origin' | 'install'>,
  lookup: RevocationLookup | undefined,
): string | null =>
  lookup !== undefined &&
  extension.origin === 'user' &&
  extension.install !== null
    ? lookup(extension.id, extension.version, extension.install.catalogUrl)
    : null;
