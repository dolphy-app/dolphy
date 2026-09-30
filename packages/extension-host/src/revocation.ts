import type { ResolvedExtension } from './discover.ts';

/** Причина отзыва версии по индексу каталога; `null` — не отозвана. */
export type RevocationLookup = (id: string, version: string) => string | null;

/**
 * Отзыв действует на расширения, установленные из каталога (origin `user` со
 * сведениями об установке): скопированное вручную или из поставки каталог не
 * отключает.
 */
export const revocationReason = (
  extension: Pick<ResolvedExtension, 'id' | 'version' | 'origin' | 'install'>,
  lookup: RevocationLookup | undefined,
): string | null =>
  lookup !== undefined &&
  extension.origin === 'user' &&
  extension.install !== null
    ? lookup(extension.id, extension.version)
    : null;
