import type { KeybindingsRejectReason } from '@dolphy-app/engine-contract';

/** Отказ движка при сохранении привязок: что показать пользователю. */
export interface SaveFailure {
  reason: KeybindingsRejectReason | 'unknown';
  /** Путь к полю: `commands.<ключ>[0].when`. */
  field: string | undefined;
  command: string | undefined;
  /** Вторая команда при `conflict`. */
  other: string | undefined;
  /** Сообщение движка как есть (не переводится). */
  message: string;
}

const REASONS: readonly KeybindingsRejectReason[] = [
  'syntax',
  'typing',
  'conflict',
  'limit',
  'duplicate',
];

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Ошибка `setKeybindings` → причина из `details` (чужие ошибки — `unknown`). */
export const describeSaveFailure = (error: unknown): SaveFailure => {
  const message = error instanceof Error ? error.message : String(error);
  const details: Record<string, unknown> =
    typeof error === 'object' &&
    error !== null &&
    'details' in error &&
    typeof error.details === 'object' &&
    error.details !== null
      ? (error.details as Record<string, unknown>)
      : {};
  const raw = details['reason'];
  const reason = REASONS.find((known) => known === raw) ?? 'unknown';
  return {
    reason,
    field: text(details['field']),
    command: text(details['command']),
    other: text(details['other']),
    message,
  };
};
