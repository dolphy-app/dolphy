import { defineComponent, h, shallowRef } from 'vue';
import type { Component } from 'vue';
import type {
  ContributionsDto,
  ExtensionClientDto,
} from '@dolphy-app/engine-contract';
import type { ClientEntry } from '@dolphy-app/extension-api';
import { NO_CONTRIBUTIONS } from '@/shared/api/engine/contributions.ts';
import { createExtensionClients } from '@/shared/lib/extension-clients.ts';
import type { ExtensionClients } from '@/shared/lib/extension-clients.ts';
import { flush } from './extensions-fakes.ts';

export const clientDto = (
  extensionId: string,
  revision = '',
): ExtensionClientDto => ({
  extensionId,
  url: `dolphy-ext://${extensionId}/client.mjs`,
  origin: 'user',
  revision,
});

/** Компонент, который рисует `text` в элементе с `data-testid`. */
export const textComponent = (testId: string, text = testId): Component =>
  defineComponent({
    render: () => h('p', { 'data-testid': testId }, text),
  });

/**
 * Реестр клиентских частей на подставных модулях: `modules` — адрес → то, что
 * вернёт `import()` (значение, функция `client` или ошибка).
 */
export const createTestClients = (
  modules: Record<string, unknown>,
  clients: ExtensionClientDto[] = [],
  patch: Partial<ContributionsDto> = {},
) => {
  const contributions = shallowRef<ContributionsDto>({
    ...NO_CONTRIBUTIONS,
    ...patch,
    clients,
  });
  const imported: string[] = [];
  const registry: ExtensionClients = createExtensionClients({
    contributions: () => contributions.value,
    loadModule: async (url) => {
      imported.push(url);
      const module = modules[url.split('?')[0] ?? url];
      if (module instanceof Error) throw module;
      return module;
    },
  });
  return {
    registry,
    contributions,
    imported,
    setClients: async (next: ExtensionClientDto[]) => {
      contributions.value = { ...contributions.value, clients: next };
      await flush();
    },
  };
};

export const moduleOf = (client: ClientEntry) => ({ client });
