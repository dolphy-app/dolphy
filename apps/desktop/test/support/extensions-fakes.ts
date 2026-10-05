import type {
  CatalogDto,
  CatalogEntryDto,
  CatalogVersionDto,
  EngineEvent,
  ExtensionContributesDto,
  ExtensionInfoDto,
  ExtensionsDiagnosticsDto,
} from '@dolphy-app/engine-contract';

export const NO_CONTRIBUTES: ExtensionContributesDto = {
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
  settings: [],
  events: [],
  commands: [],
  panels: [],
  importers: [],
  exporters: [],
};

/** Движок без сбоев: хост работает, безопасный режим выключен, здоровья по расширениям нет. */
export const diagnosticsDto = (
  override: Partial<ExtensionsDiagnosticsDto> = {},
): ExtensionsDiagnosticsDto => ({
  host: 'running',
  safeMode: { active: false, persisted: false, forcedBy: null },
  extensions: [],
  ...override,
});

export const extensionInfo = (
  id: string,
  override: Partial<ExtensionInfoDto> = {},
): ExtensionInfoDto => ({
  id,
  version: '1.0.0',
  origin: 'bundled',
  state: 'loaded',
  contributes: { ...NO_CONTRIBUTES, exerciseTypes: [id] },
  diagnostics: [],
  permissions: [],
  isolation: 'trusted',
  toggleable: false,
  name: null,
  description: null,
  author: null,
  installed: null,
  icon: null,
  titles: {},
  messages: {},
  tags: [],
  removable: false,
  revoked: null,
  deprecated: null,
  ...override,
});

export const catalogVersion = (
  version: string,
  override: Partial<CatalogVersionDto> = {},
): CatalogVersionDto => ({
  version,
  permissions: [],
  publishedAt: '2026-01-01T00:00:00.000Z',
  size: 1200,
  minAppVersion: null,
  ...override,
});

export const catalogEntry = (
  id: string,
  override: Partial<CatalogEntryDto> = {},
): CatalogEntryDto => ({
  id,
  name: id,
  description: `Описание ${id}`,
  author: 'acme',
  source: `https://example.test/${id}`,
  platforms: [],
  contributes: { ...NO_CONTRIBUTES, themes: [id] },
  icon: null,
  titles: {},
  tags: [],
  status: 'available',
  installedVersion: null,
  latest: catalogVersion('1.0.0'),
  incompatible: null,
  versions: [],
  deprecated: null,
  elsewhere: false,
  ...override,
});

export const catalogDto = (
  entries: CatalogEntryDto[],
  override: Partial<CatalogDto> = {},
): CatalogDto => ({
  entries,
  fetchedAt: '2026-01-02T03:04:05.000Z',
  stale: false,
  error: null,
  ...override,
});

/** Подписка движка, которой тест рассылает события. */
export const createEventBus = () => {
  const listeners = new Set<(event: EngineEvent) => void>();
  return {
    subscribe: (listener: (event: EngineEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (event: EngineEvent) => {
      for (const listener of [...listeners]) listener(event);
    },
    count: () => listeners.size,
  };
};

/** Ошибка движка в виде, в каком её отдаёт RPC-клиент. */
export class FakeEngineError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.details !== undefined) this.details = options.details;
  }
}

const MICROTASK_ROUNDS = 12;

export const flush = async () => {
  for (let round = 0; round < MICROTASK_ROUNDS; round++) {
    await Promise.resolve();
  }
};
