import { vi } from 'vitest';
import type { EngineLink } from '../src/engine-link.ts';
import type { ResolvedExtension } from '../src/discover.ts';
import { createDiscoveryHolder, discoveryOf } from '../src/holder.ts';
import type { DiscoveryHolder } from '../src/holder.ts';

export const createLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

export type TestLogger = ReturnType<typeof createLogger>;

/** Движок без данных: любой запрос данных расширения отклоняется. */
export const nullEngine: EngineLink = {
  request: async () => {
    throw new Error('no engine');
  },
};

export const nullLibrary = {
  readText: async (): Promise<string> => '',
  stat: async () => null,
};

/** Снимок обнаружения из готового набора расширений (без диагностик и перекрытых). */
export const holderOf = (
  extensions: readonly ResolvedExtension[],
): DiscoveryHolder => createDiscoveryHolder(discoveryOf(extensions));

export interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

/** `Promise.withResolvers` для сборки с библиотекой ниже es2024. */
export const deferred = (): Deferred => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve() };
};
