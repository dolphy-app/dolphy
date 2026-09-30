import type { EngineErrorDto } from '@spirula-app/engine-contract';

/** Причины `details.reason` ошибки `EXTENSION_INSTALL_FAILED`. */
const INSTALL_REASONS = [
  'network',
  'integrity',
  'incompatible',
  'limits',
  'invalid',
  'conflict',
] as const;

type EngineInstallReason = (typeof INSTALL_REASONS)[number];

/** Причина сбоя установки: ключ текста в `settings.extensions.install.errors`. */
export type InstallFailureReason =
  EngineInstallReason | 'unavailable' | 'notFound' | 'unknown';

export interface InstallFailure {
  reason: InstallFailureReason;
  /** Сообщение движка как есть (не переводится). */
  message: string;
  retryable: boolean;
}

const isInstallReason = (reason: unknown): reason is EngineInstallReason =>
  INSTALL_REASONS.some((known) => known === reason);

/** Ошибка движка при установке или обновлении → причина для понятного текста. */
export const describeInstallFailure = (
  error: EngineErrorDto,
): InstallFailure => {
  const { code, details, message, retryable } = error;
  const reason = details?.['reason'];
  if (code === 'EXTENSION_INSTALL_FAILED' && isInstallReason(reason)) {
    return { reason, message, retryable };
  }
  if (code === 'CATALOG_UNAVAILABLE') {
    return { reason: 'unavailable', message, retryable };
  }
  if (code === 'NOT_FOUND') return { reason: 'notFound', message, retryable };
  return { reason: 'unknown', message, retryable };
};
