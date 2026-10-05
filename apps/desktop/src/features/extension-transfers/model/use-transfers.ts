import { inject } from 'vue';
import { EXTENSION_TRANSFERS_KEY } from './transfers.ts';
import type { ExtensionTransfers } from './transfers.ts';

export const useExtensionTransfers = (): ExtensionTransfers => {
  const transfers = inject(EXTENSION_TRANSFERS_KEY);
  if (!transfers) throw new Error('extension transfers are not provided');
  return transfers;
};
