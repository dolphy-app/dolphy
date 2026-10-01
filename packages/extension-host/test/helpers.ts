import { vi } from 'vitest';
import type { ResolvedExtension } from '../src/discover.ts';
import { createDiscoveryHolder, discoveryOf } from '../src/holder.ts';
import type { DiscoveryHolder } from '../src/holder.ts';

export const createLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

export const nullLibrary = {
  readText: async (): Promise<string> => '',
  stat: async () => null,
};

/** Снимок обнаружения из готового набора расширений (без диагностик и перекрытых). */
export const holderOf = (
  extensions: readonly ResolvedExtension[],
): DiscoveryHolder => createDiscoveryHolder(discoveryOf(extensions));
