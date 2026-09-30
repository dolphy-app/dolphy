import type { ItemReason } from '@spirula/engine-contract';

interface ItemReasonView {
  icon: string;
  /** Цвет темы Vuetify. */
  color: string;
}

/**
 * Как показываем причину, по которой упражнение попало в план или сессию.
 * Подпись — сообщение `reason.<причина>` из `shared/i18n`.
 */
export const ITEM_REASON: Record<ItemReason, ItemReasonView> = {
  new: { icon: 'mdi-sprout-outline', color: 'secondary' },
  review: { icon: 'mdi-history', color: 'primary' },
  remediation: { icon: 'mdi-lifebuoy', color: 'warning' },
};
