import { vi } from 'vitest';
import type { EngineLink } from '../src/engine-link.ts';
import { EMPTY_SERVER_REGISTRATION } from '@dolphy-app/extension-api';
import type { ServerRegistration } from '@dolphy-app/extension-api';
import type { ExtensionCandidate, ResolvedExtension } from '../src/discover.ts';
import { createDiscoveryHolder, discoveryOf } from '../src/holder.ts';
import type { DiscoveryHolder } from '../src/holder.ts';
import type { ReplaceExtensionsResult } from '../src/protocol.ts';

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

/** Кандидат: найденное на диске расширение без кода; `overrides` меняют любое поле. */
export const candidateOf = (
  id: string,
  overrides: Partial<ExtensionCandidate> = {},
): ExtensionCandidate => ({
  id,
  version: '1.0.0',
  origin: 'user',
  revision: '',
  dir: `/x/${id}`,
  mainPath: `/x/${id}/main.mjs`,
  clientPath: null,
  name: null,
  description: null,
  author: null,
  dependencies: [],
  platforms: [],
  minAppVersion: null,
  icon: null,
  tags: [],
  install: null,
  warnings: [],
  ...overrides,
});

/** Кандидат с регистрацией: то, что собирает `holder.applyRegistrations`. */
export const resolvedOf = (
  id: string,
  registration: Partial<ServerRegistration> = {},
  overrides: Partial<ExtensionCandidate> = {},
): ResolvedExtension => ({
  ...candidateOf(id, overrides),
  ...EMPTY_SERVER_REGISTRATION,
  ...registration,
});

/** Ответ хоста расширений, в котором каждое расширение зарегистрировалось тем, что в нём есть. */
export const registrationsOf = (
  extensions: readonly ResolvedExtension[],
): ReplaceExtensionsResult => ({
  registrations: Object.fromEntries(
    extensions.map((extension) => [
      extension.id,
      { ok: true, registration: extension },
    ]),
  ),
});

/** Снимок обнаружения из готового набора расширений (без диагностик и перекрытых): регистрации берутся из самих расширений. */
export const holderOf = (
  extensions: readonly ResolvedExtension[],
): DiscoveryHolder => {
  const holder = createDiscoveryHolder(discoveryOf(extensions));
  holder.applyRegistrations(registrationsOf(extensions));
  return holder;
};

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
